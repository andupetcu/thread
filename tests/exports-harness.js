import { defaultDiagram } from "../src/diagram/model";
import { toPdf } from "../src/export-pdf";
import { toDocx } from "../src/export-docx";
import { toMarkdownBundle } from "../src/export-markdown";
import "../src/style.css";
const sample = document.getElementById("sample"),
  diagram = defaultDiagram();
const canvas = document.createElement("canvas");
canvas.width = 600;
canvas.height = 180;
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, 600, 180);
ctx.fillStyle = "#dbeafe";
ctx.fillRect(40, 50, 220, 80);
ctx.fillStyle = "#1e3a8a";
ctx.font = "22px sans-serif";
ctx.fillText("Project diagram", 60, 96);
diagram.preview = canvas.toDataURL("image/png");
const src = diagram.preview;
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
