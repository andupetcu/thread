export function drawioUrl() {
  return (
    "/vendor/drawio/index.html?" +
    new URLSearchParams({
      embed: "1",
      proto: "json",
      configure: "1",
      offline: "1",
      local: "1",
      spin: "1",
      libraries: "1",
      noSaveBtn: "1",
      saveAndExit: "0",
      noExitBtn: "1",
      ui: "kennedy",
      lang: "en",
      math: "0",
      analytics: "0",
      plugins: "0",
      gapi: "0",
      db: "0",
      od: "0",
      gh: "0",
      tr: "0",
      suppressNewWindows: "1",
    })
  );
}
export function readDrawioMessage(event, frame, origin) {
  if (
    !frame ||
    event.source !== frame ||
    event.origin !== origin ||
    typeof event.data !== "string" ||
    event.data.length > 24_000_000
  )
    return null;
  try {
    const data = JSON.parse(event.data);
    return data && !Array.isArray(data) && typeof data.event === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
