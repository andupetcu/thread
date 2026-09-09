import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseDocument, patchFrontmatter, serializeDocument } from '../shared/okf/document.mjs'
import { normalizeBundlePath, resolveBundleReference, rewriteBundleReferences } from '../shared/okf/paths.mjs'
import { generateIndexes, renameBundlePath } from '../shared/okf/maintenance.mjs'
import { validateBundle } from '../shared/okf/validate.mjs'

const fixture = (name) => readFile(fileURLToPath(new URL(`./fixtures/okf/${name}`, import.meta.url)), 'utf8')

describe('OKF document source preservation', () => {
  test('a parsed document serializes byte-for-byte when untouched', async () => {
    const source = await fixture('preservation.md')
    const parsed = parseDocument(source, { path: 'metrics/revenue.md' })
    expect(parsed.metadata.extension.nested).toBe('001')
    expect(parsed.metadata.nullable).toBeNull()
    expect(parsed.typed.verified).toEqual([{ by: 'human:reviewer', at: '2026-07-01T09:00:00Z' }])
    expect(serializeDocument(parsed)).toBe(source)
  })

  test('patches selected metadata while preserving comments, unknown fields, nulls, and body bytes', async () => {
    const source = await fixture('preservation.md')
    const changed = patchFrontmatter(source, { title: 'Recognized revenue', status: 'draft' })
    expect(changed).toContain('# retained heading comment')
    expect(changed).toContain('title: Recognized revenue # retained title comment')
    expect(changed).toContain('nullable: null')
    expect(parseDocument(changed).metadata.extension.nested).toBe('001')
    expect(parseDocument(changed).body).toBe(parseDocument(source).body)
  })

  test('keeps invalid YAML visible with repair diagnostics', () => {
    const source = '---\ntype: [broken\n---\nbody\n'
    const parsed = parseDocument(source, { path: 'broken.md' })
    expect(parsed.source).toBe(source)
    expect(parsed.diagnostics.some((d) => d.code === 'invalid-yaml' && d.severity === 'error')).toBe(true)
  })

  test('adds frontmatter to body-only source and handles empty verification plus shape changes', () => {
    expect(patchFrontmatter('Body\r\n', { type: 'Note' })).toBe('---\r\ntype: Note\r\n---\r\nBody\r\n')
    expect(parseDocument('---\ntype: Note\nverified: []\n---\n').typed.trustTier).toBe('unverified')
    const changed = patchFrontmatter('---\ntype: Note\nextension: scalar\n---\n', { extension: { nested: true } })
    expect(parseDocument(changed).metadata.extension).toEqual({ nested: true })
  })

  test('patches empty flow frontmatter and multiline scalars into valid YAML', () => {
    const empty = patchFrontmatter('---\n{}\n---\nBody', { type: 'Concept', status: 'draft' })
    expect(parseDocument(empty).metadata).toMatchObject({ type: 'Concept', status: 'draft' })
    const multiline = patchFrontmatter('---\ntype: Note\ndescription: old\n---\n', { description: 'first\nsecond' })
    expect(parseDocument(multiline).metadata.description).toBe('first\nsecond')
  })

  test('deletes one scalar and replaces a block scalar without consuming the next field', () => {
    const deleted = patchFrontmatter('---\ntype: Test\ntitle: Title\nunknown: keep\n---\n', { title: undefined })
    expect(parseDocument(deleted).metadata).toEqual({ type: 'Test', unknown: 'keep' })
    const block = patchFrontmatter('---\ntype: Test\ndescription: |\n  hello\nunknown: keep\n---\n', { description: 'updated' })
    expect(parseDocument(block).metadata).toEqual({ type: 'Test', description: 'updated', unknown: 'keep' })
  })
})

describe('OKF paths and references', () => {
  test.each([
    ['groups/a.md', '../root.md#part', 'root.md#part'],
    ['groups/a.md', './邻居.md', 'groups/邻居.md'],
    ['groups/a.md', '/tables/orders.md', 'tables/orders.md'],
  ])('resolves document and root relative paths', (from, reference, expected) => {
    expect(resolveBundleReference(from, reference).path).toBe(expected)
  })

  test('does not treat URLs or prose source scopes as bundle paths', () => {
    expect(resolveBundleReference('a.md', 'https://example.com/a')).toMatchObject({ external: true })
    expect(resolveBundleReference('a.md', 'all queries in project X')).toMatchObject({ path: null })
  })

  test.each(['../outside.md', '../../outside.md', 'a/../../../outside.md'])('rejects paths escaping the bundle root: %s', (value) => {
    expect(() => normalizeBundlePath(value)).toThrow(/escapes bundle root/)
    expect(resolveBundleReference('root.md', value).path).toBeNull()
  })

  test('rewrites inline and reference-style Markdown links but ignores code examples', () => {
    const source = '[inline](../old.md#x) and [ref][r]\n\n[r]: /docs/old.md\n\n`[code](../old.md)`\n'
    const result = rewriteBundleReferences(source, {
      fromPath: 'docs/current.md',
      renames: new Map([['old.md', 'new place.md'], ['docs/old.md', 'docs/new.md']]),
    })
    expect(result.source).toContain('[inline](../new%20place.md#x)')
    expect(result.source).toContain('[r]: /docs/new.md')
    expect(result.source).toContain('`[code](../old.md)`')
  })

  test('rewrites unchanged outgoing targets when the containing document moves', () => {
    const result = rewriteBundleReferences('[peer](./peer.md)', {
      fromPath: 'old/current.md', toPath: 'new/deep/current.md', renames: new Map(),
    })
    expect(result.source).toBe('[peer](../../old/peer.md)')
  })

  test('rewrites the link destination when the title repeats the same text', () => {
    expect(rewriteBundleReferences('[label](a.md "a.md")', {
      fromPath: 'x.md', renames: new Map([['a.md', 'b.md']]),
    }).source).toBe('[label](./b.md "a.md")')
  })

  test.each([
    ['[x]: <old.md>\n\n[x]', '[x]: <./new.md>\n\n[x]'],
    ['[x](old&#46;md)', '[x](./new.md)'],
    ['[x](old\\(1\\).md)', '[x](./new.md)'],
  ])('rewrites the raw Markdown destination span safely', (source, expected) => {
    const oldPath = source.includes('1') ? 'old(1).md' : 'old.md'
    expect(rewriteBundleReferences(source, { fromPath: 'x.md', renames: new Map([[oldPath, 'new.md']]) }).source).toBe(expected)
  })

  test('rewrites an outer link around an image without changing the image destination', () => {
    const source = '[![x](image.png)](old.md)'
    expect(rewriteBundleReferences(source, { fromPath: 'doc.md', renames: new Map([['old.md', 'new.md']]) }).source).toBe('[![x](image.png)](./new.md)')
  })
})

describe('OKF conformance and maintenance', () => {
  test('validates concepts, reserved documents, links, versions, and computation contracts separately', async () => {
    const acme = await fixture('acme.md')
    const result = validateBundle([
      { path: 'index.md', content: '---\nokf_version: "9.0"\n---\n# Bundle\n' },
      { path: 'computations/revenue.md', content: acme },
      { path: 'bad.md', content: 'no frontmatter' },
      { path: 'nested/log.md', content: '# Log\n\n## yesterday\n* changed\n' },
      { path: 'nested/index.md', content: '---\ntype: Wrong\n---\n# Nested\n' },
    ])
    expect(result.ok).toBe(false)
    expect(result.concepts).toHaveLength(2)
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining([
      'unknown-version', 'missing-frontmatter', 'invalid-log-date', 'reserved-frontmatter', 'broken-link',
    ]))
  })

  test('accepts the four sampled bundle document families', async () => {
    const names = ['crypto.md', 'ga4.md', 'stackoverflow.md', 'acme.md']
    const entries = await Promise.all(names.map(async (name) => ({ path: name, content: await fixture(name) })))
    const result = validateBundle(entries)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.concepts).toHaveLength(4)
  })

  test('reports lifecycle, missing-source, and malformed optional signal warnings without dropping input', () => {
    const source = `---\ntype: Note\ntags: one\nstatus: draft\nstale_after: tomorrow\ngenerated: { by: bot/1, at: 2026-01-01 }\nverified: { by: human:a, at: no }\nsources: [{ id: absent }]\n---\n`
    const result = validateBundle([{ path: 'signals.md', content: source }], { now: '2026-09-09T00:00:00Z' })
    expect(result.ok).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining([
      'draft-concept', 'invalid-tags', 'invalid-timestamp', 'invalid-source',
    ]))
  })

  test('generates deterministic root and nested indexes', () => {
    const indexes = generateIndexes([
      { path: 'z.md', content: '---\ntype: Note\ntitle: Zed\n---\nZ' },
      { path: 'group/a.md', content: '---\ntype: Note\ntitle: Alpha\ndescription: First.\n---\nA' },
    ], { version: '0.2' })
    expect(indexes.get('index.md')).toContain('okf_version: "0.2"')
    expect(indexes.get('group/index.md')).toContain('[Alpha](a.md) - First.')
  })

  test('renames paths and rewrites Markdown plus known metadata path fields', async () => {
    const source = '---\ntype: Metric\nsources:\n  - resource: ../tables/old.md\ncustom: ../tables/old.md\n---\n[table](../tables/old.md)\n'
    const result = renameBundlePath([
      { path: 'metrics/m.md', content: source },
      { path: 'tables/old.md', content: '---\ntype: Table\n---\n' },
    ], 'tables/old.md', 'warehouse/orders.md')
    expect(result.entries.some((e) => e.path === 'warehouse/orders.md')).toBe(true)
    const metric = result.entries.find((e) => e.path === 'metrics/m.md').content
    expect(metric).toContain('resource: ../warehouse/orders.md')
    expect(metric).toContain('[table](../warehouse/orders.md)')
    expect(result.ambiguous).toEqual([{ path: 'metrics/m.md', field: 'custom', value: '../tables/old.md' }])
  })

  test('rebases outgoing metadata when its document moves and preserves incoming fragments', () => {
    const moved = renameBundlePath([
      { path: 'a/doc.md', content: '---\ntype: Note\nresource: ../asset.csv#part\n---\n' },
      { path: 'asset.csv', content: new Uint8Array([1]) },
    ], 'a/doc.md', 'b/c/doc.md')
    expect(parseDocument(moved.entries.find((e) => e.path === 'b/c/doc.md').content).metadata.resource).toBe('../../asset.csv#part')

    const incoming = renameBundlePath([
      { path: 'doc.md', content: '---\ntype: Note\nresource: ./old.csv#part\n---\n' },
      { path: 'old.csv', content: new Uint8Array([1]) },
    ], 'old.csv', 'new.csv')
    expect(parseDocument(incoming.entries.find((e) => e.path === 'doc.md').content).metadata.resource).toBe('./new.csv#part')
  })
})
