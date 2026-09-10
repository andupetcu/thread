// Read raster headers without decoding pixels. Export must reject decompression
// bombs before a browser image decoder allocates the full raster.
const fail = () => {
  throw new Error(
    "Invalid image asset header or dimensions (maximum 8192 per side, 32 megapixels).",
  );
};
export function imageDataDimensions(data) {
  let binary;
  try {
    binary = atob(data.slice(data.indexOf(",") + 1));
  } catch {
    fail();
  }
  const b = Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    view = new DataView(b.buffer),
    ascii = (offset, length) => binary.slice(offset, offset + length);
  let width, height;
  if (data.startsWith("data:image/png;")) {
    if (
      b.length < 33 ||
      ascii(1, 3) !== "PNG" ||
      b[0] !== 137 ||
      ascii(12, 4) !== "IHDR"
    )
      fail();
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (data.startsWith("data:image/gif;")) {
    if (b.length < 13 || !["GIF87a", "GIF89a"].includes(ascii(0, 6))) fail();
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (data.startsWith("data:image/jpeg;")) {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216) fail();
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset] !== 255) fail();
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > b.length) fail();
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > b.length) fail();
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (size < 8) fail();
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  } else if (data.startsWith("data:image/webp;")) {
    if (b.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP")
      fail();
    const kind = ascii(12, 4);
    if (kind === "VP8X") {
      width = 1 + b[24] + b[25] * 256 + b[26] * 65536;
      height = 1 + b[27] + b[28] * 256 + b[29] * 65536;
    } else if (kind === "VP8 ") {
      if (b[23] !== 157 || b[24] !== 1 || b[25] !== 42) fail();
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
    } else if (kind === "VP8L") {
      if (b[20] !== 47) fail();
      const bits = view.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 33554432
  )
    fail();
  return { width, height };
}
