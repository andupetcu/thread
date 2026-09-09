# Verification — 9 September 2026

The app was built from an empty workspace. The original feature scope is mapped below to implementation and observed behavior.

| Requirement                         | Implementation and evidence                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local developer-style notes app     | React/Vite workspace, browser-local persistence, slate/indigo UI. Dark, light, and mobile screenshots inspected. Editing survives reload in Chrome.                                                                                          |
| Markdown and slash commands         | Rendered GFM preview, Markdown source editor, formatting toolbar. Browser test inserts every one of the 27 command templates and checks exact source.                                                                                        |
| Mentions and autocomplete           | Stable `note:id` links, filtered @ palette, current-title rendering, outgoing links and backlinks. Browser test inserts a mention, renames the target, and verifies its new label. Unit test verifies search by the renamed target.          |
| Hashtags and autocomplete           | # palette, derived tag chips, tag explorer with counts, exact-tag filters. Browser insertion and model extraction/filter checks pass.                                                                                                        |
| Graph and relationship explorer     | Interactive SVG graph, highlighted relationships, zoom, reset, pan, node inspection and navigation. Graph screenshot inspected; browser verifies node count, zoom, inspector neighbors, and opening a note.                                  |
| Table view                          | Notes, tags, links, created/modified timestamps, words, and sorting. Browser verifies rows and filters.                                                                                                                                      |
| Dev/product sections                | 27 templates cover basic Markdown, PRD, ADR, API reference, RFC, user story, roadmap, sprint, research, meetings, retrospective, bugs, tests, release notes, runbooks, incidents, and checklists. Exact insertion tested for every template. |
| Focus mode                          | Navigation-free workspace; toolbar, Cmd/Ctrl+Enter, and Escape controls. Browser verifies sidebar hiding and restoration.                                                                                                                    |
| Dark/light/system                   | Persistent theme preference with live OS media-query subscription. Browser verifies explicit light theme and both OS changes while System is selected.                                                                                       |
| PDF export                          | Print-only document generated from rendered note. Browser verifies print invocation and table; generated A4 PDF rendered and visually inspected, and text extracted with Poppler.                                                            |
| DOCX export                         | Word headings, emphasis, tables, lists, tasks, and code converted from rendered tree. Download ZIP XML checked for real table and bold elements, with no raw emphasis syntax. Production build download also verified.                       |
| Markdown export                     | Source and title downloaded as `.md`; browser download flow verified.                                                                                                                                                                        |
| 1/2/3 note panels                   | Toolbar layout controls and independent note selector per pane. Browser verifies two and three panels and edits a target in the third.                                                                                                       |
| Compare two or three notes          | Live line diffs compare additional panes against the named first-pane baseline; additions/removals colored. Browser verifies two-pane comparison and both three-pane comparisons.                                                            |
| Responsive, real-time behavior      | Controlled React editing, immediate derived views and persistence. Browser editing/completion tests pass; mobile has no document overflow. Main browser workflows run in under two seconds each on this machine.                             |
| Search within notes                 | Find bar selects matching source text, supports Next/Enter. Browser checks selected text.                                                                                                                                                    |
| Search titles/content/mentions/tags | Model tests cover fields; browser searches code content and confirms one result.                                                                                                                                                             |
| Filter by date and hour             | Inclusive datetime-local bounds on created or modified timestamps. Unit bounds checks and browser future-date exclusion pass.                                                                                                                |
| Additional useful tools             | Pinning, JSON backup, Markdown/JSON import, delete undo, word counts, recovery download, storage-error reporting. Browser verifies backup JSON, Markdown import, undo, and failure status.                                                   |

## Final checks

- `npm test`: 7 model tests passed.
- `npx playwright test`: 9 browser workflows passed.
- `npm run build`: production bundle passed.
- Production preview at port 4173: DOCX download, seven graph nodes, zero page errors.
- `npm audit --omit=dev`: zero vulnerabilities.
- Two-tab independent-edit regression: ten consecutive passes after the initialization-save fix; also reviewed independently.

## Review fixes

Independent review found and verified fixes for stale-tab saves, damaged-data recovery, autocomplete visibility in long notes, code-literal preservation, hidden-sidebar search focus, and misleading saved status after an error is dismissed. Regression tests cover these paths.

## Operating boundaries

Storage belongs to the browser profile and exact origin. Backups are explicit JSON downloads; JSON import adds missing IDs and preserves existing records. No cloud sync is provided. Avoid simultaneous edits to the same note in multiple tabs. PDF export uses the browser's Save as PDF workflow. The app is served locally, not installed as a native desktop application.

Browser artifacts are generated under `test-results/` on each full test run. `README.md` documents startup and all controls.

## SiYuan-inspired update

Reference: https://github.com/siyuan-note/siyuan. Reviewed its README, workspace screenshot, block editing/outline/reference patterns; implementation is original to Thread.

- Added inline block Markdown editing, immediate persistence, shared command/mention/tag completion, structural move/duplicate/delete, and undo.
- Added active-pane document context with heading navigation, backlink/outgoing excerpts, and open-beside controls.
- Verified outlines during active block edits, mobile drawer behavior, and existing source/export workflows.
- Parsed block boundaries preserve fenced code and nested lists. Regressions cover paragraph merging, duplicated lists/quotes, and unfinished backtick/tilde fences.
- Latest verification: **15 model tests, 14 browser workflows, production build passed**. Existing export, storage, graph, theme, search, and comparison tests remain green.
- Desktop block and reference screenshots inspected; mobile screenshot checked after the dock adaptation.
