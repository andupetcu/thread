import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DiagramBlock from "../src/diagram/DiagramBlock.jsx";
import { defaultDiagram } from "../src/diagram/model.js";
import "../src/style.css";
function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <DiagramBlock value={value} onChange={setValue} recoveryKey="harness" />
      <button
        id="external-update"
        onClick={() =>
          setValue(
            JSON.stringify({
              ...defaultDiagram(),
              references: [
                {
                  id: "remote",
                  label: "Remote",
                  link: { kind: "url", url: "https://example.com" },
                },
              ],
            }),
          )
        }
      >
        Simulate external update
      </button>
      <pre id="saved">{value}</pre>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
