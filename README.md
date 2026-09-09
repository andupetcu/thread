# Thread

A local notes workspace inspired by [SiYuan](https://github.com/siyuan-note/siyuan), with rich Markdown blocks, connected notes, and a visual diagram editor.

## Run locally

Requires **Node.js 22.13 or newer** and npm (tested with Node 26.8). Google Chrome is needed only for browser tests.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Keep the terminal running. The first visit asks you to create a workspace password; there is no preset password or account. Existing notes from the previous browser version migrate on the first unlock at the same address. Their original browser data is preserved. If migration cannot read it, the app offers a recovery download and an empty workspace.

Notes now live in **`~/Documents/Thread Workspace`**. This directory contains SQLite data, Markdown mirrors, attachments, and backups. Browser/site-data deletion does not delete this disk workspace. Markdown files are readable mirrors; edits should be made through Thread or imported, because external file changes are not automatically read back into the database.

For a production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4317**. Set `THREAD_DATA_DIR` to select another data directory and `THREAD_PORT` to change the production port. Development uses `THREAD_API_PORT` (4317) and `THREAD_UI_PORT` (5173). The service listens on loopback only.

## Password and recovery

One shared password controls access to the workspace and attachments. Passwords are stored as salted scrypt hashes; sessions use HttpOnly cookies and expire after 12 hours. Failed login attempts are rate-limited. **Lock** signs out; **Workspace settings → Password** changes the password and signs out other sessions. If a session expires during editing, unlocking preserves the current drafts.

The password protects app access; it **does not encrypt files on disk**. Your operating-system account protects the data directory. If you forget the password, stop the server, run the following command, type `RESET` when prompted, and restart:

```sh
npm run reset-password
```

Use the same `THREAD_DATA_DIR` if you configured one. Notes, assets, and history remain intact.

## Writing and diagrams

- **Edit blocks** opens formatted block editing. Double-click a block or use its pencil. The toolbar supports headings, emphasis, lists, tasks, links, tables, and highlighted code. **Source** preserves exact Markdown for unsupported formatting.
- Type **/** for structures and developer/product templates, **@** for note or block references, and **#** for tags. Arrow keys choose suggestions; Enter/Tab inserts; Escape dismisses.
- Drag a block by its handle to reorder it. Block actions also support move, duplicate, delete, undo, and copying references/live embeds. Paste or drop images/files into the block editor to save local attachments (20 MB each).
- Choose **Insert visual diagram** in the note toolbar or `/Visual diagram`. **Edit diagram** opens a fullscreen visual canvas built with [React Flow](https://reactflow.dev/). Drag process, decision, database, or text shapes onto it; connect handles or use connection selectors; edit labels and colors; use templates, undo/redo, zoom, and fit. **Save diagram** commits changes; closing prompts before discarding edits.
- Diagrams are stored as fenced `thread-diagram` JSON blocks in Markdown. They remain editable after reload and backup restoration. This feature does not use Mermaid. Each diagram supports up to 300 shapes and 1,000 connectors.
- Stable block IDs live in Markdown comments. References use `@[label](block:noteId/blockId)`; live embeds use `![[noteId#blockId]]`. Hover/focus previews show referenced text. Missing and circular embeds are handled explicitly.
- **Edit Markdown** remains available for the full source. The document-context dock shows headings and incoming/outgoing references, follows the active pane, and can open linked notes beside it.

## Organizing and comparing

Create or rename notebooks above the note tree. Each note has notebook and parent-page selectors; nesting is validated to prevent cycles. Deleting a parent promotes its child pages. Open notes have tabs with arrow-key navigation and close buttons. Choose **1–3 panels**; drag their separators or use Left/Right while a separator has focus. Tabs, pane sizes, and layout persist.

**Table view** edits status, priority, owner, due date, and custom properties. Configure columns, sorting and filters, then save a named view. **Graph view** lays out note/block relationships and shared-tag hubs. Drag nodes, pan/zoom, inspect neighborhoods, and save positions; a keyboard-accessible explorer provides the same note navigation.

**Compare notes** aligns lines across the open panes, highlights changed words, synchronizes scrolling, and navigates changes. **Find in note** cycles through matches. **Focus mode** uses Cmd/Ctrl+Enter; Escape exits. Dark, light, and system themes remain available.

Workspace search uses SQLite FTS5 for note titles, text, tags, and linked-note titles. Words are matched as prefixes; multiple words are combined. Filters support exact tags and inclusive created/modified date-and-hour ranges in your local timezone. Cmd/Ctrl+K focuses search. Large note lists display 200 entries at a time with a Show more control.

## Saving, backup, and export

Edits save to SQLite after a short typing pause, with a visible save status and Markdown mirrors. Revisions prevent silent overwrites across open sessions: a conflict offers the disk version, local replacement, or a separate local copy. Unsaved drafts remain available for retry; closing with unsaved edits warns before leaving. This is conflict detection, not simultaneous collaborative editing or cloud sync.

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
