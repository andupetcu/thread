import { isMap, parseDocument as parseYamlDocument } from 'yaml'

const FRONTMATTER = /^(?:\uFEFF)?---([ \t]*)(\r?\n)([\s\S]*?)(\r?\n)---[ \t]*(\r?\n|$)/

function diagnostic(code, message, path, severity = 'error', extra = {}) {
  return { code, message, path: path ?? null, severity, ...extra }
}

function typedProjection(metadata) {
  const typed = { ...metadata }
  if (metadata && Object.hasOwn(metadata, 'verified')) {
    typed.verified = Array.isArray(metadata.verified) ? metadata.verified : [metadata.verified]
  }
  typed.status = metadata?.status ?? 'stable'
  const validVerification = typed.verified?.filter((event) => event && typeof event === 'object' && typeof event.by === 'string') ?? []
  typed.trustTier = !metadata || !Object.hasOwn(metadata, 'verified') || validVerification.length === 0
    ? 'unverified'
    : validVerification.some((event) => event.by.startsWith('human:'))
      ? 'human-reviewed'
      : 'machine-confirmed'
  return typed
}

export function parseDocument(source, { path } = {}) {
  if (typeof source !== 'string') throw new TypeError('OKF document source must be a string')
  const match = FRONTMATTER.exec(source)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  if (!match) {
    return {
      source, path, hasFrontmatter: false, frontmatterRaw: null, body: source,
      metadata: null, typed: typedProjection(null), document: null, newline,
      diagnostics: [diagnostic('missing-frontmatter', 'Concept document has no YAML frontmatter block.', path)],
    }
  }

  const frontmatterRaw = match[3]
  const body = source.slice(match[0].length)
  let document = null
  let metadata = null
  const diagnostics = []
  try {
    document = parseYamlDocument(frontmatterRaw, {
      keepSourceTokens: true,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
      version: '1.2',
    })
    if (document.errors.length) {
      diagnostics.push(...document.errors.map((error) => diagnostic(
        'invalid-yaml', error.message, path, 'error', { location: error.pos ?? null },
      )))
    } else {
      metadata = document.toJS({ maxAliasCount: 100 })
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        diagnostics.push(diagnostic('invalid-frontmatter', 'Frontmatter must be a YAML mapping.', path))
        metadata = null
      }
    }
  } catch (error) {
    diagnostics.push(diagnostic('invalid-yaml', error.message, path))
  }
  return {
    source, path, hasFrontmatter: true, frontmatterRaw, body, metadata,
    typed: typedProjection(metadata), document, newline, diagnostics,
    _prefix: source.slice(0, match.index), _opening: `${source.startsWith('\uFEFF') ? '\uFEFF' : ''}---${match[1]}${match[2]}`,
    _closing: `${match[4]}---${match[5]}`,
  }
}

function applyPatch(document, patch, path = []) {
  for (const [key, value] of Object.entries(patch)) {
    const next = [...path, key]
    if (value === undefined) document.deleteIn(next)
    else if (value && typeof value === 'object' && !Array.isArray(value) && isMap(document.getIn(next, true))) {
      applyPatch(document, value, next)
    } else document.setIn(next, value)
  }
}

export function patchFrontmatter(source, patch, options = {}) {
  const parsed = parseDocument(source, options)
  if (!parsed.hasFrontmatter) return serializeDocument({ metadata: patch, body: source, newline: parsed.newline })
  if (!parsed.document || parsed.document.errors.length) {
    throw new Error('Cannot patch a document with missing or invalid YAML frontmatter')
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Frontmatter patch must be an object')
  if (Object.keys(patch).length === 0) return source
  applyPatch(parsed.document, patch)
  let yaml = parsed.document.toString({ lineWidth: 0 }).replace(/\n$/, '')
  if (parsed.newline === '\r\n') yaml = yaml.replace(/\n/g, '\r\n')
  return `${parsed._prefix}${parsed._opening}${yaml}${parsed._closing}${parsed.body}`
}

export function serializeDocument(value) {
  if (typeof value === 'string') return value
  if (value?.source && value.body !== undefined && value.frontmatterRaw !== undefined) return value.source
  const newline = value?.newline ?? '\n'
  const body = value?.body ?? ''
  const metadata = value?.metadata ?? {}
  const document = parseYamlDocument('')
  document.contents = document.createNode(metadata)
  const yaml = document.toString({ lineWidth: 0 }).replace(/\n$/, '').replace(/\n/g, newline)
  return `---${newline}${yaml}${newline}---${newline}${body}`
}
