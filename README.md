# Thread

A local notes workspace inspired by [SiYuan](https://github.com/siyuan-note/siyuan), with rich Markdown blocks, connected notes, and a visual diagram editor.

## Run locally

Requires **Node.js 22.13 or newer** and npm (tested with Node 26.8). Google Chrome is needed only for browser tests.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Keep the terminal running. The first visit creates an administrator account with a username and password. Existing password-only workspaces migrate automatically to username `admin`, keeping the same password and notes. Existing notes from the previous browser version migrate on the first unlock at the same address. Their original browser data is preserved. If migration cannot read it, the app offers a recovery download and an empty workspace.

Notes now live in **`~/Documents/Thread Workspace`**. This directory contains SQLite data, Markdown mirrors, attachments, and backups. Browser/site-data deletion does not delete this disk workspace. Markdown files are readable mirrors; edits should be made through Thread or imported, because external file changes are not automatically read back into the database.

For a production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4317**. Set `THREAD_DATA_DIR` to select another data directory and `THREAD_PORT` to change the production port. Development uses `THREAD_API_PORT` (4317) and `THREAD_UI_PORT` (5173). The service listens on loopback only.

## Accounts and recovery

Accounts share one workspace. **Admins** manage accounts and MCP keys, delete notes, and restore backups. **Users** read, create and edit notes, including diagrams, and can change their own password. Create accounts in **Workspace settings → Users**; give each person their username and temporary password privately. Usernames are case-insensitive. Accounts can be disabled, their passwords reset, and roles changed. At least one active admin must remain.

Passwords are salted scrypt hashes. HttpOnly sessions expire after 12 hours, login attempts are rate-limited, and **Lock** signs out. Changing a password revokes that account's other sessions and MCP keys. Disabling an account or changing its role also revokes its sessions and keys. Expired sessions preserve unsaved editor drafts for reauthentication with the same account.

Authentication controls app access; it does not encrypt the files on disk. For local administrator recovery, stop the server and run:

```sh
npm run reset-password -- admin
```

Replace `admin` if you chose another administrator username. Type `RESET` when prompted. The command displays a new random temporary password; restart Thread, sign in and change it in **Workspace settings → Password**. Notes and other accounts remain intact. Set `THREAD_DATA_DIR` consistently if using a custom directory.

Accounts, password hashes, sessions and MCP keys are excluded from portable workspace backups. Restoring a backup preserves the destination workspace's access controls.

## MCP for AI agents

Thread includes a local **stdio MCP server** using the official MCP SDK. Start Thread, then open **Workspace settings → MCP** as an admin. Create a named agent key, copy it once, and copy the generated configuration into your MCP client's private settings. It provides the absolute script path for this installation:

```json
{
  "mcpServers": {
    "thread": {
      "command": "node",
      "args": ["/absolute/path/to/thread/server/mcp.mjs"],
      "env": {
        "THREAD_API_URL": "http://127.0.0.1:4317",
        "THREAD_MCP_TOKEN": "PASTE_YOUR_AGENT_KEY_HERE"
      }
    }
  }
}
```

Use Node 22.13 or later; use an absolute Node executable path if your client cannot find `node`. Adjust the API port for custom installations. The app must stay running; the bridge does not start the app. Clients with a different configuration format can use the same command, arguments and environment variables. Keep real keys out of Git. Revoking a key in settings takes effect on the next request.

| Tool           | Capability                                           |
| -------------- | ---------------------------------------------------- |
| `list_notes`   | Paginated active note summaries, up to 100 per call  |
| `search_notes` | Search note titles and Markdown; paginated summaries |
| `read_note`    | Read an active note's Markdown by ID                 |
| `create_note`  | Create a new note using `title` and Markdown `body`  |
| `update_note`  | Edit title/body with a required revision check       |

`update_note` edits an active note's title and/or Markdown body. First call `read_note`, then pass its `revision` as `baseRevision` together with `id` and the fields to change. Omitted fields remain unchanged. A stale revision returns a conflict; read again and reconcile instead of overwriting newer changes. Every edit preserves normal note history. Existing agent keys also permit editing.

Diagram tools `list_diagrams`, `read_diagram`, and `propose_diagram_update` let agents inspect diagrams and submit revision-checked proposals. People compare and explicitly apply proposals in the visual editor; proposals do not change notes automatically. See the [diagram MCP workflow](docs/diagrams.md#ai-proposals-through-mcp).

Agents cannot delete notes, access trash, restore backups, or manage accounts. Agent keys are hashed and only accepted by a separate allowlisted API; ordinary app routes require a human session. Note IDs are generated by the server, so creation cannot overwrite another note. Retrying a successful create produces another note. Agent-created notes appear through the existing workspace refresh and retain normal history. This integration is local stdio, with no remote HTTP MCP endpoint.

## Knowledge bundles (OKF)

**Knowledge bundles** live alongside ordinary notes and notebooks. Create an empty bundle, copy selected notes, or import a folder/ZIP. Concepts have stable paths, Markdown bodies and preserved YAML metadata. Edit common fields in the metadata panel or use full source; inspect relationships, review status and maintenance diagnostics in the bundle views.

Imports preview files and conflicts before applying changes. Re-import supports keep, update and copy; missing incoming files are retained. Renames update references while preserving note history. Original ZIP export retains authored source and assets; portable ZIP export converts included Thread links and adds diagram images with editable JSON sidecars, reporting unresolved references. Workspace backups also retain bundle mappings and history.

The existing MCP server adds `list_bundles`, `read_bundle_index`, `list_concepts`, `read_concept`, `create_bundle`, `create_concept`, `update_concept` and `validate_bundle`. Writes require revisions. Agents cannot delete bundle content, claim human verification or execute computations. Existing account and agent-key permissions remain in force.

See [the bundle guide](docs/okf-bundles.md) for authoring, review, imports, export modes and compatibility with OKF v0.2. Google publishing, automatic Git synchronization and computation execution are not included.

## Writing and diagrams

- **Edit blocks** opens formatted block editing. Double-click a block or use its pencil. The toolbar supports headings, emphasis, lists, tasks, links, tables, and highlighted code. **Source** preserves exact Markdown for unsupported formatting.
- Type **/** for structures and developer/product templates, **@** for note or block references, and **#** for tags. Arrow keys choose suggestions; Enter/Tab inserts; Escape dismisses.
- Use **Attach files** (the paperclip in the note toolbar) in preview, Markdown, or block mode to upload images and documents. Select multiple files at once; images appear inline and documents become download links at the end of the note. Files are stored in the local workspace's `assets/` directory and included in ZIP backups, with a 20 MB limit per file. No cloud storage is required.
- Drag a block by its handle to reorder it. Block actions also support move, duplicate, delete, undo, and copying references/live embeds. Paste or drop images/files into the block editor to save local attachments (20 MB each).
- Choose **Insert visual diagram** in the note toolbar or `/Visual diagram`. **Edit diagram** opens a fullscreen visual canvas built with [React Flow](https://reactflow.dev/). Resize and group shapes, build swimlanes, style and reconnect edges, use automatic layout, link notes, upload images and documents, and save shared templates. The canvas supports multi-selection, copy/paste, draft recovery, and direct SVG/PNG/JSON export. **Save diagram** commits changes; closing prompts before discarding edits.
- Diagrams are stored as fenced `thread-diagram` JSON blocks in Markdown. They remain editable after reload and backup restoration. This feature does not use Mermaid. Each diagram supports up to 300 shapes and 1,000 connectors. See the [diagram guide](docs/diagrams.md) for tools, shortcuts, local images, portable exports and AI proposals.
- **Insert mind map** or `/Mind map` opens a tree for rapid idea capture, with child/sibling shortcuts, automatic branches, collapse/expand, links to notes and OKF bundles, and outline import/export. See the [mind map guide](docs/mindmaps.md).
- Stable block IDs live in Markdown comments. References use `@[label](block:noteId/blockId)`; live embeds use `![[noteId#blockId]]`. Hover/focus previews show referenced text. Missing and circular embeds are handled explicitly.
- **Edit Markdown** remains available for the full source. The document-context dock shows headings and incoming/outgoing references, follows the active pane, and can open linked notes beside it.

## Organizing and comparing

Create or rename notebooks above the note tree. Each note has notebook and parent-page selectors; nesting is validated to prevent cycles. Deleting a parent promotes its child pages. Open notes have tabs with arrow-key navigation and close buttons. Choose **1–3 panels**; drag their separators or use Left/Right while a separator has focus. Tabs, pane sizes, and layout persist.

**Table view** edits status, priority, owner, due date, and custom properties. Configure columns, sorting and filters, then save a named view. **Graph view** lays out note/block relationships and shared-tag hubs. Drag nodes, pan/zoom, inspect neighborhoods, and save positions; a keyboard-accessible explorer provides the same note navigation.

**Compare notes** aligns lines across the open panes, highlights changed words, synchronizes scrolling, and navigates changes. **Find in note** cycles through matches. **Focus mode** uses Cmd/Ctrl+Enter; Escape exits. Dark, light, and system themes remain available.

Workspace search uses SQLite FTS5 for note titles, text, tags, and linked-note titles. Words are matched as prefixes; multiple words are combined. Filters support exact tags and inclusive created/modified date-and-hour ranges in your local timezone. Cmd/Ctrl+K focuses search. Large note lists display 200 entries at a time with a Show more control.

## Saving, backup, and export

Ordinary note edits save to SQLite after a short typing pause, with a visible save status and Markdown mirrors. Bundle concepts use an explicit **Save concept** action so body and metadata changes are saved together. Revisions prevent silent overwrites across open sessions. Unsaved drafts remain available for retry; closing with unsaved edits warns before leaving. This is conflict detection, not simultaneous collaborative editing or cloud sync.

**Workspace settings** provides:

- Full ZIP backups containing notes, attachments, history, diagrams, notebooks, and settings.
- Automatic snapshots every 15 minutes and on server startup, retaining the latest 24 snapshots. Manual snapshots and downloadable backups are also available.
- Full ZIP restore, validating the archive before changes and creating a recovery snapshot first.
- Persistent trash and note restoration.
- Up to 200 saved historical versions per note, with preview and restore.

**Import** accepts `.md` and legacy `.json` note backups; matching IDs are preserved. Use **Restore ZIP** in settings to replace the complete workspace.

The note download menu offers:

- **MD** — original Markdown with title.
- **Markdown + assets ZIP** — Markdown, local attachments, editable diagram JSON, and PNG previews. Note/block references still require their source workspace notes.
- **DOCX** — editable text, headings, lists, tasks, tables, links, code, and embedded images/diagrams.
- **PDF** — direct multipage download preserving visual layout. Pages are rasterized, so PDF text is not selectable; external links remain clickable. Use DOCX for editable text.

## Verification

```sh
npm test
npm run test:e2e
npm run build
npm run benchmark
```

Browser suites use temporary data directories and isolated ports; they do not reset the real workspace. The standalone durability suite can run with `npx playwright test --config tests/durable.config.js`. Component harnesses use Vite on port 5173.

Tests cover authentication, process-restart persistence, save conflicts, backup validation/rollback, history/trash, rich edits and paste uploads, diagrams, notebooks/layout, reference embeds, property views, graph interactions, comparisons, and export contents. PDF pages were also rendered with Poppler for visual inspection. DOCX structure/media are checked; visual pagination can vary by Word installation.

The local 5,000-note benchmark returned 715 matching records in approximately 2 ms; import took about 2.4 seconds. The 5,000-node graph opened in about half a second in Chrome. These are development-machine measurements, not performance guarantees.
