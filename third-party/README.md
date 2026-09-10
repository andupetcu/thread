# Embedded editor notices

Thread integrates these upstream editors and retains their identities:

- **draw.io 31.4.5**, from <https://github.com/jgraph/drawio>. The pinned release archive is downloaded by `scripts/setup-drawio.mjs`, verified with SHA-256, and kept outside Git. Source license: [Apache 2.0](drawio-LICENSE.txt). Upstream separately restricts distributing its icon sets, stencil libraries and templates as software assets in Atlassian products or the Atlassian marketplace/plugin ecosystem; that restriction does not apply to diagrams users create. See the pinned [upstream README](https://github.com/jgraph/drawio/blob/v31.4.5/README.md) for exact terms and trademark notices.
- **Drawnix 0.4.0-0**, from <https://github.com/plait-board/drawnix>, integrated through `@drawnix/drawnix` and matching React-board/text packages. [MIT license](drawnix-LICENSE.txt). Compatible Plait and Slate dependencies are pinned in `package.json` and `package-lock.json`.

Other package licenses remain with their respective distributions. Thread does not claim affiliation with either editor project. The Mermaid 10.9.8 override selects a patched release within the major version required by Drawnix's optional text converter; Thread's editing UI remains visual.
