import { it, expect } from "vitest";
import { pageSlices } from "../src/export-pdf";
it("breaks before lines and small images instead of cutting through them", () => {
  expect(
    pageSlices(250, 100, [
      [90, 110],
      [180, 210],
    ]),
  ).toEqual([
    { start: 0, end: 88 },
    { start: 88, end: 178 },
    { start: 178, end: 250 },
  ]);
});
it("handles very tall blocks and fractional positions without stalling", () => {
  const slices = pageSlices(350, 100, [
    [0, 300],
    [99.5, 120.5],
  ]);
  expect(slices[0].end).toBe(97);
  expect(slices.at(-1).end).toBe(350);
  for (let i = 0; i < slices.length; i++) {
    expect(slices[i].end - slices[i].start).toBeGreaterThan(0);
    expect(slices[i].end - slices[i].start).toBeLessThanOrEqual(100);
    if (i) expect(slices[i].start).toBe(slices[i - 1].end);
  }
});
