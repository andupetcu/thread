# OKF repository review and Thread design rationale

Review date: 2026-09-09. Static source/document review; upstream code, cloud scripts and tests were not executed. App implementation remains unchanged by this research task.

## Sources and review scope

Requested repository: [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1), pinned at `8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1`: 414 tracked files, 2,991,960 bytes. Review covers root documents, every sample, the entire OKF implementation and bundles, enrichment agents, metadata CLI/library/MCP, semantic-model subsystem, tests and fixtures. See the accompanying file-by-file coverage ledger for review depth.

Coverage: 407 files read fully as text, one duplicate license verified byte-identical to the fully read root license, two generated lockfiles parsed and inspected structurally, and four generated HTML viewers checked through their complete embedded data and equivalence with the fully read JavaScript/CSS sources. Every source, document and fixture was covered; the generated artifacts were not all read as repetitive raw text. The [414-file ledger](2026-09-09-okf-coverage.csv) includes paths, review depth, sizes and hashes. Scope reports retain detailed observations for [general tooling](okf-review-details/tooling.md), [semantic code](okf-review-details/semantic.md) and [tests/fixtures](okf-review-details/tests.md).

The [OKF README in the requested repository](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/README.md) declares that copy frozen and points to [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format/tree/ad30107c31c06aec8a7d5636e0d1058118604e6f). The maintained repository was additionally inspected and compared at `ad30107c31c06aec8a7d5636e0d1058118604e6f`. Its v0.2 SPEC.md is byte-identical to the frozen specification. Changes include licensing headers, sample tag representations and a new catalog connector document. Canonical additions were reviewed; the exhaustive 414-file inventory refers to the user-requested repository.

This is a Google-hosted open format and reference implementation, not evidence of a formal standards-body certification. Its repository also says it is not an official Google product. Thread should advertise compatibility with a named OKF version and tested behaviors, rather than broad certification.

## The actual format

OKF bundles are directory trees of UTF-8 Markdown documents with YAML frontmatter. A concept's identity is its path without `.md`; `type` is the only universally required field. Types and additional metadata are open-ended. `index.md` and `log.md` are reserved at every depth. Links can be relative to the containing file or begin with `/` to refer to the bundle root. Missing targets are tolerated. Optional metadata describes sources, generation, verification, lifecycle, staleness and attested computation contracts. Root indexes can declare `okf_version`. These rules come from the [canonical v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md).

For Thread, this means path-aware editing and loss-preserving YAML matter more than a new file extension. A successful import must not imply the content is correct or human-reviewed. A graph is a navigation projection over documents and references. It does not require a graph database, SQL compiler or cloud catalog.

## What each repository area contributes

| Area | Actual purpose | Implication for Thread |
| --- | --- | --- |
| `okf/SPEC.md` | Portable document and bundle contract | Primary format authority |
| `okf/src/reference_agent/bundle` and tests | YAML documents, indexing, path handling, synthesis | Useful examples and fixtures; implement independently in the existing JS stack |
| `okf/src/reference_agent/viewer` | Generated HTML navigation and graph | Reuse Thread's renderer/graph instead of embedding generated HTML |
| `okf/bundles` | Retail, Bitcoin, GA4 and Stack Overflow examples | Exercise types, sources, links, legacy signals, computations and imperfect input |
| `okf` agent, tools, web and BigQuery sources | Gemini/ADK-driven knowledge generation | Optional future producer; unnecessary for authoring |
| `samples`, `toolbox/enrichment` | Cloud discovery/enrichment and agent/tool execution | Separate integration and execution boundary |
| `toolbox/mdcode` general CLI/library/MCP | Cloud metadata snapshots and publishing | Not Thread's storage or conflict-resolution engine |
| `toolbox/mdcode/demo/okf` | OKF-to-catalog demo bridge | Optional later adapter with explicit fidelity limits |
| Semantic code/docs/tests | Ossie/OSI model compilation, graph deployment and OWL conversion | Separate format and feature family, not an OKF prerequisite |

## Findings that change the design

### Preserve source rather than adopting a lossy converter

The Python document writer reconstructs YAML; the catalog demo normalizes it, trims bodies and transports only Markdown. The semantic pipeline deliberately projects a subset of its own model. None is a suitable guarantee of exact authoring round-trips. See [document.py](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/src/reference_agent/bundle/document.py), [the OKF bridge](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/toolbox/mdcode/demo/okf/okf.ts), and [semantic fidelity documentation](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/toolbox/mdcode/docs/semantic-model/fidelity.md).

Thread should preserve authored Markdown/frontmatter, unknown nested values and every retained asset. Parsed metadata and graph edges are projections. A diagram can have a readable PNG and editable JSON sidecar; SQL/Python attachments remain opaque content. The default export should not silently normalize unknown fields or omit attachments.

### Follow specification semantics where examples differ

Static inspection found that the [viewer generator](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/src/reference_agent/viewer/generator.py) skips root-relative body links when building graph edges and can include reserved logs as concepts. Its browser link handling follows a different subset of paths. The [index generator](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/src/reference_agent/bundle/index.py) rebuilds indexes rather than preserving root version metadata or authored index prose. Sample metadata also includes inconsistent path assumptions and optional field shapes.

Thread should use one resolver across rendering, validation, graph and rename operations. Unknown or imperfect input should remain repairable. Imported indexes should remain authored documents unless the user selects managed regeneration. Do not silently reinterpret a broken document-relative link as root-relative just because a sample appears to intend that.

### Verification is evidence metadata, not authorization

The design will retain verification history and distinguish imported claims from local authenticated actions. Changes since a review will be visible without deleting the historical event. Agent edits will carry agent provenance and cannot manufacture a human actor. Successful validation checks document structure; it does not establish the truth of the knowledge.

Attested computations will initially be editable definitions and referenced files. The [sample SQL attester](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/okf/bundles/acme_retail/attesters/sql_equality.py) illustrates a contract; static inspection shows it trusts supplied receipt information and uses simplified SQL comparison. It should not become a production execution or attestation service inside Thread.

### Keep import boundaries and synchronization explicit

The general [catalog synchronization implementation](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1/toolbox/mdcode/src/libts/sync.ts) contains unfinished conflict/checksum/status handling. Some source-reading workflows also require live Google resources. Thread needs its own staged local import, bounded archive handling, revision checks and reviewed re-import. Missing incoming files must not imply deletion.

Static observations also found unsafe path-restoration patterns in the demo bridge and executable code/tool configuration in enrichment agents. These are reasons to treat imported bundles as data and to implement bounded path/YAML/asset handling. No exploit or cloud command was executed during review. Detailed evidence is retained in the scope reports.

### Cloud and semantic support are optional adapters

The semantic subsystem has valuable architecture: pure parsing/emission before effects, explicit ownership, loss reports and refusal to write an incomplete pull. Its cloud writes are not one transaction and its output is not a lossless backup of authored models. Thread can reuse those design ideas without taking a dependency on BigQuery, Spanner, gcloud, Bun, ADK or model credentials.

The canonical [connector document](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/connectors/gcp-knowledge-catalog.md) understates metadata carried by the currently reviewed demo: source code includes more signal keys and an extra-field carrier. Other documented limitations, including omitted non-Markdown files and lack of delete synchronization, remain relevant. Any future connector must be tested against its pinned code, with a preview of losses.

## Fit with the current Thread implementation

- `server/store.mjs` supplies SQLite persistence, note revisions and history, but its note write owns a transaction. Bundle rename/import needs a transaction-aware internal operation. Startup schema version handling needs a forward migration mechanism.
- Notes use UUIDs, while OKF uses paths. A bundle entry mapping must keep those identities distinct and stable. Existing flat string `properties` cannot safely hold nested frontmatter.
- `src/storage/useWorkspace.js` tracks pending drafts, acknowledgements and conflicts. Bundle operations must cooperate with that queue and refuse stale multi-file previews.
- `src/editor-model.js` and block editing work on Markdown body content. Feeding frontmatter through the existing body pipeline risks the same visible metadata/internal-marker problems previously fixed. Keep frontmatter separate from the visual body editor.
- `src/export-markdown.js` already handles assets and diagrams, but prepends a title and derives filenames from it. OKF needs a separate serializer with frontmatter first and stable bundle paths.
- `src/workspace/GraphView.jsx` and its graph model can display bundle navigation without embedding upstream generated HTML or adding a graph database.
- `server/mcp.mjs` already supports read/create/update notes. Extend its domain service and tool schema; enforce bundle provenance and revision rules even through existing update routes.

## Proposed scope

Native bundle creation and copy-from-notes; folder/ZIP import and reviewed refresh; body and metadata editing; file/path maintenance; indexes/logs; sources and review dashboard; graph; portable export with assets/diagrams; revision-safe MCP authoring; current admin/user permissions; backup/restore and regression tests.

Defer automatic Git/filesystem synchronization, cloud publishing, autonomous enrichment, semantic-model conversion and computation execution. They are independent integrations rather than prerequisites for useful OKF support.

See the [implementation plan](../superpowers/plans/2026-09-09-okf-bundles.md) for delivery order, proposed files, interfaces and acceptance checks.
