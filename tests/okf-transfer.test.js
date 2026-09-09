import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { createOkfArchive, inspectOkfFolder, parseOkfArchive } from '../server/okf-archive.mjs'

const concept = (title = 'One') => `---\ntype: Note\ntitle: ${title}\n---\nBody\n`

function mutateCentral(bytes, mutate) {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  for (let offset = 0; offset <= copy.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    mutate(copy, view, offset)
    offset += 45 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  return copy
}

function mutateEocd(bytes, mutate) {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  for (let offset = copy.length - 22; offset >= 0; offset--) if (view.getUint32(offset, true) === 0x06054b50) { mutate(view, offset); return copy }
  throw new Error('EOCD not found')
}

describe('OKF folder and ZIP transfer', () => {
  test('round-trips document bytes, binary assets, Unicode, and spaces', async () => {
    const entries = [
      { path: '知识 bundle/index.md', content: '# Index\r\n', kind: 'document' },
      { path: '知识 bundle/notes/hello world.md', content: concept('Hello'), kind: 'document' },
      { path: '知识 bundle/assets/pixel.bin', content: new Uint8Array([0, 255, 13, 10]), kind: 'asset' },
    ]
    const archive = await createOkfArchive(entries)
    const staged = await parseOkfArchive(archive, { stripRoot: true })
    expect(staged.root).toBe('知识 bundle')
    expect(staged.entries.map((entry) => entry.path)).toEqual(['assets/pixel.bin', 'index.md', 'notes/hello world.md'])
    expect(staged.entries.find((entry) => entry.path.endsWith('.md')).content).toBe('# Index\r\n')
    expect([...staged.entries.find((entry) => entry.kind === 'asset').content]).toEqual([0, 255, 13, 10])
  })

  test('preserves a UTF-8 BOM and the authored Unicode path spelling', async () => {
    const decomposed = 'cafe\u0301.md'
    const source = '\uFEFF---\ntype: Note\n---\nBody\n'
    const staged = await parseOkfArchive(await createOkfArchive([{ path: decomposed, content: source }]))
    expect(staged.entries[0].path).toBe(decomposed)
    expect(staged.entries[0].content).toBe(source)
  })

  test('reports a possible wrapper root without stripping it by default', async () => {
    const staged = await parseOkfArchive(await createOkfArchive([{ path: 'guides/a.md', content: concept() }]))
    expect(staged.detectedRoot).toBe('guides')
    expect(staged.root).toBeNull()
    expect(staged.entries[0].path).toBe('guides/a.md')
  })

  test.each([
    ['traversal', { '../evil.md': strToU8(concept()) }, 'archive-traversal'],
    ['absolute path', { '/evil.md': strToU8(concept()) }, 'archive-absolute-path'],
    ['backslash path', { 'dir\\evil.md': strToU8(concept()) }, 'archive-backslash-path'],
  ])('rejects %s entries', async (_name, files, code) => {
    await expect(parseOkfArchive(zipSync(files))).rejects.toMatchObject({ code })
  })

  test('rejects duplicate and Unicode/case-normalized collisions', () => {
    expect(() => inspectOkfFolder([
      { path: 'A.md', content: concept() },
      { path: 'a.md', content: concept() },
    ])).toThrowError(expect.objectContaining({ code: 'archive-path-collision' }))
    expect(() => inspectOkfFolder([
      { path: 'cafe\u0301.md', content: concept() },
      { path: 'caf\u00e9.md', content: concept() },
    ])).toThrowError(expect.objectContaining({ code: 'archive-path-collision' }))
    expect(() => inspectOkfFolder([
      { path: 'Dir', content: new Uint8Array([1]) },
      { path: 'dir/child.bin', content: new Uint8Array([2]) },
    ])).toThrowError(expect.objectContaining({ code: 'archive-path-collision' }))
  })

  test('rejects duplicate ZIP names and Unix symlinks from central metadata', async () => {
    const duplicate = mutateCentral(zipSync({ 'a.md': strToU8(concept()), 'b.md': strToU8(concept()) }), (bytes, view, offset) => {
      if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 50)) === 'b.md') bytes[offset + 46] = 'a'.charCodeAt(0)
    })
    await expect(parseOkfArchive(duplicate)).rejects.toMatchObject({ code: 'archive-path-collision' })
    const symlink = mutateCentral(zipSync({ 'link.md': strToU8('target') }), (_bytes, view, offset) => {
      view.setUint16(offset + 4, 3 << 8, true)
      view.setUint32(offset + 38, 0xa1ff << 16, true)
    })
    await expect(parseOkfArchive(symlink)).rejects.toMatchObject({ code: 'archive-symlink' })
  })

  test('enforces entry, compressed, uncompressed, per-entry, and expansion limits before unzip', async () => {
    const archive = zipSync({ 'large.md': new Uint8Array(20_000).fill(65) }, { level: 9 })
    await expect(parseOkfArchive(archive, { maxEntries: 0 })).rejects.toMatchObject({ code: 'archive-entry-limit' })
    await expect(parseOkfArchive(archive, { maxCompressedBytes: 1 })).rejects.toMatchObject({ code: 'archive-compressed-limit' })
    await expect(parseOkfArchive(archive, { maxUncompressedBytes: 10 })).rejects.toMatchObject({ code: 'archive-uncompressed-limit' })
    await expect(parseOkfArchive(archive, { maxEntryBytes: 10 })).rejects.toMatchObject({ code: 'archive-entry-size-limit' })
    await expect(parseOkfArchive(archive, { maxExpansionRatio: 2 })).rejects.toMatchObject({ code: 'archive-expansion-limit' })
  })

  test('rejects inconsistent EOCD entry counts before inflation', async () => {
    const archive = zipSync({ 'a.txt': new Uint8Array(4096).fill(97) }, { level: 9 })
    const forged = mutateEocd(archive, (view, offset) => view.setUint16(offset + 10, 0, true))
    await expect(parseOkfArchive(forged, { maxExpansionRatio: 2 })).rejects.toMatchObject({ code: 'archive-invalid-zip' })
  })

  test('rejects an understated central uncompressed size instead of truncating output', async () => {
    const forged = mutateCentral(zipSync({ 'a.txt': strToU8('abcdef') }), (_bytes, view, offset) => view.setUint32(offset + 24, 1, true))
    await expect(parseOkfArchive(forged)).rejects.toMatchObject({ code: 'archive-invalid-zip' })
  })

  test('rejects YAML alias and document-complexity bombs', () => {
    const aliases = `---\ntype: Note\nbase: &x [1]\nboom: [${Array(30).fill('*x').join(', ')}]\n---\n`
    expect(() => inspectOkfFolder([{ path: 'aliases.md', content: aliases }], { maxYamlAliases: 10 })).toThrowError(expect.objectContaining({ code: 'yaml-alias-limit' }))
    expect(() => inspectOkfFolder([{ path: 'nodes.md', content: concept() + Array(50).fill('- node').join('\n') }], { maxDocumentNodes: 10 })).toThrowError(expect.objectContaining({ code: 'document-complexity-limit' }))
  })

  test('does not count Markdown emphasis or code as YAML aliases', () => {
    const markdown = `${concept()}${Array(101).fill('*word* and `*code`').join('\n')}`
    expect(() => inspectOkfFolder([{ path: 'markdown.md', content: markdown }], { maxYamlAliases: 10 })).not.toThrow()
  })

  test('counts aliases when the closing frontmatter delimiter has trailing whitespace', () => {
    const source = '---\ntype: Test\na: &a value\nx: [*a, *a]\n--- \nbody\n'
    expect(() => inspectOkfFolder([{ path: 'aliases.md', content: source }], { maxYamlAliases: 1 })).toThrowError(expect.objectContaining({ code: 'yaml-alias-limit' }))
  })

  test('ZIP output contains only the supplied bundle-owned paths', async () => {
    const bytes = await createOkfArchive([{ path: 'index.md', content: '# Safe\n' }])
    expect(Object.keys(unzipSync(bytes))).toEqual(['index.md'])
  })

  test('round-trips a root asset named __proto__ without loss', async () => {
    const staged = await parseOkfArchive(await createOkfArchive([
      { path: '__proto__', content: new Uint8Array([1, 2, 3]) },
      { path: 'index.md', content: '# Index\n' },
    ]))
    expect(staged.entries.find((entry) => entry.path === '__proto__')?.content).toEqual(new Uint8Array([1, 2, 3]))
  })
})
