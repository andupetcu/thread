import { jsPDF } from "jspdf";
import { toCanvas } from "html-to-image";
import { imageToPng, removeExportControls } from "./export-assets";
export function pageSlices(height, pageHeight, ranges = []) {
  const pages = [];
  for (let start = 0; start < height;) {
    let end = Math.min(height, start + pageHeight);
    if (end < height) {
      for (let pass = 0; pass < ranges.length; pass++) {
        const crossing = ranges.filter(
          ([top, bottom]) =>
            bottom - top <= pageHeight &&
            top < end &&
            bottom > end &&
            top > start + 20,
        );
        if (!crossing.length) break;
        end = Math.max(
          start + 1,
          Math.floor(Math.min(...crossing.map(([top]) => top))) - 2,
        );
      }
    }
    pages.push({ start, end });
    start = end;
  }
  return pages;
}
export async function toPdf(title, element) {
  if (!element) throw new Error("Open a note preview before exporting.");
  const width = 760,
    pageHeight = 1080,
    mmPerPixel = 180 / width;
  const viewport = document.createElement("div"),
    content = document.createElement("div");
  viewport.style.cssText = `position:fixed;left:-12000px;top:0;width:${width}px;overflow:hidden;background:white;color:#202735;z-index:-1;pointer-events:none;`;
  content.style.cssText =
    "display:flow-root;width:100%;font:15px/1.65 Arial,sans-serif;color:#202735;background:#fff;--text:#202735;--bg:#fff;--panel:#fff;--code:#f3f4f6;--border:#d8dde3;--muted:#637184;--accent:#5351aa;--accent-bg:#eeeeff;";
  const heading = document.createElement("h1");
  heading.textContent = title;
  heading.style.cssText =
    "font:700 30px/1.25 Arial,sans-serif;margin:0 0 24px;color:#17202e;";
  const body = element.cloneNode(true);
  removeExportControls(body);
  body.style.cssText =
    "display:flow-root;position:static;padding:0;margin:0;width:100%;max-width:none;height:auto;overflow:visible;color:#202735;";
  body.querySelectorAll("pre").forEach((node) => {
    node.style.whiteSpace = "pre-wrap";
    node.style.overflowWrap = "anywhere";
    node.style.overflow = "visible";
  });
  body.querySelectorAll("img").forEach((node) => {
    node.style.maxWidth = "100%";
    node.style.maxHeight = "960px";
    node.style.objectFit = "contain";
  });
  content.append(heading, body);
  viewport.append(content);
  document.body.append(viewport);
  try {
    await document.fonts?.ready;
    for (const img of body.querySelectorAll("img")) {
      const image = await imageToPng(img);
      img.src = image.dataUrl;
      await img.decode();
    }
    const origin = content.getBoundingClientRect().top,
      ranges = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects())
        if (rect.height > 0)
          ranges.push([rect.top - origin, rect.bottom - origin]);
    }
    content.querySelectorAll("img,tr,h1,h2,h3,h4,h5,h6").forEach((node) => {
      const rect = node.getBoundingClientRect();
      let bottom = rect.bottom;
      if (/^H[1-6]$/.test(node.tagName) && node.nextElementSibling) {
        const range = document.createRange();
        range.selectNodeContents(node.nextElementSibling);
        bottom = Math.max(bottom, range.getClientRects()[0]?.bottom || bottom);
      }
      ranges.push([rect.top - origin, bottom - origin]);
    });
    const height = Math.ceil(content.getBoundingClientRect().height),
      pages = pageSlices(Math.max(1, height), pageHeight, ranges);
    const links = Array.from(content.querySelectorAll("a[href]"))
      .filter((a) => /^https?:/.test(a.href))
      .flatMap((a) =>
        Array.from(a.getClientRects()).map((rect) => ({
          url: a.href,
          left: rect.left - content.getBoundingClientRect().left,
          top: rect.top - origin,
          width: rect.width,
          height: rect.height,
        })),
      );
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    pdf.setProperties({ title, creator: "Thread" });
    for (let i = 0; i < pages.length; i++) {
      const { start, end } = pages[i];
      if (i) pdf.addPage();
      viewport.style.height = `${end - start}px`;
      content.style.transform = `translateY(-${start}px)`;
      const canvas = await toCanvas(viewport, {
        width,
        height: end - start,
        pixelRatio: 2,
        backgroundColor: "#fff",
        skipFonts: true,
        style: { position: "static", left: "0", top: "0", zIndex: "auto" },
      });
      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        15,
        15,
        180,
        (end - start) * mmPerPixel,
        undefined,
        "FAST",
      );
      for (const link of links)
        if (link.top >= start && link.top < end)
          pdf.link(
            15 + link.left * mmPerPixel,
            15 + (link.top - start) * mmPerPixel,
            link.width * mmPerPixel,
            link.height * mmPerPixel,
            { url: link.url },
          );
      pdf.setFontSize(9);
      pdf.setTextColor(110);
      pdf.text(`${i + 1} / ${pages.length}`, 195, 287, { align: "right" });
    }
    return pdf.output("blob");
  } finally {
    viewport.remove();
  }
}
