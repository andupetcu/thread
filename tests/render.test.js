import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import Render from "../src/Render";
function render(body) {
  const note = { id: "n", title: "Note", body };
  return renderToStaticMarkup(
    React.createElement(Render, { note, notes: [note], open: () => {} }),
  );
}
it("hides block metadata in rendered text while preserving block IDs and heading offsets", () => {
  const body =
    "<!-- thread:block id=heading-id -->\n\n## Heading\n\n<!-- thread:block -->\n\n<!-- thread:block id=paragraph-id -->\n\nVisible paragraph";
  const html = render(body);
  expect(html).not.toContain("thread:block");
  expect(html).toContain('data-block-id="heading-id"');
  expect(html).toContain('data-block-id="paragraph-id"');
  expect(html).toContain(`data-heading-start="${body.indexOf("## Heading")}"`);
  expect(html).toContain("Visible paragraph");
});
it("preserves block-marker examples inside inline and fenced code", () => {
  const html = render(
    "`<!-- thread:block id=example -->`\n\n```md\n<!-- thread:block id=example -->\n```",
  );
  expect(html.match(/thread:block/g)).toHaveLength(2);
});
