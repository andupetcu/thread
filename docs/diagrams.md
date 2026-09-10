# Visual diagrams

In ordinary notes, editing keeps visual blocks rendered. Choose **Code edit** in the note editing controls for the complete Markdown source, or edit an individual visual block and choose **Code edit** for that block alone.

Choose **Insert visual diagram** or `/Visual diagram`, then **Edit diagram**. Thread opens its locally served draw.io editor fullscreen. Use draw.io's shape libraries, connectors, grouping, alignment, layers, pages, and text tools. **Save diagram** saves the native XML and a PNG preview into the note. The inline preview loads without starting the full editor.

## References and files

Open **References and library** to link notes, note blocks, OKF documents, whole bundles, or web pages. References appear below the saved preview and contribute to Thread backlinks. To make a draw.io shape open a reference, copy the displayed `thread:…` address into that shape's native link field. Save or close your current edits before following a workspace reference.

Import `.drawio`, uncompressed `.xml`, or a Thread diagram JSON envelope. Review replacement before applying it to the canvas. Export editable `.drawio`, SVG, or PNG. Draw.io's native image tools can embed local images in its XML. Thread does not require a cloud storage account.

Save named shared templates in the library and load them through the same replacement review. The editor uses draw.io's own tools for manipulating and styling the canvas.

## Saving and recovery

Edits remain in the editor until **Save diagram**. Unsaved source is also kept as a browser recovery draft where browser storage is available. Closing a changed diagram asks before discarding. If the saved note changes in another session, explicitly choose the latest saved source or your retained draft before saving again.

Inside an OKF document, **Save diagram** updates the concept draft. **Save concept** persists the body and metadata together. Browser recovery remains until that outer save succeeds.

Portable note and OKF packages retain the editable native `.drawio` file, the Thread JSON envelope, and the saved PNG preview when available. Agent-created XML can lack a preview; open and save it to generate one. Included OKF references are rebased to portable files; references to omitted content are reported.

## AI proposals through MCP

`list_diagrams` and `read_diagram` return native diagram envelopes. `propose_diagram_update` accepts `{version:3,engine:"drawio",xml,references,preview?}` with the note's current revision. Proposals do not alter notes automatically. Open **References and library**, review a proposal on the draw.io canvas, then choose **Apply reviewed proposal** or reject it. A changed note revision makes the proposal stale.

Existing MCP note tools can also create or edit the fenced Markdown source. No delete capability is added.

## Local setup and format

`npm run dev` and `npm run build` prepare the pinned draw.io distribution automatically. The initial setup downloads release **31.4.5** and verifies its SHA-256; later starts reuse local assets. Run `npm run setup:drawio` to prepare them explicitly. Generated assets live in ignored `public/vendor/drawio/` and are copied into production builds. Browser editor requests are restricted to local resources; cloud integrations are disabled.

The `thread-diagram` fence stores native XML, optional PNG, and stable Thread references in a version-3 envelope. This directly replaces the former custom diagram format; no migration or compatibility editor is included.
