# Mind maps

In ordinary notes, editing keeps visual blocks rendered. Choose **Code edit** in the note editing controls for the complete Markdown source, or edit an individual visual block and choose **Code edit** for that block alone.

Choose **Insert mind map** or `/Mind map`, then **Edit mind map**. Thread opens the native Drawnix canvas fullscreen. Use its mind-map tool, select an idea, and use native keyboard shortcuts such as **Tab** to add a child. Drawnix manages branch layout, text editing, selection, undo/redo, themes, and image tools. **Fit map** brings the content into view, including after resizing to a smaller screen.

## Capture and connect

Use **Import Markdown** to paste an outline, review it, and replace the current canvas with a native mind map. You can also import and export editable `.drawnix` JSON files. The editor runs locally as part of Thread.

Open **Mind map tools** to add references to ordinary notes, note blocks, OKF documents, entire bundles, or web pages. Selected native elements can be associated with references; the saved preview exposes reference buttons. Note and document references contribute to Thread backlinks. Save or close edits before navigating away.

## Save, recover, and export

**Save mind map** writes the native Drawnix document and a PNG preview into the note. Inside an OKF document it updates the concept draft; **Save concept** persists the body and metadata together. Unsaved browser drafts offer explicit recovery, and changed saved content requires conflict review.

Export native `.drawnix` or PNG from the editor. Portable note and OKF ZIP exports retain editable `.drawnix`, the Thread reference envelope, and a saved PNG preview when available. References to included OKF content become relative addresses; excluded targets are reported. Workspace backups retain the complete original note source.

Mind maps use the existing local workspace's sharing, permissions, history, and backups. MCP note tools can read and author the native fenced source.

The `thread-mindmap` fence stores a version-2 envelope with `engine:"drawnix"`, native `elements`, optional viewport/theme/PNG preview, and Thread references. This directly replaces the previous custom tree format; no conversion layer is included. Drawnix and its compatible Plait dependencies are pinned in the package lockfile.
