// @vitest-environment jsdom
import { it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { richExtensions, richEditingReason } from "../src/rich/extensions.js";
function roundtrip(source) {
  const editor = new Editor({
    extensions: richExtensions(),
    content: source,
    contentType: "markdown",
  });
  const result = editor.getMarkdown();
  editor.destroy();
  return result;
}
it("retains custom note and block protocols through rich editing", () => {
  const result = roundtrip("@[Plan](note:n1) and @[Decision](block:n1/b1)");
  expect(result).toContain("(note:n1)");
  expect(result).toContain("(block:n1/b1)");
  expect(result).toContain("@");
});
it("round trips rich nested task lists, tables and fenced code", () => {
  expect(roundtrip("- [x] Done\n- [ ] Open\n  - Nested")).toMatch(/\[x\] Done/);
  expect(roundtrip("| A | B |\n| --- | --- |\n| 1 | 2 |")).toMatch(
    /\| 1\s+\| 2\s+\|/,
  );
  expect(roundtrip('```js\nconst x = "hello";\n```')).toBe(
    '```js\nconst x = "hello";\n```',
  );
});
it("preserves formatting, inline images and strikethrough", () => {
  const result = roundtrip(
    "**Bold** *italic* ~~gone~~ ![image](/api/assets/1)",
  );
  expect(result).toContain("**Bold**");
  expect(result).toContain("*italic*");
  expect(result).toContain("~~gone~~");
  expect(result).toContain("![image](/api/assets/1)");
});

it("keeps the Markdown meaning of nested lists, table alignment and images", async () => {
  const { unified } = await import("unified");
  const { default: remarkParse } = await import("remark-parse");
  const { default: remarkGfm } = await import("remark-gfm");
  const parser = unified().use(remarkParse).use(remarkGfm);
  function meaning(source) {
    return JSON.parse(
      JSON.stringify(parser.parse(source), (key, value) =>
        ["position", "spread"].includes(key) ? undefined : value,
      ),
    );
  }
  for (const source of [
    "- [x] Done\n- [ ] Open\n  - Nested\n    - Deeper",
    "3. Three\n4. Four\n   1. Inner",
    "| Left | Right | Center |\n| :--- | ---: | :---: |\n| **one** | a\\|b | c |",
    'Before ![Image](/api/assets/1 "Caption") after',
    "> A **quote**\n>\n> - With a list",
    "@[Plan](note:n1) and @[Block](block:n1/b1)",
  ]) {
    if (richEditingReason(source))
      expect(richEditingReason(source)).toContain("source mode");
    else expect(meaning(roundtrip(source))).toEqual(meaning(source));
  }
});

it("preserves escaped table cells in formatted editing", () =>
  expect(richEditingReason("| A | B |\n| --- | --- |\n| a\\|b | c |")).toBe(
    "",
  ));
it("accepts ordinary formatted blocks without falling back", () => {
  for (const source of [
    "Hello **world**",
    "- [x] Done\n- [ ] Open",
    "| A | B |\n|---|---|\n| 1 | 2 |",
    "```js\nlet x = 1;\n```",
    "@[Plan](note:plan)",
  ])
    expect(richEditingReason(source)).toBe("");
});
