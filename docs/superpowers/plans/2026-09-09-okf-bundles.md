# Native OKF bundles in Thread — implementation plan

Status: implemented and verified on `codex/okf-bundles`. Existing uncommitted notes/accounts/MCP work is preserved. Changes remain local; no commit or push was requested for this feature.

**Goal:** Create, import, edit, review, maintain and export portable Open Knowledge Format bundles in Thread, including revision-safe MCP authoring without deletion.

**Architecture:** SQLite remains the workspace authority. Bundle documents reuse Thread note identities, editing and history; a separate bundle/path model provides portable identities. A pure Markdown/YAML format layer feeds UI, API, validation and export. Cloud integration is optional and outside this implementation.

**Tech stack:** Existing React, Node/SQLite, unified/remark, fflate, Vitest, Playwright and MCP SDK, with `yaml` for YAML 1.2 parsing and source-preserving metadata edits.

**Spec:** [Research and design rationale](../../research/2026-09-09-okf-review.md), based on canonical OKF v0.2 at commit `ad30107c31c06aec8a7d5636e0d1058118604e6f`.

**Global constraints:** Preserve existing notes and accounts; retain nested/unknown metadata; never silently discard imported files; no MCP deletion or fabricated human verification; no automatic execution of bundle code; no Google account required. Use isolated test workspaces, never the live workspace database.

## Product design and alternatives

Recommended: add **Knowledge bundles** beside notebooks. A bundle has a file tree, concept list, relationship graph and review/health view. A concept opens in the familiar note editor, with a metadata panel and an optional full Markdown/YAML source view. Notes outside bundles continue to work as today.

An export-only feature would be smaller but would not support maintaining imported bundles. Direct filesystem/Git authoring would add file watchers, external-edit conflicts and synchronization semantics to a currently database-backed app. Start with native bundles plus folder/ZIP import, reviewed re-import and portable ZIP export. Extracted ZIPs work with ordinary Git tooling; automatic Git synchronization can come later.

Creation offers an empty bundle or a copy of selected notes. Copying avoids silently giving one ordinary note two different ownership or path rules. Retain source-note ID/revision internally so the UI can report when the original has changed and offer a reviewed refresh. This is not automatic synchronization. One bundle document belongs to one bundle; shared concepts can be copied or linked externally with portability diagnostics.

Example flow: select API notes → Create knowledge bundle → set concept types and sources → review missing links → mark reviewed → export. An MCP agent can subsequently read the bundle index and update a concept with its expected revision; Thread records the change and shows that the content changed since review.

## 1. Format foundation and conformance fixtures

Proposed files: `shared/okf/document.mjs`, `shared/okf/paths.mjs`, `shared/okf/validate.mjs`, `tests/okf-format.test.js`, `tests/fixtures/okf/`.

- Implement pure `parseDocument`, `patchFrontmatter`, `serializeDocument`, `resolveBundleReference` and `validateBundle` interfaces. Diagnostics carry path, field/location, severity and suggested repair.
- Preserve the raw frontmatter, delimiters/newlines and body as the authoring representation. Derive typed metadata for forms; do not make a second independently writable metadata object. No-op import/export must retain original document bytes. Body-only edits must retain untouched frontmatter. Metadata edits patch the YAML document rather than reconstructing a whitelist of keys.
- Require a nonempty string `type` for concepts. Accept arbitrary types and extension keys. Invalid YAML or absent type goes into a visible repair state, not silent omission. Optional malformed fields remain preserved with diagnostics; distinguish format errors from maintenance warnings.
- Treat `index.md` and `log.md` as reserved at every depth. Support optional root `okf_version`, both root-relative and document-relative links, fragments, reference-style Markdown links, and appropriate path-valued frontmatter fields. Distinguish URLs and prose source scopes from local paths. Parse links using Markdown structure, excluding code examples.
- Implement v0.2 semantics, compatible reading of legacy v0.1 timestamps/citations, and best-effort unknown-version opening with warnings. Do not force a version conversion on import.
- Add small attributed examples from all four reference bundles and independent edge fixtures: nested/null/unknown metadata, comments, scalar tags, singleton verification, Unicode paths, reserved logs with frontmatter, broken links and attested computations.

Verification: failing contract tests first; then `npm test -- tests/okf-format.test.js`. Assert byte preservation, typed projections, path semantics and diagnostics separately.

## 2. Durable bundle storage and one write policy

Proposed new file: `server/okf.mjs`. Modify `server/store.mjs`, `server/http.mjs`, `src/storage/useWorkspace.js`; add `tests/okf-store.test.js`.

- Add forward-only SQLite migrations; current startup sets schemaVersion to 1 unconditionally and must not reset a migrated database.
- Add bundle records and entries with unique `(bundleId, path)`, document/asset kind, stable note/asset ID, manual/managed flag, import baseline hashes and bundle revision. Bundle-local paths are portable identities; note UUIDs retain history through path changes.
- Store the canonical raw frontmatter alongside the Markdown body in a protected note namespace; keep existing flat string `properties` separate. Metadata, title projection and body revisions must advance together. Preserve invalid imported source until repaired.
- Extract a transaction-aware internal note write operation: current `saveNote` owns its transaction. Bundle operations need to update documents, mappings, history, generated indexes and log atomically, with file mirrors emitted after commit.
- Route every mutation of bundle-linked notes through the same policy, including ordinary note PUT, table edits, duplicate, history restore, account API and MCP. Protect bundle/path/provenance fields from arbitrary note JSON. A conflict copy must allocate a new unique bundle path or explicitly become an ordinary note.
- Extend workspace snapshots, polling, autosave acknowledgements and conflict handling for bundle revisions. Multi-document operations first flush local drafts; stale previews fail with 409 rather than overwriting newer edits.
- Extend backup/restore and validation to include bundles, entry mappings, original metadata, assets, import baselines and history. Continue excluding account credentials and MCP secrets from portable content exports.

Verification: migration/restart, failed-transaction rollback, history restore, concurrent edits, conflict-copy identity and full backup round-trip tests. Keep existing durability/accounts tests passing.

## 3. Bundle authoring UI

Proposed files: `src/okf/BundleWorkspace.jsx`, `src/okf/ConceptMetadata.jsx`, `src/okf/okf.css`. Modify `src/main.jsx`, `src/Render.jsx`, and editor integration where necessary.

- Sidebar creation/import and bundle tree; concept list columns for path, type, status, review and staleness. Starter templates are suggestions, never a closed taxonomy.
- Reuse the current block editor for the body only. Keep YAML and Thread's internal block markers out of the rendered prose. A full-source view assembles the same canonical document and validates before applying edits.
- Metadata sections: basics, sources/citations, generation, verification/lifecycle, computation contract, advanced YAML. Support unknown fields without requiring users to edit YAML for common tasks.
- Attach files under stable bundle paths. Preview safe images/text; treat HTML, Python, SQL, skills and executor definitions as inert files. No importing executable viewers into the application page.
- Reuse visual diagram blocks. Portable exports include a normal image link plus editable diagram JSON; label the editable representation as a Thread extension, not an OKF diagram standard.

Verification: browser create/edit/reload/source-toggle tests, including the previous Start here regression: metadata/block comments must not leak into prose, and diagrams must remain visible/editable in both modes.

## 4. Maintenance: links, indexes, history and review

Proposed file: `shared/okf/maintenance.mjs`. Extend `server/okf.mjs`, `src/okf/BundleWorkspace.jsx`, `src/workspace/graph-model.js` and `src/workspace/GraphView.jsx`.

- Title edits do not rename files. An explicit rename/move previews incoming and outgoing link changes, checks collisions and applies them in one transaction. Rewrite known path fields and Markdown links; report ambiguous custom-field references instead of guessing.
- Generate deterministic indexes for newly created bundles, including root version metadata. Imported indexes remain manual unless the user adopts a previewed regenerated version. Reserved files never become concept nodes.
- Append meaningful operation summaries to date-grouped logs; avoid an entry for every autosave keystroke. Retain detailed note history separately.
- Graph body relationships and source derivations, with filters and unresolved targets. Show broken links as maintenance issues, not grounds to reject an otherwise usable bundle.
- Review dashboard: missing sources, stale content, draft/deprecated concepts and changed-since-review. Preserve historical verification events. Compute the OKF tier from those events; show local change-since-review separately, rather than redefining the standard's tier.
- Human review is an explicit authenticated UI action with server-derived identity/time. Imported claims remain visibly attributed to their source. Absence of status means stable per the spec; newly authored concepts can explicitly start as draft. Never infer verification from a successful import or validation pass.

Verification: rename across directories and metadata references, reserved-file handling, managed/manual indexes, operation logs, staleness with offsets, imported verification and post-review edits.

## 5. Portable import, export and reviewed refresh

Proposed files: `server/okf-archive.mjs`, `src/okf/BundleTransfer.jsx`, `tests/okf-transfer.test.js`. Reuse suitable helpers from `src/export-assets.js` and `src/export-markdown.js`.

- Folder upload and ZIP import share a staging/preview pipeline: detected root, every file, format errors, link warnings, attachments and conflicts. Commit the accepted batch atomically. Invalid concept documents can be kept in repair state without being counted as valid concepts.
- Bound compressed/uncompressed bytes, expansion ratio, entry count, YAML alias expansion and document complexity before materialization. Reject traversal, absolute archive paths, symlinks, duplicate entries and filesystem case/normalization collisions. Preserve legitimate Unicode/spaces rather than silently slugging imported paths.
- Export a standard folder tree inside a ZIP, including reserved files and all retained assets. No required Thread manifest. Export raw-preservation mode for imported content; provide a previewed portable projection when converting ordinary Thread notes, diagrams and note/block references.
- Convert included note UUID links to bundle paths, and block links to stable portable anchors where representable. Report excluded targets and unsupported embeds before export; offer inclusion or an explicit retained external reference. Do not imply complete portability when Thread-only references remain.
- Existing Markdown export prepends a title and uses title-based filenames; it cannot directly serialize OKF frontmatter/path identity. Reuse asset/diagram helpers, not that whole output routine.
- Re-import compares incoming files with the last imported baseline and current revisions. Show keep/update/copy choices for conflicts. Missing incoming files never automatically delete local entries. External renames are ambiguous without stable portable IDs: offer an explicit rename mapping, otherwise retain the old entry and import the new path.
- Keep exported content limited to bundle-owned files; do not include workspace databases, authentication configuration, environment files or unrelated local files. Surface suspicious credential-like content in export preview without silently changing authored text.

Verification: no-op byte round-trips, changed metadata preservation, binary asset equality, all four sample bundles, malformed files, archive boundary tests, three-way conflicts, missing-file retention and diagram/reference portability.

## 6. MCP bundle support and existing roles

Modify `server/mcp.mjs`, `server/auth.mjs`, `server/http.mjs` and `server/okf.mjs`; extend `tests/mcp.test.js` and add focused bundle API tests.

- Add tools for listing bundles, reading a bundle index, listing/reading concepts, creating bundles/concepts, updating concept content/metadata and validating a bundle. Expose bundle-relative paths, note IDs and revisions in results. Keep tool inputs structured and bounded.
- Writes require expected revisions and use the same domain service as the UI. Existing `update_note` must also enforce bundle policies; an alternate endpoint must not bypass them.
- Agent-produced changes receive server-derived agent provenance. MCP cannot manufacture or modify human verification, erase review history, delete/deprecate whole bundles as a deletion substitute, or write arbitrary filesystem paths. Deprecating an individual concept remains an explicit lifecycle edit, with history, rather than deletion.
- Attested computation definitions can be authored as drafts. Changes to a reviewed computation are visibly pending human review; no execution capability is added. Never let a requested execution silently rewrite a sanctioned computation.
- Retain the simple shared-workspace admin/user model: both can read/create/edit bundles; admin manages users, keys and existing destructive/admin operations. All bundle MCP tools remain non-deleting regardless of the key owner's role. No new per-bundle ACL subsystem in this iteration.

Verification: real MCP client read/create/update, 409 conflicts, invalid paths, revoked keys, normal note API bypass attempts, forged review metadata and absence of deletion/execution tools. Test both admin and user tokens.

Implementation clarification: existing MCP keys are admin-issued and admin-owned. Both admin and user **sessions** can author/review bundles; MCP retains the existing key policy, including revocation on owner demotion. This feature does not add user-owned keys.

## 7. Release acceptance and documentation

- Add `tests/okf.spec.js` for create → edit → review → export → re-import → concurrent MCP edit → resolve conflict → restart/restore.
- Run focused tests during each slice, then `npm test`, `npm run build`, and `npm run test:e2e` once the integrated feature is ready. Use a temporary workspace and test accounts; do not run upstream cloud deployment examples as validation.
- Document the supported OKF version, extension preservation, portable export limitations, imported verification semantics, role behavior, MCP examples and backup recovery in README and a bundle guide.
- Acceptance: bundles work offline; all supplied sample bundles open with honest diagnostics; round-trips retain unknown metadata/assets; path edits preserve references/history; human verification cannot be forged through MCP; no MCP operation deletes content; ordinary notes, diagrams, login and backups retain existing behavior.

## Deferred integrations

Automatic filesystem/Git synchronization; Google Knowledge Catalog publishing; BigQuery/Spanner deployment; semantic-model/OWL conversion; cloud crawling or model-driven enrichment; executing or cryptographically attesting computations. These can consume the same portable model later, but each needs its own fidelity, conflict and execution contract.

## Completion evidence — 2026-09-09

- `npm test`: 181 tests across 24 files passed on the final source.
- `npm run build`: passed. Vite retains its bundle-size advisory.
- `npm run test:e2e`: all 56 browser tests passed, covering existing accounts, notes, notebooks, diagrams, exports, durability and new bundles.
- The final small text-preview/history addition was verified with `tests/okf-previews.spec.js` and the three existing `tests/okf.spec.js` cases: all four passed. This adds one browser case beyond the full 56-test run.
- All 83 files across the four Google reference bundles retained exact bytes through SQLite import/export. Backup/restore retained all four bundles. Validation produced no hard format errors for those examples.
- Independent format, backend and UI reviews completed with no remaining findings after corrections. The text-preview/history addition also received a clean scoped review.
- Local development server restarted successfully; UI and authentication status endpoints returned HTTP 200. All mutation tests used temporary workspaces.

See [Knowledge bundles](../../okf-bundles.md) for the implemented workflow and boundaries.
