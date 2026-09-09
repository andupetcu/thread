import { inflateRawSync } from 'node:zlib'
import { strToU8, Zip, ZipDeflate } from 'fflate'

const DEFAULTS = Object.freeze({
  maxEntries: 2_000,
  maxCompressedBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxExpansionRatio: 100,
  maxYamlAliases: 100,
  maxDocumentNodes: 100_000,
})

export class OkfArchiveError extends Error {
  constructor(code, message, path = null) {
    super(message)
    this.name = 'OkfArchiveError'
    this.code = code
    this.path = path
  }
}

const fail = (code, message, path) => { throw new OkfArchiveError(code, message, path) }

function safeArchivePath(path) {
  if (typeof path !== 'string' || !path) fail('archive-invalid-path', 'Archive entry path must be non-empty.', path)
  if (path.includes('\0')) fail('archive-invalid-path', 'Archive entry path contains a null byte.', path)
  if (path.includes('\\')) fail('archive-backslash-path', 'Archive entry paths must use forward slashes.', path)
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) fail('archive-absolute-path', 'Archive entry path must be relative.', path)
  const parts = path.split('/')
  if (parts.some((part) => part === '..')) fail('archive-traversal', 'Archive entry path traverses outside the bundle.', path)
  if (parts.some((part) => part === '' || part === '.')) fail('archive-invalid-path', 'Archive entry path contains an empty or dot segment.', path)
  return path
}

function collisionKey(path) {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function detectRoot(paths) {
  if (!paths.length || paths.some((path) => !path.includes('/'))) return null
  const first = paths[0].split('/')[0]
  return paths.every((path) => path.startsWith(`${first}/`)) ? first : null
}

function checkDocument(content, path, limits) {
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)?.[1] ?? ''
  const aliases = (frontmatter.match(/(^|[\s,[{])\*[A-Za-z0-9_-]+/g) ?? []).length
  if (aliases > limits.maxYamlAliases) fail('yaml-alias-limit', `YAML alias count exceeds ${limits.maxYamlAliases}.`, path)
  const nodes = (content.match(/^(?:#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*[\w"'][^\n:]*:\s*)/gm) ?? []).length
  if (nodes > limits.maxDocumentNodes) fail('document-complexity-limit', `Document complexity exceeds ${limits.maxDocumentNodes}.`, path)
}

export function inspectOkfFolder(entries, options = {}) {
  const limits = { ...DEFAULTS, ...options }
  if (!Array.isArray(entries)) throw new TypeError('Folder entries must be an array')
  if (entries.length > limits.maxEntries) fail('archive-entry-limit', `Entry count exceeds ${limits.maxEntries}.`)
  const prepared = entries.filter((entry) => !String(entry.path).endsWith('/')).map((entry) => ({ ...entry, path: safeArchivePath(entry.path) }))
  const detectedRoot = detectRoot(prepared.map((entry) => entry.path))
  const root = options.stripRoot ? (typeof options.stripRoot === 'string' ? options.stripRoot : detectedRoot) : null
  if (root && !prepared.every((entry) => entry.path.startsWith(`${root}/`))) fail('archive-root-mismatch', `Not every entry is inside requested root ${root}.`)
  const seen = new Map()
  let total = 0
  const output = prepared.map((entry) => {
    const path = root ? entry.path.slice(root.length + 1) : entry.path
    const key = collisionKey(path)
    if (seen.has(key)) fail('archive-path-collision', `Archive paths collide after case/Unicode normalization: ${seen.get(key)} and ${path}.`, path)
    for (const [otherKey, otherPath] of seen) if (key.startsWith(`${otherKey}/`) || otherKey.startsWith(`${key}/`)) fail('archive-path-collision', `Archive file path collides with descendant path: ${otherPath} and ${path}.`, path)
    seen.set(key, path)
    const document = path.toLowerCase().endsWith('.md')
    let content = entry.content
    if (document) {
      if (content instanceof Uint8Array || Buffer.isBuffer(content)) {
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) } catch { fail('archive-invalid-utf8', 'Markdown documents must be UTF-8.', path) }
      }
      if (typeof content !== 'string') fail('archive-invalid-document', 'Markdown document content must be text or bytes.', path)
      checkDocument(content, path, limits)
    } else if (!(content instanceof Uint8Array) && !Buffer.isBuffer(content)) {
      content = typeof content === 'string' ? strToU8(content) : new Uint8Array(content ?? [])
    }
    const byteLength = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
    if (byteLength > limits.maxEntryBytes) fail('archive-entry-size-limit', `Entry exceeds ${limits.maxEntryBytes} bytes.`, path)
    total += byteLength
    if (total > limits.maxUncompressedBytes) fail('archive-uncompressed-limit', `Uncompressed content exceeds ${limits.maxUncompressedBytes} bytes.`)
    return { path, content, kind: document ? 'document' : 'asset' }
  }).sort((a, b) => a.path.localeCompare(b.path))
  return { entries: output, root, detectedRoot, diagnostics: [] }
}

function centralDirectory(bytes, limits) {
  if (bytes.byteLength > limits.maxCompressedBytes) fail('archive-compressed-limit', `Archive exceeds ${limits.maxCompressedBytes} compressed bytes.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let offset = Math.max(0, bytes.byteLength - 65_557); offset <= bytes.byteLength - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) eocd = offset
  }
  if (eocd < 0) fail('archive-invalid-zip', 'ZIP end-of-central-directory record is missing.')
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskCount = view.getUint16(eocd + 8, true)
  const count = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if ([diskCount, count].includes(0xffff) || [centralSize, centralOffset].includes(0xffffffff)) fail('archive-zip64-unsupported', 'ZIP64 archives are not supported.')
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count) fail('archive-invalid-zip', 'Multi-disk or inconsistent ZIP entry counts are not supported.')
  if (centralOffset + centralSize !== eocd) fail('archive-invalid-zip', 'ZIP central directory bounds do not match EOCD metadata.')
  if (count > limits.maxEntries) fail('archive-entry-limit', `Entry count exceeds ${limits.maxEntries}.`)
  let offset = centralOffset
  let total = 0
  const metadata = []
  const seen = new Map()
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) fail('archive-invalid-zip', 'ZIP central directory is malformed.')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    if (flags & 1) fail('archive-encrypted', 'Encrypted ZIP entries are not supported.')
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const madeBy = view.getUint16(offset + 4, true) >> 8
    const external = view.getUint32(offset + 38, true)
    const localOffset = view.getUint32(offset + 42, true)
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    let name
    try { name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8', { fatal: true }).decode(nameBytes) } catch { fail('archive-invalid-path', 'ZIP filename is not valid UTF-8.') }
    const unixMode = external >>> 16
    if (madeBy === 3 && (unixMode & 0xf000) === 0xa000) fail('archive-symlink', 'Symbolic links are not allowed in bundle archives.', name)
    if (!name.endsWith('/')) {
      safeArchivePath(name)
      const key = collisionKey(name)
      if (seen.has(key)) fail('archive-path-collision', `Archive paths collide after case/Unicode normalization: ${seen.get(key)} and ${name}.`, name)
      for (const [otherKey, otherPath] of seen) if (key.startsWith(`${otherKey}/`) || otherKey.startsWith(`${key}/`)) fail('archive-path-collision', `Archive file path collides with descendant path: ${otherPath} and ${name}.`, name)
      seen.set(key, name)
    }
    if (uncompressed > limits.maxEntryBytes) fail('archive-entry-size-limit', `Entry exceeds ${limits.maxEntryBytes} bytes.`, name)
    total += uncompressed
    if (total > limits.maxUncompressedBytes) fail('archive-uncompressed-limit', `Uncompressed content exceeds ${limits.maxUncompressedBytes} bytes.`)
    if (uncompressed / Math.max(1, compressed) > limits.maxExpansionRatio) fail('archive-expansion-limit', `Entry expansion ratio exceeds ${limits.maxExpansionRatio}.`, name)
    metadata.push({ name, compressed, uncompressed, crc, flags, method, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return metadata
}

export async function parseOkfArchive(input, options = {}) {
  const limits = { ...DEFAULTS, ...options }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const metadata = centralDirectory(bytes, limits)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = []
  let actualTotal = 0
  for (const entry of metadata) {
    if (entry.name.endsWith('/')) continue
    const offset = entry.localOffset
    if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) fail('archive-invalid-zip', 'ZIP local header is malformed.', entry.name)
    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    const localCrc = view.getUint32(offset + 14, true)
    const localCompressed = view.getUint32(offset + 18, true)
    const localUncompressed = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const rawName = bytes.subarray(offset + 30, offset + 30 + nameLength)
    let localName
    try { localName = new TextDecoder('utf-8', { fatal: true }).decode(rawName) } catch { fail('archive-invalid-path', 'ZIP local filename is not valid UTF-8.') }
    if (localName !== entry.name || flags !== entry.flags || method !== entry.method) fail('archive-invalid-zip', 'ZIP local and central headers disagree.', entry.name)
    if (!(flags & 8) && (localCrc !== entry.crc || localCompressed !== entry.compressed || localUncompressed !== entry.uncompressed)) fail('archive-invalid-zip', 'ZIP local and central sizes or CRC disagree.', entry.name)
    const dataStart = offset + 30 + nameLength + extraLength
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressed)
    if (compressed.length !== entry.compressed) fail('archive-invalid-zip', 'ZIP entry data is truncated.', entry.name)
    let content
    try {
      if (method === 0) content = compressed.slice()
      else if (method === 8) content = new Uint8Array(inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, Math.min(limits.maxEntryBytes, limits.maxUncompressedBytes - actualTotal)),
      }))
      else fail('archive-compression-unsupported', `ZIP compression method ${method} is not supported.`, entry.name)
    } catch (error) {
      if (error instanceof OkfArchiveError) throw error
      fail('archive-invalid-zip', `Unable to inflate ZIP entry: ${error.message}`, entry.name)
    }
    if (content.length !== entry.uncompressed) fail('archive-invalid-zip', 'Inflated ZIP entry size does not match metadata.', entry.name)
    if (crc32(content) !== entry.crc) fail('archive-invalid-zip', 'Inflated ZIP entry CRC does not match metadata.', entry.name)
    actualTotal += content.length
    if (actualTotal > limits.maxUncompressedBytes) fail('archive-uncompressed-limit', `Uncompressed content exceeds ${limits.maxUncompressedBytes} bytes.`)
    files.push({ path: entry.name, content })
  }
  return inspectOkfFolder(files, limits)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export async function createOkfArchive(entries, options = {}) {
  const limits = { ...DEFAULTS, ...options }
  inspectOkfFolder(entries, limits)
  const chunks = []
  const bytes = await new Promise((resolve, reject) => {
    const archive = new Zip((error, chunk, final) => {
      if (error) { reject(error); return }
      chunks.push(chunk)
      if (final) {
        const length = chunks.reduce((sum, item) => sum + item.length, 0)
        const output = new Uint8Array(length)
        let offset = 0
        for (const item of chunks) { output.set(item, offset); offset += item.length }
        resolve(output)
      }
    })
    try {
      for (const entry of entries) {
        const file = new ZipDeflate(safeArchivePath(entry.path), { level: 6 })
        archive.add(file)
        file.push(typeof entry.content === 'string' ? strToU8(entry.content) : new Uint8Array(entry.content), true)
      }
      archive.end()
    } catch (error) { reject(error) }
  })
  if (bytes.byteLength > limits.maxCompressedBytes) fail('archive-compressed-limit', `Archive exceeds ${limits.maxCompressedBytes} compressed bytes.`)
  return bytes
}
