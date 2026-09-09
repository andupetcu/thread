import { it, expect } from "vitest";
import {
  parseBlocks,
  outline,
  operateBlock,
  replaceBlock,
  ensureBlockIds,
} from "../src/editor-model.js";
const source =
  "## Plan\n\nIntro **text**.\n\n```md\n# Not a heading\n\ninside code\n```\n\n- [ ] Task\n  - nested\n\n### Scope\n\nDetails\n";
it("parses complete structural blocks without splitting fenced code or nested lists", () => {
  const blocks = parseBlocks(source);
  expect(blocks.map((b) => b.type)).toEqual([
    "heading",
    "paragraph",
    "code",
    "list",
    "heading",
    "paragraph",
  ]);
  expect(blocks[2].source).toContain("\n\ninside code");
  expect(blocks[3].source).toContain("  - nested");
});
it("extracts outline with source offsets and ignores code headings", () =>
  expect(outline(source)).toEqual([
    { title: "Plan", depth: 2, start: 0 },
    { title: "Scope", depth: 3, start: source.indexOf("### Scope") },
  ]));
it("edits only the selected range, preserving unrelated bytes", () => {
  const b = parseBlocks(source)[1];
  expect(replaceBlock(source, b, "Changed")).toBe(
    source.slice(0, b.start) + "Changed" + source.slice(b.end),
  );
});
it("moves, duplicates and deletes whole blocks", () => {
  const body = "One\n\nTwo\n\nThree";
  expect(operateBlock(body, 1, "up")).toBe("Two\n\nOne\n\nThree");
  expect(operateBlock(body, 1, "down")).toBe("One\n\nThree\n\nTwo");
  expect(operateBlock(body, 1, "duplicate")).toBe("One\n\nTwo\n\nTwo\n\nThree");
  expect(operateBlock(body, 1, "delete")).toBe("One\n\nThree");
});
it("handles empty notes and edge operations safely", () => {
  expect(parseBlocks("")).toEqual([]);
  expect(operateBlock("Only", 0, "up")).toBe("Only");
  expect(operateBlock("Only", 0, "delete")).toBe("");
});
it("preserves distinct paragraphs when moves or deletion remove an interrupting heading", () => {
  const body = "Paragraph A\n# Heading\nParagraph B";
  expect(parseBlocks(operateBlock(body, 1, "up")).map((b) => b.source)).toEqual(
    ["# Heading", "Paragraph A", "Paragraph B"],
  );
  expect(
    parseBlocks(operateBlock(body, 1, "delete")).map((b) => b.source),
  ).toEqual(["Paragraph A", "Paragraph B"]);
});
it("preserves list and quote blocks when duplicated", () => {
  for (const body of ["- One\n- Two", "> A quote"]) {
    const next = operateBlock(body, 0, "duplicate");
    expect(parseBlocks(next).map((b) => b.source)).toEqual([body, body]);
  }
});
it("closes unfinished code fences before moving or duplicating them ahead of content", () => {
  for (const fence of ["```js", "~~~~python"]) {
    const body = "Paragraph\n\n" + fence + "\nx";
    const moved = parseBlocks(operateBlock(body, 1, "up"));
    expect(moved.map((b) => b.type)).toEqual(["code", "paragraph"]);
    expect(moved[1].source).toBe("Paragraph");
    expect(
      parseBlocks(operateBlock(body, 1, "duplicate")).map((b) => b.type),
    ).toEqual(["paragraph", "code", "code"]);
  }
});

it("assigns stable IDs without changing block sources and preserves IDs across edits", async () => {
  const { ensureBlockIds, blockById } = await import("../src/editor-model.js");
  let n = 0;
  const identified = ensureBlockIds(source, () => `b${++n}`);
  expect(parseBlocks(identified).map((b) => b.source)).toEqual(
    parseBlocks(source).map((b) => b.source),
  );
  expect(parseBlocks(identified).map((b) => b.id)).toEqual([
    "b1",
    "b2",
    "b3",
    "b4",
    "b5",
    "b6",
  ]);
  expect(ensureBlockIds(identified)).toBe(identified);
  expect(
    blockById(
      replaceBlock(identified, parseBlocks(identified)[1], "Changed"),
      "b2",
    ).source,
  ).toBe("Changed");
});
it("moves IDs with their blocks, removes deleted markers and gives duplicates new IDs", async () => {
  const { ensureBlockIds, moveBlock } = await import("../src/editor-model.js");
  let n = 0;
  const body = ensureBlockIds("One\n\nTwo\n\nThree", () => `b${++n}`);
  expect(
    parseBlocks(moveBlock(body, 0, 2)).map((b) => [b.id, b.source]),
  ).toEqual([
    ["b2", "Two"],
    ["b3", "Three"],
    ["b1", "One"],
  ]);
  expect(operateBlock(body, 1, "delete")).not.toContain("id=b2");
  const duplicated = parseBlocks(operateBlock(body, 1, "duplicate"));
  expect(new Set(duplicated.map((b) => b.id)).size).toBe(4);
  expect(duplicated[2].source).toBe("Two");
});
it("keeps user comments and marker-like fenced code untouched", async () => {
  const { ensureBlockIds } = await import("../src/editor-model.js");
  const original =
    "<!-- personal -->\n\n```md\n<!-- thread:block id=inside -->\n```";
  expect(parseBlocks(ensureBlockIds(original)).map((b) => b.source)).toEqual([
    "<!-- personal -->",
    "```md\n<!-- thread:block id=inside -->\n```",
  ]);
});
it("suggests addressable blocks and resolves references live", async () => {
  const { suggestions, resolveBlockReference, blockEmbed, blockReference } =
    await import("../src/editor-model.js");
  const notes = [
    {
      id: "n1",
      title: "Plan",
      body: "<!-- thread:block id=b1 -->\n\nA decision",
    },
  ];
  expect(suggestions("@", "decision", notes, [], "n2")[0].value).toContain(
    "block:n1/b1",
  );
  expect(resolveBlockReference(notes, "n1", "b1").block.source).toBe(
    "A decision",
  );
  expect(resolveBlockReference(notes, "n1", "missing")).toBeNull();
  expect(blockEmbed("n1", "b1")).toBe("![[n1#b1]]");
  expect(blockReference("n1", "b1", "Decision")).toBe(
    "@[Decision](block:n1/b1)",
  );
});
it("repairs duplicated IDs once without modifying the block text", () => {
  const body =
    "<!-- thread:block id=same -->\n\nOne\n\n<!-- thread:block id=same -->\n\nTwo";
  const repaired = ensureBlockIds(body, () => "replacement");
  expect(parseBlocks(repaired).map((b) => [b.id, b.source])).toEqual([
    ["same", "One"],
    ["replacement", "Two"],
  ]);
  expect(ensureBlockIds(repaired)).toBe(repaired);
});
