import { unified } from 'unified'
import remarkParse from 'remark-parse'

const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/
const posix = {
  dirname(value) { const index = value.lastIndexOf('/'); return index < 0 ? '.' : index === 0 ? '/' : value.slice(0, index) },
  join(...parts) { return parts.filter(Boolean).join('/') },
  normalize(value) {
    const output = []
    for (const part of value.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') output.length && output.at(-1) !== '..' ? output.pop() : output.push('..')
      else output.push(part)
    }
    return output.join('/') || '.'
  },
  relative(from, to) {
    const a = from === '.' ? [] : from.split('/'), b = to.split('/')
    let index = 0
    while (index < a.length && index < b.length && a[index] === b[index]) index++
    return [...a.slice(index).map(() => '..'), ...b.slice(index)].join('/') || '.'
  },
}

export function normalizeBundlePath(value) {
  if (typeof value !== 'string') throw new TypeError('Bundle path must be a string')
  const normalizedInput = value.normalize('NFC').replaceAll('\\', '/')
  if (!normalizedInput || normalizedInput.includes('\0') || normalizedInput.startsWith('/') || /^[A-Za-z]:\//.test(normalizedInput)) {
    throw new Error(`Invalid bundle path: ${value}`)
  }
  const normalized = posix.normalize(normalizedInput)
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') throw new Error(`Path escapes bundle root: ${value}`)
  return normalized
}

function splitReference(reference) {
  const match = /^([^?#]*)([?#][\s\S]*)?$/.exec(reference)
  return { pathname: match?.[1] ?? reference, suffix: match?.[2] ?? '' }
}

export function resolveBundleReference(fromPath, reference) {
  if (typeof reference !== 'string') return { path: null, external: false, reference }
  if (URL_SCHEME.test(reference) || reference.startsWith('//') || reference.startsWith('#')) {
    return { path: null, external: true, reference }
  }
  const { pathname, suffix } = splitReference(reference)
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { decoded = pathname }
  const pathLike = decoded.startsWith('/') || decoded.startsWith('./') || decoded.startsWith('../') || /^[^\s]+(?:\/|\.[A-Za-z0-9]+$)/.test(decoded)
  if (!pathLike) return { path: null, external: false, reference }
  const rootRelative = decoded.startsWith('/')
  const base = rootRelative ? '' : posix.dirname(normalizeBundlePath(fromPath))
  try {
    return { path: normalizeBundlePath(posix.join(base, decoded.replace(/^\/+/, ''))) + suffix, external: false, rootRelative, reference }
  } catch (error) {
    return { path: null, external: false, reference, error: error.message }
  }
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

export function listMarkdownReferences(source) {
  const tree = unified().use(remarkParse).parse(source)
  const references = []
  walk(tree, (node) => {
    if ((node.type === 'link' || node.type === 'definition' || node.type === 'image') && typeof node.url === 'string') {
      const sourceSlice = source.slice(node.position.start.offset, node.position.end.offset)
      const span = markdownDestinationSpan(sourceSlice, node)
      if (span) references.push({ url: node.url, rawUrl: sourceSlice.slice(span.start, span.end), start: node.position.start.offset + span.start, end: node.position.start.offset + span.end, kind: node.type })
    }
  })
  return references
}

function markdownDestinationSpan(slice, node) {
  const kind = node.type
  const childEnd = node.children?.length ? node.children.at(-1).position?.end?.offset - node.position.start.offset : 0
  const delimiter = kind === 'definition' ? slice.indexOf(']:') : slice.indexOf('](', Math.max(0, childEnd))
  if (delimiter < 0) return null
  let start = delimiter + 2
  while (/\s/.test(slice[start] ?? '')) start++
  if (slice[start] === '<') {
    const contentStart = ++start
    let escaped = false
    for (let index = contentStart; index < slice.length; index++) {
      const char = slice[index]
      if (char === '>' && !escaped) return { start: contentStart, end: index }
      escaped = char === '\\' && !escaped
      if (char !== '\\') escaped = false
    }
    return null
  }
  let depth = 0
  for (let index = start; index < slice.length; index++) {
    const char = slice[index]
    if (char === '\\') { index++; continue }
    if (char === '&') {
      const entity = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i.exec(slice.slice(index))
      if (entity) { index += entity[0].length - 1; continue }
    }
    if (char === '(') depth++
    else if (char === ')') { if (depth === 0) return { start, end: index }; depth-- }
    else if (/\s/.test(char) && depth === 0) return { start, end: index }
  }
  return kind === 'definition' && start < slice.length ? { start, end: slice.length } : null
}

function encodePath(pathname) {
  return pathname.split('/').map((part) => encodeURIComponent(part).replace(/%2E/gi, '.')).join('/')
}

export function relativeBundleReference(fromPath, targetPath, { rootRelative = false } = {}) {
  if (rootRelative) return `/${encodePath(targetPath)}`
  let relative = posix.relative(posix.dirname(fromPath), targetPath)
  if (!relative.startsWith('.')) relative = `./${relative}`
  return encodePath(relative)
}

export function rewriteBundleReferences(source, { fromPath, toPath = fromPath, renames }) {
  const renameMap = renames instanceof Map ? renames : new Map(Object.entries(renames ?? {}))
  const edits = []
  for (const ref of listMarkdownReferences(source)) {
    const resolved = resolveBundleReference(fromPath, ref.url)
    if (!resolved.path) continue
    const { pathname: target, suffix } = splitReference(resolved.path)
    const renamed = renameMap.get(target) ?? target
    if (!renameMap.has(target) && fromPath === toPath) continue
    const replacement = relativeBundleReference(toPath, renamed, { rootRelative: resolved.rootRelative }) + suffix
    if (replacement !== ref.url) edits.push({ ...ref, replacement, from: target, to: renamed })
  }
  let changed = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) changed = changed.slice(0, edit.start) + edit.replacement + changed.slice(edit.end)
  return { source: changed, changes: edits.reverse(), ambiguous: [] }
}
