import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import GraphView from "../src/workspace/GraphView.jsx";
import NoteTable from "../src/workspace/NoteTable.jsx";
import DiffView from "../src/workspace/DiffView.jsx";
import "../src/style.css";
const seed = [
  {
    id: "a",
    title: "API",
    body: "@[Build](note:b) #platform",
    updated: "2026-09-09T12:00:00Z",
    properties: { status: "Planned", owner: "Ada" },
  },
  {
    id: "b",
    title: "Build",
    body: "#platform",
    updated: "2026-09-08T12:00:00Z",
    properties: { status: "Done", owner: "Lin" },
  },
  {
    id: "c",
    title: "Cache",
    body: "@[Build](note:b)",
    updated: "2026-09-07T12:00:00Z",
    properties: {},
  },
];
function Harness() {
  const [state, setState] = useState(
    () =>
      JSON.parse(localStorage.getItem("workspace-tools-test") || "null") || {
        notes: seed,
        settings: {},
      },
  );
  const [opened, setOpened] = useState("");
  useEffect(() => {
    localStorage.setItem("workspace-tools-test", JSON.stringify(state));
  }, [state]);
  const mode = new URLSearchParams(location.search).get("mode");
  const props = {
    ...state,
    open: setOpened,
    update: (id, patch) =>
      setState((s) => ({
        ...s,
        notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      })),
    onSettingsChange: (patch) =>
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
  };
  const body = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join(
    "\n",
  );
  return (
    <main
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <output aria-label="Opened note">{opened}</output>
      {mode === "table" ? (
        <NoteTable {...props} />
      ) : mode === "diff" ? (
        <DiffView
          notes={[
            { id: "a", title: "Baseline", body },
            {
              id: "b",
              title: "Revision",
              body: body
                .replace("Line 2\n", "Changed word\n")
                .replace("Line 100\n", "Another change\n"),
            },
            {
              id: "c",
              title: "Alternative",
              body: body.replace("Line 2\n", "Other words\n"),
            },
          ]}
          onClose={() => setOpened("closed")}
        />
      ) : (
        <GraphView {...props} />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
