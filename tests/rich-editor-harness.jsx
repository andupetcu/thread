import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import BlockEditor from "../src/BlockEditor";
import {
  BlockReferenceLink,
  EmbeddedParagraph,
} from "../src/rich/BlockReferences";
import "../src/style.css";
function Render({ note, notes, open }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) =>
        url.startsWith("block:") ? "#" + url : defaultUrlTransform(url)
      }
      components={{
        a: ({ href, children }) =>
          href?.startsWith("#block:") ? (
            <BlockReferenceLink href={href} notes={notes} open={open}>
              {children}
            </BlockReferenceLink>
          ) : (
            <a href={href}>{children}</a>
          ),
        p: ({ node, children }) => (
          <EmbeddedParagraph
            source={note.body.slice(
              node.position.start.offset,
              node.position.end.offset,
            )}
            notes={notes}
            open={open}
            Render={Render}
          >
            {children}
          </EmbeddedParagraph>
        ),
      }}
    >
      {note.body}
    </Markdown>
  );
}
function App() {
  const [note, setNote] = useState({
    id: "n1",
    title: "Draft",
    body: "First **paragraph**.\n\nSecond paragraph.",
  });
  const other = {
    id: "n2",
    title: "Project",
    body: "<!-- thread:block id=decision -->\n\nA stable decision",
  };
  return (
    <main style={{ maxWidth: 800, margin: "30px auto" }}>
      <BlockEditor
        note={note}
        notes={[note, other]}
        tags={["work"]}
        update={(id, patch) => setNote((n) => ({ ...n, ...patch }))}
        open={() => {}}
        Render={Render}
        positionCompletion={() => ({ position: "relative", top: 0, left: 0 })}
      />
      <pre data-testid="markdown">{note.body}</pre>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
