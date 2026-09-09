# Accounts and MCP implementation

Goal: shared workspace with simple admin/user accounts and agent read/create/edit access, never deletion.
Architecture: SQLite account/session migration; role checks in HTTP API; hashed, revocable agent keys; official MCP stdio bridge using a separate allowlisted API.
Tech stack: existing Node SQLite/React, official MCP TypeScript SDK (JavaScript entry point), Zod.
Constraints: preserve existing password as admin and all notes; no credentials in backups or Git; admin manages users and keys; user edits shared notes; agent can only list/search/read/create/edit active notes (edits require a current revision).

- [x] Add regression tests for legacy migration, account permissions and revocation.
- [x] Implement accounts, role checks and local recovery.
- [x] Implement scoped agent API, stdio MCP and real protocol tests.
- [x] Add login username, admin account/key settings and role-aware controls.
- [x] Document setup and boundaries; run unit/browser/build and secret checks.

Validation: 108 unit/integration tests, including a real MCP stdio client; browser suites cover accounts, access changes, editor/diagram/export flows and durability. Production build succeeds. Gitleaks found no secrets. Existing local database was snapshotted before migration; all five note records were retained.
