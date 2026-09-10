# Mind maps

Use **Insert mind map** in the note toolbar or choose **Mind map** from the slash menu. Open **Edit mind map** for a focused fullscreen canvas. Maps belong to their notes, so they use the same local storage, sharing, history and backups as other content. They also work inside OKF documents.

## Capture ideas quickly

Start with a central idea. Select an idea and add a child to develop it, or a sibling for another idea at the same level. **Tab** adds a child and **Enter** adds a sibling when the canvas has focus. Text fields keep their normal editing behavior. Double-click an idea to edit its label.

Choose balanced branches on both sides or a layout extending to the right. Branches arrange automatically. Collapse a branch to reduce clutter; hidden ideas remain in the map and in outline exports. Branch colors help separate themes. Drag an idea onto another idea to change its parent, or use the parent selector. Cycles are rejected.

Arrow keys navigate the tree: left selects the parent, right expands a collapsed branch or enters its children, and up/down move between siblings. Undo/redo, duplicate branch, zoom, fit and the minimap help with larger maps. Deleting a branch removes its descendants; the central idea remains the map's root.

## Connect ideas to the workspace

Select an idea to link it to a note, a note block, an OKF document, an entire knowledge bundle, or a URL. Note/block/OKF document links contribute to the existing note backlinks. Use **Open linked target** or the preview's link actions to follow a reference.

A link keeps the referenced content in its original location; the map does not copy or merge that content. Renaming a linked note keeps its ID-based reference intact.

## Import, export and saving

Paste an indented Markdown outline to turn existing ideas into a tree. Review it before replacing the current map. Outline export includes collapsed branches. Native JSON retains the editable tree, links and display choices; SVG and PNG provide rendered copies.

For portable packages, use the note's **Markdown + assets ZIP** or a bundle's portable ZIP export. These include editable mind-map JSON and a PNG preview. Included OKF references become relative file links; references to excluded content are reported and retained. Native workspace backups preserve the original note source.

**Save mind map** writes the block back to the note. Inside an OKF document it updates the concept draft; use **Save concept** to persist body and metadata together. Unsaved maps have browser draft recovery and conflict checks. Recovery never silently replaces newer saved content, and clearing browser data removes these unsaved drafts.

Maps are stored in fenced `thread-mindmap` JSON blocks, with up to 300 ideas and 1 MB of JSON. The semantic parent/child tree is stored separately from its derived screen positions. Ordinary Markdown and block editing preserve the native map data.

The canvas uses the existing [React Flow](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow) dependency. Existing MCP note tools can read, create and edit native mind-map blocks as Markdown; the structured diagram proposal tools continue to address diagram blocks specifically.
