import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DiagramBlock } from "../src/diagram/DiagramBlock.jsx";
import "../src/style.css";
import { templateDiagram } from "../src/diagram/model.js";
function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <DiagramBlock value={value} onChange={setValue} />
      <button
        id="external-update"
        onClick={() => setValue(JSON.stringify(templateDiagram("data")))}
      >
        Simulate external update
      </button>
      <pre id="saved">{value}</pre>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
