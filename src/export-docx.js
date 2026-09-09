import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
  ImageRun,
} from "docx";

import { imageToPng, removeExportControls } from "./export-assets";

// Convert the same safe rendered tree used by preview and printing.
export async function toDocx(title, element, options = {}) {
  element = element.cloneNode(true);
  removeExportControls(element);
  const images = new Map();
  for (const node of element.querySelectorAll("img")) {
    const image = await (options.imageLoader || imageToPng)(node);
    const scale = Math.min(1, 560 / image.width, 700 / image.height);
    images.set(
      node,
      new ImageRun({
        type: "png",
        data: image.data,
        transformation: {
          width: Math.round(image.width * scale),
          height: Math.round(image.height * scale),
        },
        altText: {
          title: node.alt || "Image",
          description: node.alt || "Image",
          name: node.alt || "Image",
        },
      }),
    );
  }
  function inline(node, style = {}) {
    if (node.nodeType === 3)
      return [new TextRun({ ...style, text: node.textContent })];
    const tag = node.tagName?.toLowerCase();
    if (tag === "br") return [new TextRun({ break: 1 })];
    if (tag === "input")
      return [new TextRun({ text: node.checked ? "☑ " : "☐ " })];
    if (tag === "img") return [images.get(node)];
    const next = {
      ...style,
      ...(["strong", "b"].includes(tag) ? { bold: true } : {}),
      ...(["em", "i"].includes(tag) ? { italics: true } : {}),
      ...(tag === "del" ? { strike: true } : {}),
      ...(tag === "code" ? { font: "Consolas", size: 20 } : {}),
    };
    const runs = Array.from(node.childNodes).flatMap((n) => inline(n, next));
    if (tag === "a" && /^https?:/.test(node.getAttribute("href") || ""))
      return [
        new ExternalHyperlink({
          link: node.getAttribute("href"),
          children: runs,
        }),
      ];
    return runs;
  }
  function blocks(element, depth = 0) {
    return Array.from(element.children).flatMap((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === "img")
        return [
          new Paragraph({
            children: [images.get(node)],
            spacing: { after: 160 },
          }),
        ];
      if (["div", "section", "article", "aside", "figure"].includes(tag))
        return blocks(node, depth);
      if (tag === "table")
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: Array.from(node.querySelectorAll("tr")).map(
              (row) =>
                new TableRow({
                  children: Array.from(row.children).map(
                    (cell) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: Array.from(cell.childNodes).flatMap((n) =>
                              inline(n, { bold: cell.tagName === "TH" }),
                            ),
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          }),
        ];
      if (tag === "ul" || tag === "ol")
        return Array.from(node.children).flatMap((li, i) => {
          const content = Array.from(li.childNodes).filter(
            (n) => !["UL", "OL"].includes(n.tagName),
          );
          return [
            new Paragraph({
              children: [
                ...(tag === "ol"
                  ? [
                      new TextRun(
                        `${i + (Number(node.getAttribute("start")) || 1)}. `,
                      ),
                    ]
                  : []),
                ...content.flatMap((n) => inline(n)),
              ],
              ...(tag === "ul"
                ? { bullet: { level: Math.min(depth, 8) } }
                : {}),
              indent: { left: 360 * (depth + 1) },
              spacing: { after: 100 },
            }),
            ...Array.from(li.children)
              .filter((n) => ["UL", "OL"].includes(n.tagName))
              .flatMap((n) => blocks({ children: [n] }, depth + 1)),
          ];
        });
      if (tag === "blockquote") return blocks(node).map((p) => p);
      if (tag === "hr")
        return [
          new Paragraph({
            text: "────────────────────────────────",
            spacing: { before: 120, after: 120 },
          }),
        ];
      if (tag === "pre")
        return node.textContent
          .replace(/\n$/, "")
          .split("\n")
          .map(
            (text) =>
              new Paragraph({
                children: [new TextRun({ text, font: "Consolas", size: 20 })],
                shading: { fill: "F0F1F5" },
                spacing: { after: 0 },
              }),
          );
      const heading = /^h[1-6]$/.test(tag)
        ? HeadingLevel["HEADING_" + tag[1]]
        : undefined;
      return [
        new Paragraph({
          heading,
          children: Array.from(node.childNodes).flatMap((n) => inline(n)),
          spacing: { after: 160 },
        }),
      ];
    });
  }
  const doc = new Document({
    creator: "Thread",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...blocks(element),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}
