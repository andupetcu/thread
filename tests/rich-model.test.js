import { it, expect } from "vitest";
import * as rich from "../src/rich/model.js";
it("keeps comments, reference definitions, footnotes and diagrams in source mode", () => {
  for (const source of [
    "<!-- comment -->",
    "[title][ref]",
    "[ref]: https://example.com",
    "[^1]: Note",
    "```thread-diagram\n{}\n```",
    "![[note#block]]",
  ]) {
    expect(rich.richFallbackReason(source)).toBeTruthy();
  }
  for (const source of [
    "Hello **world**",
    "- [x] Done\n- [ ] Open",
    "| A | B |\n|---|---|\n| 1 | 2 |",
    "```js\nlet x = 1;\n```",
    "@[Plan](note:plan)",
  ])
    expect(rich.richFallbackReason(source)).toBe("");
});
it("escapes attachment labels and distinguishes images from downloads", () => {
  expect(
    rich.assetMarkdown({
      name: "a[b].png",
      url: "/api/assets/123",
      mime: "image/png",
    }),
  ).toBe("![a\\[b\\].png](/api/assets/123)");
  expect(
    rich.assetMarkdown({
      name: "report.pdf",
      url: "/api/assets/456",
      mime: "application/pdf",
    }),
  ).toBe("[report.pdf](/api/assets/456)");
});
it("recognizes embed addresses without interpreting fenced examples", () => {
  expect(rich.embedAddress("![[n1#b1]]")).toEqual({
    noteId: "n1",
    blockId: "b1",
  });
  expect(rich.embedAddress("```\n![[n1#b1]]\n```")).toBeNull();
});
