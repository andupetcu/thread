import path from 'node:path'
import { parseDocument, patchFrontmatter } from './document.mjs'
import { normalizeBundlePath, relativeBundleReference, resolveBundleReference, rewriteBundleReferences } from './paths.mjs'

const posix = path.posix
const KNOWN_PATHS = new Set(['resource', 'computation'])

function entriesArray(entries) {
  return entries instanceof Map ? [...entries].map(([path, content]) => ({ path, content })) : entries.map((entry) => ({ ...entry }))
}

export function generateIndexes(entries, { version = '0.2' } = {}) {
  const documents = entriesArray(entries).filter((entry) => entry.path.endsWith('.md') && !['index.md', 'log.md'].includes(posix.basename(entry.path)))
  const directories = new Set([''])
  for (const entry of documents) {
    let dir = posix.dirname(entry.path)
    while (dir !== '.') { directories.add(dir); dir = posix.dirname(dir) }
    directories.add('')
  }
  const result = new Map()
  for (const directory of [...directories].sort()) {
    const children = documents.filter((entry) => posix.dirname(entry.path) === (directory || '.')).sort((a, b) => a.path.localeCompare(b.path))
    const subdirs = [...new Set(documents.map((entry) => posix.relative(directory || '.', entry.path).split('/')).filter((parts) => parts.length > 1).map((parts) => parts[0]))].sort()
    const lines = [`# ${directory ? posix.basename(directory) : 'Bundle'}`, '']
    for (const subdir of subdirs) lines.push(`* [${subdir}](${encodeURIComponent(subdir)}/)`)
    for (const entry of children) {
      const metadata = parseDocument(entry.content).metadata ?? {}
      const title = typeof metadata.title === 'string' ? metadata.title : posix.basename(entry.path, '.md')
      const description = typeof metadata.description === 'string' && metadata.description.trim() ? ` - ${metadata.description.trim()}` : ''
      lines.push(`* [${title}](${encodeURIComponent(posix.basename(entry.path))})${description}`)
    }
    const body = `${lines.join('\n')}\n`
    result.set(directory ? `${directory}/index.md` : 'index.md', directory ? body : `---\nokf_version: "${version}"\n---\n${body}`)
  }
  return result
}

export function generateIndex(entries, { path = 'index.md', version = '0.2' } = {}) {
  return generateIndexes(entries, { version }).get(path) ?? ''
}

function rewriteKnownMetadata(source, documentPath, nextDocumentPath, oldPath, newPath, ambiguous) {
  const parsed = parseDocument(source, { path: documentPath })
  if (!parsed.metadata) return source
  const patch = {}
  const inspect = (field, value, setter) => {
    if (typeof value !== 'string') return
    const resolved = resolveBundleReference(documentPath, value)
    const match = /^([^?#]*)([?#][\s\S]*)?$/.exec(resolved.path ?? '')
    const target = match?.[1]
    const suffix = match?.[2] ?? ''
    if (target && (target === oldPath || documentPath !== nextDocumentPath)) {
      setter(relativeBundleReference(nextDocumentPath, target === oldPath ? newPath : target, { rootRelative: resolved.rootRelative }) + suffix)
    }
  }
  for (const field of KNOWN_PATHS) inspect(field, parsed.metadata[field], (value) => { patch[field] = value })
  for (const field of ['executor', 'attester']) inspect(`${field}.resource`, parsed.metadata[field]?.resource, (value) => { patch[field] = { resource: value } })
  if (Array.isArray(parsed.metadata.sources)) {
    const sources = structuredClone(parsed.metadata.sources)
    let changed = false
    sources.forEach((source, index) => inspect(`sources[${index}].resource`, source?.resource, (value) => { sources[index].resource = value; changed = true }))
    if (changed) patch.sources = sources
  }
  for (const [field, value] of Object.entries(parsed.metadata)) {
    if (KNOWN_PATHS.has(field) || ['sources', 'executor', 'attester'].includes(field)) continue
    inspect(field, value, () => ambiguous.push({ path: documentPath, field, value }))
  }
  return Object.keys(patch).length ? patchFrontmatter(source, patch, { path: documentPath }) : source
}

export function renameBundlePath(entries, fromPath, toPath) {
  const oldPath = normalizeBundlePath(fromPath)
  const newPath = normalizeBundlePath(toPath)
  const output = entriesArray(entries)
  if (!output.some((entry) => entry.path === oldPath)) throw new Error(`Bundle path does not exist: ${oldPath}`)
  if (output.some((entry) => entry.path === newPath)) throw new Error(`Bundle path already exists: ${newPath}`)
  const ambiguous = []
  const changes = []
  for (const entry of output) {
    const originalDocumentPath = entry.path
    const nextDocumentPath = entry.path === oldPath ? newPath : entry.path
    if (typeof entry.content === 'string' && entry.path.endsWith('.md')) {
      let content = rewriteKnownMetadata(entry.content, originalDocumentPath, nextDocumentPath, oldPath, newPath, ambiguous)
      const rewritten = rewriteBundleReferences(content, { fromPath: originalDocumentPath, toPath: nextDocumentPath, renames: new Map([[oldPath, newPath]]) })
      if (rewritten.source !== entry.content) changes.push({ path: originalDocumentPath, references: rewritten.changes.length })
      entry.content = rewritten.source
    }
    entry.path = nextDocumentPath
  }
  return { entries: output, changes, diagnostics: [], ambiguous }
}
