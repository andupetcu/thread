import { describe, it, expect } from "vitest";
import { drawioUrl, readDrawioMessage } from "../src/diagram/protocol.js";
describe("local draw.io protocol", () => {
  it("uses only local assets with offline embed settings", () => {
    const url = new URL(drawioUrl(), "http://localhost:5173");
    expect(url.pathname).toBe("/vendor/drawio/index.html");
    expect(url.searchParams.get("offline")).toBe("1");
    expect(url.searchParams.get("proto")).toBe("json");
  });
  it("accepts messages only from the active editor window and origin", () => {
    const frame = {},
      origin = "http://localhost:5173";
    const event = {
      source: frame,
      origin,
      data: JSON.stringify({ event: "save", xml: "<mxGraphModel/>" }),
    };
    expect(readDrawioMessage(event, frame, origin).event).toBe("save");
    expect(
      readDrawioMessage({ ...event, source: {} }, frame, origin),
    ).toBeNull();
    expect(
      readDrawioMessage(
        { ...event, origin: "https://other.test" },
        frame,
        origin,
      ),
    ).toBeNull();
    expect(
      readDrawioMessage({ ...event, data: "not JSON" }, frame, origin),
    ).toBeNull();
    expect(
      readDrawioMessage({ ...event, data: "[]" }, frame, origin),
    ).toBeNull();
  });
});
