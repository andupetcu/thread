// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, expect } from "vitest";
import BlockEditor from "../src/BlockEditor";
import { parseBlocks } from "../src/editor-model";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, body;
async function mount(source) {
  body = source;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Wrapper() {
    const [note, setNote] = useState({ id: "n1", title: "Test", body: source });
    return React.createElement(BlockEditor, {
      note,
      notes: [note],
      tags: ["work"],
      update: (id, patch) => {
        body = patch.body;
        setNote((n) => ({ ...n, ...patch }));
      },
      open: () => {},
      Render: ({ note }) => React.createElement("div", null, note.body),
      positionCompletion: () => ({}),
    });
  }
  await act(async () => root.render(React.createElement(Wrapper)));
}
async function click(label) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});
it("opens a rich editor and leaves untouched Markdown byte-for-byte beneath stable IDs", async () => {
  const source = "A **bold** paragraph with @[Plan](note:n2).";
  await mount(source);
  await click("Edit block 1");
  expect(container.querySelector("[contenteditable=true]")).toBeTruthy();
  expect(container.querySelector("textarea")).toBeNull();
  await click("Source");
  expect(container.querySelector("textarea").value).toBe(source);
  await click("Done editing block");
  expect(parseBlocks(body)[0].source).toBe(source);
  expect(parseBlocks(body)[0].id).toBeTruthy();
});
it("changes the Markdown structure through the formatting toolbar", async () => {
  await mount("A paragraph");
  await click("Edit block 1");
  await click("Heading");
  expect(parseBlocks(body)[0].source).toBe("## A paragraph");
  await click("Source");
  expect(container.querySelector("textarea").value).toBe("## A paragraph");
});
it("shows explicit source fallback for comments and unsupported image metadata", async () => {
  await mount("<!-- keep this comment -->");
  await click("Edit block 1");
  expect(container.querySelector("textarea").value).toBe(
    "<!-- keep this comment -->",
  );
  expect(container.textContent).toContain("preserved in source mode");
});
it("undoes a block action without replacing it with newly identified changed content", async () => {
  await mount("One\n\nTwo");
  await click("Block 1 actions");
  await click("Duplicate block");
  expect(parseBlocks(body)).toHaveLength(3);
  await click("Undo block action");
  expect(body).toBe("One\n\nTwo");
});
