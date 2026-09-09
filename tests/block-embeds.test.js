import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import Render from "../src/Render";
function render(notes) {
  return renderToStaticMarkup(
    React.createElement(Render, { note: notes[0], notes, open: () => {} }),
  );
}
it("renders embedded reference links and images using definitions from the source note", () => {
  const notes = [
    { id: "host", title: "Host", body: "![[source#b]]" },
    {
      id: "source",
      title: "Source",
      body: "<!-- thread:block id=b -->\n\n[Manual][ref] and ![Photo][pic]\n\n[ref]: https://example.com/manual\n\n[pic]: /api/assets/photo.png",
    },
  ];
  const html = render(notes);
  expect(html).toContain('href="https://example.com/manual"');
  expect(html).toContain('src="/api/assets/photo.png"');
  expect(html).not.toContain("[Manual][ref]");
  notes[1] = {
    ...notes[1],
    body: notes[1].body.replace(
      "https://example.com/manual",
      "https://example.com/latest",
    ),
  };
  expect(render(notes)).toContain('href="https://example.com/latest"');
});
it("keeps embedded footnotes and stops recursive embeds", () => {
  const notes = [
    { id: "host", title: "Host", body: "![[source#b]]" },
    {
      id: "source",
      title: "Source",
      body: "<!-- thread:block id=b -->\n\nDecision[^1]\n\n[^1]: Rationale retained",
    },
  ];
  expect(render(notes)).toContain("Rationale retained");
  notes[1] = {
    ...notes[1],
    body: "<!-- thread:block id=b -->\n\n![[source#b]]",
  };
  expect(render(notes)).toContain("Circular block embed");
});
