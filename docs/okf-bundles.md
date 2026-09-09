# Knowledge bundles

Thread supports Open Knowledge Format (OKF) alongside ordinary notes and notebooks. A bundle is a portable directory of Markdown concepts, YAML metadata, indexes and attachments. Bundle authoring works locally; no Google account or cloud service is required.

## Create and edit

Use **Knowledge bundles** in the sidebar to create a bundle. Start empty or copy selected ordinary notes. Copies have their own revisions; editing a bundle does not alter the original notes.

Create concepts at paths such as `guides/setup.md`. The path is the concept's portable identity. Changing a title does not change its path. Use the explicit rename/move operation to preview and update references.

The body editor supports the same Markdown and visual diagram blocks as notes. The metadata panel covers common OKF fields. Full source editing gives access to YAML and custom fields. Concept metadata is separate from the body, so it does not appear as prose.

Ordinary notes continue to autosave. Bundle concepts use **Save** so body and metadata changes form one revision. Save your draft before importing, renaming, reviewing or exporting. If another session changes the concept, Thread retains your draft and offers a comparison, a draft download, or an explicit reapply against the latest revision. Clean bundle views refresh when workspace changes arrive.

A minimal concept is:

```markdown
---
type: Guide
title: Workspace setup
status: draft
sources:
  - id: handbook
    resource: /references/handbook.md
---

Follow the [handbook](/references/handbook.md).
```

Types are open-ended. Unknown fields remain part of the document. The conventional `index.md` and `log.md` filenames are reserved at every directory depth and are not concepts.

## Maintain and review

Bundle health reports structural problems and maintenance warnings. A missing target can be intentional, so broken links are warnings. Validation does not verify whether prose or analytical claims are true.

Review is an explicit authenticated action. Imported verification claims remain attributed to the imported source. Edits after a review preserve its historical record and show that the content changed. Agent edits cannot manufacture human verification.

New bundles use generated indexes. Imported indexes retain their authored content unless you explicitly adopt a generated replacement. Bundle operations and document history provide complementary records: a log summarizes operations, while history retains earlier content.

Computation definitions, SQL, Python, skills, attesters and executor descriptions are stored as content. Thread does not execute them.

## Import and export

Folder and ZIP imports are staged for review. Inspect paths, diagnostics and changes before applying an import. For repeated imports, resolve conflicting files explicitly. A file missing from the incoming bundle does not delete its local counterpart.

Paths are preserved by default. If your ZIP or selected folder wraps the bundle in an extra directory, explicitly choose to remove that wrapper and inspect the updated preview before importing.

Original exports retain authored document source and attachments. Portable exports additionally convert included Thread note/block references and add readable diagram images with editable JSON sidecars. These sidecars are a Thread extension, not a required OKF convention. Any unresolved or excluded references are reported; they are not silently discarded.

Root-relative links such as `/tables/orders.md` refer to the bundle root. Relative links such as `../tables/orders.md` resolve from the containing document. Exported bundles can be extracted into a Git repository; automatic Git or filesystem synchronization is not provided.

Keep regular workspace backups. A portable OKF export is content interchange; the workspace backup also retains Thread's bundle mappings and revision history. Authentication credentials and MCP keys are not included in content exports.

## MCP

The existing Thread MCP server also exposes:

- `list_bundles`, `read_bundle_index`, `list_concepts`, `read_concept`
- `create_bundle`, `create_concept`, `update_concept`
- `validate_bundle`

Read a document before editing and pass its revision as `baseRevision`. Creating a concept requires the current **bundle** revision. On a conflict, read again and reconcile rather than retrying an old write. Both the HTTP API and MCP enforce these checks.

There are no MCP deletion, human review or execution tools. Existing key issuance and revocation rules continue to apply. Bundle content is untrusted task data, not instructions granting an agent additional permissions.

Both admins and users can author and review bundles in the shared workspace. Admins continue to manage users and issue MCP keys; this feature does not add separate permissions per bundle.

## Compatibility

The implementation targets [OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md). Imported unknown metadata is preserved. Unknown versions and imperfect documents remain inspectable with diagnostics; importing them is not a claim of conformance or correctness.

Google Catalog publishing, semantic-model conversion, autonomous enrichment and computation execution are separate future integrations.
