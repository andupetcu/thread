# mdcode tests review

Commit: `8cf3abaf1ee3d53a12f981cc0ed83d6ffec775e1`. Scope: all `toolbox/mdcode/tests/**`. Read-only inspection; no dependencies installed, tests executed, or cloud commands run. This report concerns test assertions and fixtures, not proof that current implementation passes them.

## Coverage

130 files, 763,349 bytes. All 35 TypeScript source/test files and all 95 scenario YAML, semantic YAML/JSON, SQL golden, Turtle fixture, and README files were read fully in bounded textual chunks, including all fixture scalars and comments. The 45 semantic YAML/JSON fixtures were additionally parsed and structurally inspected. Exact file list and depth are in `/tmp/okf-tests-coverage.txt`. Initial outputs that truncated were followed with bounded reads of omitted regions; the remaining semantic fixture full-text pass completed on 2026-09-09. No tests or repository code were executed.

## Main conclusion for portable OKF support

The substantial semantic test suite tests Apache Ossie / OSI `0.2.0.dev0` and the tool-specific `0.2.0.dev0/google` extension, SQL property-graph lowering, and Knowledge Catalog publication/reconstruction. It is not an OKF portable-bundle conformance suite. No test in this scope names OKF, archive/ZIP intake, checksums, symlink/path-traversal handling, bundle-level collision resolution, or a three-way merge. Do not take semantic round-trip assertions as proof of lossless preservation of a portable knowledge bundle.

The narrower generic catalog/KB scenarios are the relevant evidence for Markdown/YAML snapshot conventions: `catalog.yaml` scope selects an entry group, BigQuery dataset, KB, or semantic model; ordinary catalog entries live at `catalog/<name>.yaml`, while KB entries live at `catalog/<name>.md`. This is still a cloud-scoped CLI workspace convention, not evidence that a local app must adopt that manifest as its portable bundle format.

## Generic catalog and KB behavior

- `tests/scenarios/init_kb.yaml:8`, `init_eg.yaml:8`, `init_bqds.yaml:12`: scope initialization is respectively `kb.<project>.<location>.<group>`, `entryGroup...`, `bq-dataset.<project>.<dataset>`.
- `tests/scenarios/pull_kb.yaml:29`: KB pull writes Markdown, maps entry source display name to `title`, description to `description`, and a string label value `true` into a tag. Names with `/` and dotted basenames map to nested Markdown filenames. Assertions are substring/existence checks, not full Markdown round-trip comparisons.
- `tests/scenarios/create_entry_hierarchy.yaml:14`: hierarchical local entry `aaa/bbb` creates `catalog/aaa/bbb.yaml`.
- `tests/scenarios/pull_parent_entry.yaml:1`: custom entry parent persists as bare local `parent: parent`. `pull_parent_ingested.yaml:1`: ingested groups intentionally omit parent because push cannot write it. Parent preservation therefore depends on source type.
- `tests/scenarios/pull_bq_multiple.yaml:41`: list scope supports multiple datasets, each mapped under `catalog/<project>.<dataset>`.
- `tests/scenarios/pull_bq_filtered.yaml:34`: snapshot entry-type filter can omit the dataset anchor while keeping table files.
- `tests/scenarios/push_filtered.yaml:32`: snapshot and publishing filters are distinct. Locally edited fields can remain unpublished; unselected remote aspect2 and other entry type remain unchanged while selected aspect1/resource is updated.
- `tests/scenarios/push_new_entry.yaml:23`: new local entry is created remotely and existing remote entry preserved. `push_validate_only_create.yaml:24` and `push_validate_only_update.yaml:25`: validate-only leaves staged local edits intact and does not mutate catalog.
- `tests/libts/layouts/standard.test.ts:40`: malformed YAML warns with filename and is omitted from index; good file remains indexed. This is tolerant indexing, not atomic import rejection.
- `tests/libts/scenarios.ts:123`: assertions support exact trimmed text, contains, notContains, existence, and null means absent. Remote expected entries use deep equality after JSON normalization. `mocks.ts:4` supplies explicit credentials to bypass gcloud.

## Semantic persistence and deliberate loss

- `tests/libts/semantic/osi_converter.test.ts:33`: serializer round-trip tests exclude non-GOOGLE vendor extensions. `:233` explicitly asserts they are dropped with warning because `/google` has no `custom_extensions` carrier. Loader preservation of vendor JSON at all levels (`loader.test.ts:722`) is therefore not end-to-end export preservation.
- `tests/libts/semantic/kc_converter.test.ts:1`: Knowledge Catalog round-trip preserves only a documented subset. Default push drops field/metric expressions and dimensions; even expression-enabled push loses imported vendor SQL, field AI context, model/entity/metric synonyms/examples, and many-to-many relationships. Entity keys, unique keys, field labels, and author-managed AI instructions do survive. Relationship names normalize to lowercase/hyphens (`:268`); type mapping collapses String and normalizes untyped fields (`:467`).
- `tests/libts/semantic/osi_schema.test.ts:48`: schema guard deliberately tolerates missing expressions in `.pull.golden.yaml`; it also folds `/google` surface back to vanilla, permits select extends/abstract/action/constraint deviations, and excludes profiles. Passing this suite must not be described as strict Apache OSI compliance of every artifact.
- `tests/libts/semantic/knowledge_catalog.test.ts:475`: entity names that sanitize to the same ID cause the later duplicate to be skipped with warning. A portable importer should not silently inherit this collision policy.
- `tests/libts/semantic/knowledge_catalog.test.ts:588`: purely logical relationships without join columns are skipped with warning. `:688`: abstract entities are skipped for KC. An ontology graph can therefore lose nodes/edges on this publishing route despite valid local representation.
- `tests/libts/semantic/semantic_model_layout.test.ts:32`: path is `catalog/EntryGroups/<group>/<model>.yaml`; slash in model name becomes underscore. `:68` explicitly asserts last-write-wins. `.profiles/*.yaml` are discovered separately; `.aspects.yaml` and unrelated groups are excluded (`semantic_model_scope.test.ts:53`).
- `tests/libts/semantic/resolve_profiles.test.ts:126`: selected binding profile clears inline bindings before overlay; omitted fields become unbound. Pruning drops unavailable fields, dependent metrics/relationships, and a whole entity whose key is unbound, with report. Abstract supertypes survive. This is physical deployment availability, not editing-conflict reconciliation.

## Cloud reconciliation semantics

- `tests/libts/semantic/deploy_knowledge_catalog.test.ts:172`: anchor-first writes, no provisioning on push. Init provisions entry group and custom types (`tests/tool/init_semantic_model.test.ts:67`); a 409 type exists may trigger template update, permission failures for optional types may warn while init continues.
- `deploy_knowledge_catalog.test.ts:199`: re-push upserts on create 409. Link refresh 404 or 403 after existing-link 409 is treated as success (`:257` onward), so successful push does not necessarily prove every remote link aspect was refreshed.
- `deploy_knowledge_catalog.test.ts:391`: removed owned child entries are deleted, other model entries untouched; empty owned prefix is guarded. Project number/ID differences are normalized for ownership. `:544` onward: owned stale links are reconciled using pre-write entities, including when both endpoints were removed; cross-model links are retained.
- `deploy_knowledge_catalog.test.ts:694`: replacing/removing a whole foreign model fails before mutation without `--force-remove`; force mode deletes foreign model entries/links before writing new model. Not a transactional multi-system import.
- `pull_kc.test.ts:1`: pull lists, hydrates semantic/schema/guidelines aspects, fetches links per entity, deduplicates by link name or endpoint fallback, and aborts on hydration/link fetch failure. Multiple model anchors in one group error; empty group returns no model plus warning; foreign entries ignored. Sole-anchor fallback retains a child whose parent differs by project spelling.
- `deploy_bigquery.test.ts:426`: failure after an earlier graph deployment reports already-deployed graphs and count; no rollback promise. BigQuery and Spanner tests cover polling, missing target, malformed URI, and failure handling. Validate-only tests assert no backend writes.

## Distinct semantic format scope

Loader tests enforce strict unknown keys/version errors, duplicate entity/field/metric/relationship names, FK endpoint and arity checks, seven expression dialects and ten datatypes, dialect fallback/import provenance, JSON accepted through YAML parsing, and source qualification using supplied defaults. Google-specific features include entities alias, deployment_target, abstract/extends, actions and constraints. Binding-only profiles reject declaration edits and arbitrary SQL expressions (`resolve_profiles.test.ts:149`).

Actions serialize executor metadata for MCP, REST, or gRPC; they do not execute those actions in these tests. Constraints keep expression text verbatim (`constraints.test.ts:92`) and publish as custom KC entries. Guard-name validation and parameter-read warnings are static checks; graph generators warn that actions and constraints do not deploy to either graph backend (`constraints.test.ts:428`). Do not present imported constraints as executable SQLite enforcement.

BigQuery fixtures exercise derived property lowering for aggregates, COUNT(*) lowering to key property, no cross-table aggregate measure, SQL quoting, fan-out-safe metric placement, inherited labels, keyless/abstract omission, and warnings. Spanner fixtures deliberately omit metrics/options and reduce source to bare table name. Transpiler keeps original imported SQL alongside generated form, preserves existing target expressions, warns on failure, and does not mutate input. These are optional semantic capabilities beyond a portable knowledge-file browser/editor.

OWL import is explicitly one-way and lossy (`owl_converter.test.ts:1`, `:923`): Turtle classes/properties map to logical entities/fields/relationships, source/expression/join bindings remain absent, known subclass links become extends, native keys and AI metadata map, and non-native OWL axioms are silently dropped. No reasoner or lossless ontology export is established.

## Review issues and evidence caveats

1. **Stale preservation comments contradict asserted behavior.** `fixtures/owl/carriage.owl.ttl:1`, `sales-advanced.owl.ttl:5`, and `hierarchy.owl.ttl:8` still claim non-native OWL is carried in custom extensions; `owl_converter.test.ts:923` asserts silent dropping. `fixtures/owl/sales.owl.ttl:9` and `org.owl.ttl:11` describe key-bound edges while current tests require both column lists empty. `kc_converter.test.ts:733` still lists keys/labels as lost despite current recovery tests. Use assertions/implementation, not these comments, when defining product guarantees.
2. **Catalog update mock has an indexing defect.** `tests/libts/mocks.ts:120` uses `for (const f in aspectKeys ?? [])`, iterating array indexes instead of aspect key values. Its modifyEntry counterpart at `:89` uses `of`. Tests going through updateEntry may model named-aspect updates incorrectly; this weakens confidence in that path even without executing the suite.
3. **Symmetry test reduces both sides.** `kc_converter.test.ts:800` and `:818` compare `stripToKcFloor` on both outputs and source. Useful for allowed-survivor regressions, but it masks divergence in intentionally stripped properties and is not a lossless round-trip proof. Targeted tests supply additional guarantees.
4. **No portable import correctness evidence.** No fixtures/assertions in this scope establish archive duplicate handling, raw unknown metadata retention, original byte retention, local conflict UX, identity stability across imports, filesystem escape protection, or SQLite transaction boundaries. These need a separate local-app contract and test suite.

All references above are relative to `toolbox/mdcode/` unless prefixed otherwise. Full exact coverage file lists repository-relative paths.
