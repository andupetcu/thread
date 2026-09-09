export async function imageToPng(node) {
  const source = node.currentSrc || node.src || node.getAttribute("src");
  const response = await fetch(source);
  if (!response.ok)
    throw new Error(`Image could not be exported: ${node.alt || source}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(
      1,
      1800 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image export is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    return {
      data: new Uint8Array(await (await fetch(dataUrl)).arrayBuffer()),
      dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
export function removeExportControls(element) {
  element
    .querySelectorAll(
      "button:not(.mention),textarea,select,.block-handle,.block-mode-bar,.inline-block-footer,.block-edit-modes,.rich-toolbar,.diagram-block-footer,.add-block,[data-export-ignore]",
    )
    .forEach((node) => node.remove());
}
