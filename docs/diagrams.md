# Visual diagrams

Insert a **Visual diagram** from the note toolbar or slash menu, then choose **Edit diagram** to open the fullscreen canvas. Diagrams also work inside knowledge bundle documents. Existing diagrams open in the new editor; saving upgrades their fenced `thread-diagram` JSON to version 2.

## Shapes and connections

Drag a shape from the palette or use its Add button. Available shapes include process, decision, database, text, terminator, ellipse, document, annotation, group, swimlane and image. Resize selected shapes using their handles or the inspector's dimensions. Double-click a label to edit it directly; Cmd/Ctrl+Enter finishes the label. The inspector controls label font size, weight, alignment and colors, and offers fit-to-text.

Connect shapes using handles on any of their four sides, or use the source/target selectors. Select a connector to change its label, route (curved, straight or orthogonal), color, width, dashes and start/end markers. Reconnect an existing edge by dragging its endpoint.

Select multiple shapes to apply styles together, align or distribute them. Grouping creates a frame whose children move with it. Swimlanes provide a labeled background for related steps. Lock background shapes when arranging the foreground. Top-down and left-to-right automatic layout preserve locked positions; grid snapping and alignment guides help with manual placement.

Use search to find labeled shapes, zoom to the selection, or use the minimap and Fit controls. Canvas position and zoom are remembered in this browser. The Shapes and Inspector buttons collapse panels on smaller screens.

## Shortcuts

Shortcuts apply while the diagram canvas has focus; normal text shortcuts remain available inside fields.

| Shortcut                      | Action                                |
| ----------------------------- | ------------------------------------- |
| Cmd/Ctrl+S                    | Save diagram                          |
| Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z | Undo / redo                           |
| Cmd/Ctrl+A                    | Select all                            |
| Cmd/Ctrl+C / Cmd/Ctrl+V       | Copy / paste selected diagram content |
| Cmd/Ctrl+D                    | Duplicate selection                   |
| Cmd/Ctrl+G / Cmd/Ctrl+Shift+G | Group / ungroup                       |
| Delete / Backspace            | Delete unlocked selection             |

Copying a selection includes its internal connectors and remaps IDs when pasted. The canvas context menu exposes common selection actions. Typing and dragging are grouped into undo steps.

## Links and local attachments

The inspector's **Link shape** section links a shape to an ordinary note or OKF note, optionally to a block ID, or to a URL. Follow links from the diagram preview or the editor's **Open linked target** action. Note links also contribute to the existing backlinks and graph.

Under **Templates, files and exports**, **Upload image or file** stores an attachment in the workspace. PNG, JPEG, GIF and WebP become image shapes; other files become linked document cards. Files use the existing authenticated local attachment storage.

Diagram images have a 10 MB limit each. Embedded export content is limited to 30 MB, counting repeated image occurrences. Image dimensions must be at most 8,192 pixels per side and 32 megapixels in total. Other attachments retain the existing 20 MB upload limit. Missing or unsupported images produce an export error instead of an incomplete successful download.

## Templates and files

Built-in templates cover flows, decisions, data pipelines, architecture, approvals, knowledge maps and swimlanes. Inserting into a populated canvas keeps the existing content. Replacement requires an explicit choice.

Select a reusable group of shapes, enter a template name and choose **Save selection as template**. Saved templates are shared by workspace users and included in workspace backups.

**Import JSON** validates a Thread diagram and shows a preview before insertion or replacement. **Export JSON** preserves editable structure; its attachment references still refer to their workspace or bundle. Use **Markdown + assets ZIP** or the bundle's portable ZIP export to package attachments with editable JSON sidecars and PNG previews. Included bundle note links become file links; unresolved links are reported. Export creates a copy and does not rewrite stored notes.

Direct **SVG** and **PNG** exports embed diagram images and offer a white or transparent background. PNG supports 1×–4× resolution, subject to raster size limits. SVG and PNG are rendered images, not editable Thread document imports.

## Saving and recovery

**Save diagram** writes the diagram back into its note. For ordinary notes this also flushes the normal disk save. In an OKF document it updates the local concept draft; choose **Save concept** to persist the body and metadata together.

Closing a changed canvas asks before discarding. Unsaved canvas drafts are stored in this browser and offered for recovery after a reload. Recovery does not silently overwrite newer saved content; conflicts require an explicit decision. Browser recovery is a convenience, not a replacement for workspace backups, and clearing site data removes these unsaved drafts.

Diagrams support up to 300 shapes, 1,000 connectors and 1 MB of JSON. Selection, canvas measurements and other temporary editor state are not stored in the Markdown document.

## AI proposals through MCP

The existing MCP connection exposes three additional tools:

| Tool                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `list_diagrams`          | List diagrams in a note with its current revision                           |
| `read_diagram`           | Read a diagram by its note ID and zero-based diagram index                  |
| `propose_diagram_update` | Submit a complete replacement diagram and summary against the revision read |

A proposal does not change the note. Open its diagram editor, choose **Review**, compare the current and proposed diagrams, then explicitly apply or reject it. Save or discard local edits before applying. A changed note revision makes an old proposal conflict; the agent should read again and prepare a fresh proposal. Applying preserves unrelated note text and normal history, including OKF review policy.

Structured proposal tools cannot apply their own proposals or delete content. Existing `update_note` authorization remains available for ordinary Markdown editing. Proposals for diagrams nested inside lists or quotes can be read, but the server currently rejects their application; use the visual editor for those diagrams. Restoring a workspace marks restored pending proposals stale so they cannot accidentally apply to restored content.
