import { diagramToSvg, templateDiagram } from "../src/diagram/model";
import { toPdf } from "../src/export-pdf";
import { toDocx } from "../src/export-docx";
import { toMarkdownBundle } from "../src/export-markdown";
import "../src/style.css";
const sample = document.getElementById("sample"),
  diagram = templateDiagram("flow");
const svg = diagramToSvg(diagram),
  src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
sample.innerHTML =
  '<h2>Project decisions</h2><p>A formatted <strong>decision</strong> with <em>context</em> and <a href="https://example.com">a source</a>.</p><img alt="Project diagram" src="' +
  src +
  '"><table><thead><tr><th>Workstream</th><th>Owner</th></tr></thead><tbody><tr><td>Design</td><td>Ana</td></tr><tr><td>Build</td><td>Mihai</td></tr></tbody></table>' +
  Array.from(
    { length: 32 },
    (_, i) =>
      "<h3>Decision " +
      (i + 1) +
      "</h3><p>Keep the source notes portable and preserve diagrams alongside their editable data. This paragraph verifies that long exports retain legible text and consistent spacing across page boundaries. Owner review is complete.</p>",
  ).join("");
window.exportSample = async (type) =>
  Array.from(
    new Uint8Array(
      await (
        type === "pdf"
          ? await toPdf("Durable workspace decisions", sample)
          : type === "docx"
            ? await toDocx("Durable workspace decisions", sample)
            : await toMarkdownBundle({
                title: "Diagram",
                body: "```thread-diagram\n" + JSON.stringify(diagram) + "\n```",
              })
      ).arrayBuffer(),
    ),
  );
