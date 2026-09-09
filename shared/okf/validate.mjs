import path from 'node:path'
import { parseDocument } from './document.mjs'
import { listMarkdownReferences, normalizeBundlePath, resolveBundleReference } from './paths.mjs'

const posix = path.posix
const RESERVED = new Set(['index.md', 'log.md'])
const PATH_FIELDS = ['resource', 'computation']

function diag(code, message, path, severity = 'error', field = null, repair = null) {
  return { code, message, path, severity, field, repair }
}

function normalizedEntries(entries) {
  const iterable = entries instanceof Map ? [...entries].map(([path, content]) => ({ path, content })) : entries
  return (iterable ?? []).map((entry) => typeof entry === 'string' ? { path: entry, content: '' } : entry)
}

function pathValues(metadata) {
  const values = []
  for (const field of PATH_FIELDS) if (typeof metadata?.[field] === 'string') values.push({ field, value: metadata[field] })
  for (const field of ['executor', 'attester']) if (typeof metadata?.[field]?.resource === 'string') values.push({ field: `${field}.resource`, value: metadata[field].resource })
  for (let i = 0; i < (Array.isArray(metadata?.sources) ? metadata.sources.length : 0); i++) {
    if (typeof metadata.sources[i]?.resource === 'string') values.push({ field: `sources[${i}].resource`, value: metadata.sources[i].resource })
  }
  return values
}

function validTimestamp(value) {
  return typeof value === 'string' && /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

function validateSignals(metadata, documentPath, diagnostics, now) {
  if (!metadata) return
  if (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== 'string'))) diagnostics.push(diag('invalid-tags', 'tags should be a list of strings.', documentPath, 'warning', 'tags'))
  if (!Object.hasOwn(metadata, 'sources')) diagnostics.push(diag('missing-sources', 'Concept has no source provenance.', documentPath, 'warning', 'sources'))
  else if (!Array.isArray(metadata.sources)) diagnostics.push(diag('invalid-sources', 'sources should be a list.', documentPath, 'warning', 'sources'))
  else metadata.sources.forEach((source, index) => {
    if (!source || typeof source !== 'object' || typeof source.resource !== 'string' || !source.resource.trim()) diagnostics.push(diag('invalid-source', 'Each source should have a non-empty resource.', documentPath, 'warning', `sources[${index}].resource`))
    if (source?.last_modified !== undefined && !validTimestamp(source.last_modified)) diagnostics.push(diag('invalid-timestamp', 'Source last_modified requires an ISO 8601 datetime with an explicit offset.', documentPath, 'warning', `sources[${index}].last_modified`))
  })
  if (metadata.generated !== undefined) {
    if (!metadata.generated || typeof metadata.generated !== 'object' || typeof metadata.generated.by !== 'string') diagnostics.push(diag('invalid-generated', 'generated should include a by actor.', documentPath, 'warning', 'generated'))
    if (metadata.generated?.at !== undefined && !validTimestamp(metadata.generated.at)) diagnostics.push(diag('invalid-timestamp', 'generated.at requires an ISO 8601 datetime with an explicit offset.', documentPath, 'warning', 'generated.at'))
  }
  if (metadata.verified !== undefined) {
    const events = Array.isArray(metadata.verified) ? metadata.verified : [metadata.verified]
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object' || typeof event.by !== 'string') diagnostics.push(diag('invalid-verification', 'Verification events should include a by actor.', documentPath, 'warning', `verified[${index}]`))
      if (event?.at !== undefined && !validTimestamp(event.at)) diagnostics.push(diag('invalid-timestamp', 'Verification time requires an ISO 8601 datetime with an explicit offset.', documentPath, 'warning', `verified[${index}].at`))
    })
  }
  if (metadata.status === 'draft') diagnostics.push(diag('draft-concept', 'Concept is marked draft.', documentPath, 'warning', 'status'))
  else if (metadata.status === 'deprecated') diagnostics.push(diag('deprecated-concept', 'Concept is marked deprecated.', documentPath, 'warning', 'status'))
  else if (metadata.status !== undefined && metadata.status !== 'stable') diagnostics.push(diag('invalid-status', 'status should be draft, stable, or deprecated.', documentPath, 'warning', 'status'))
  if (metadata.stale_after !== undefined) {
    if (!validTimestamp(metadata.stale_after)) diagnostics.push(diag('invalid-timestamp', 'stale_after requires an ISO 8601 datetime with an explicit offset.', documentPath, 'warning', 'stale_after'))
    else if (Date.parse(now) >= Date.parse(metadata.stale_after)) diagnostics.push(diag('stale-concept', 'Concept is past its stale_after time.', documentPath, 'warning', 'stale_after'))
  }
}

export function validateBundle(entries, { version, now = new Date().toISOString() } = {}) {
  const input = normalizedEntries(entries)
  const diagnostics = []
  const concepts = []
  const reserved = []
  const indexes = []
  const known = new Set()
  for (const entry of input) {
    try { entry.path = normalizeBundlePath(entry.path) } catch (error) {
      diagnostics.push(diag('invalid-path', error.message, entry.path)); continue
    }
    known.add(entry.path)
  }

  let declaredVersion = version
  for (const entry of input) {
    if (!entry.path || typeof entry.content !== 'string' || !entry.path.toLowerCase().endsWith('.md')) continue
    const basename = posix.basename(entry.path).toLowerCase()
    const isReserved = RESERVED.has(basename)
    const parsed = parseDocument(entry.content, { path: entry.path })
    if (isReserved) {
      reserved.push(entry)
      if (basename === 'index.md') indexes.push(entry)
      if (parsed.hasFrontmatter) {
        const rootVersionIndex = entry.path === 'index.md' && parsed.metadata && Object.keys(parsed.metadata).every((key) => key === 'okf_version')
        if (!rootVersionIndex) diagnostics.push(diag('reserved-frontmatter', 'Only the root index may have frontmatter, containing only okf_version.', entry.path, basename === 'log.md' ? 'warning' : 'error'))
        else declaredVersion = parsed.metadata.okf_version
      }
      if (basename === 'log.md') {
        for (const match of entry.content.matchAll(/^##\s+([^\r\n]+)\s*$/gm)) if (!/^\d{4}-\d{2}-\d{2}$/.test(match[1].trim())) diagnostics.push(diag('invalid-log-date', 'Log date headings must use YYYY-MM-DD.', entry.path, 'error', 'body'))
      }
      for (const ref of listMarkdownReferences(parsed.body)) {
        const target = resolveBundleReference(entry.path, ref.url)
        const targetPath = target.path?.replace(/[?#][\s\S]*$/, '')
        if (targetPath && !known.has(targetPath) && !targetPath.endsWith('/')) diagnostics.push(diag('broken-link', `Referenced bundle path does not exist: ${targetPath}`, entry.path, 'warning', 'body'))
      }
      continue
    }
    concepts.push({ ...entry, parsed })
    diagnostics.push(...parsed.diagnostics)
    if (parsed.metadata && (typeof parsed.metadata.type !== 'string' || !parsed.metadata.type.trim())) {
      diagnostics.push(diag('missing-type', 'Concept frontmatter requires a non-empty type string.', entry.path, 'error', 'type', 'Set a descriptive type.'))
    }
    if (parsed.metadata?.type === 'Attested Computation' && (typeof parsed.metadata.runtime !== 'string' || !parsed.metadata.runtime.trim())) {
      diagnostics.push(diag('missing-runtime', 'Attested Computation requires runtime.', entry.path, 'warning', 'runtime'))
    }
    validateSignals(parsed.metadata, entry.path, diagnostics, now)
    const refs = [
      ...listMarkdownReferences(parsed.body).map((ref) => ({ field: 'body', value: ref.url })),
      ...pathValues(parsed.metadata),
    ]
    for (const ref of refs) {
      const target = resolveBundleReference(entry.path, ref.value)
      if (!target.path) continue
      const targetPath = target.path.replace(/[?#][\s\S]*$/, '')
      if (!known.has(targetPath)) diagnostics.push(diag('broken-link', `Referenced bundle path does not exist: ${targetPath}`, entry.path, 'warning', ref.field))
    }
  }
  if (declaredVersion != null && !['0.1', '0.2'].includes(String(declaredVersion))) diagnostics.push(diag('unknown-version', `Unknown OKF version ${declaredVersion}; opened best-effort.`, 'index.md', 'warning', 'okf_version'))
  return { ok: !diagnostics.some((item) => item.severity === 'error'), diagnostics, concepts, reserved, indexes, version: declaredVersion ?? null }
}

export { pathValues }
