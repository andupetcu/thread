// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import ConceptMetadata from "../src/okf/ConceptMetadata.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, saved;
function render(metadata) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [value, setValue] = useState(metadata);
    saved = value;
    return React.createElement(ConceptMetadata, {
      metadata: value,
      onChange: setValue,
    });
  }
  act(() => root.render(React.createElement(Harness)));
}
function field(label) {
  const found = [...host.querySelectorAll("label")].find(
    (el) => el.textContent.trim() === label,
  );
  expect(found, `field ${label}`).toBeTruthy();
  return found.querySelector("input, textarea, select");
}
function change(label, value) {
  const input = field(label);
  act(() => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
});

test("editing a source preserves its identifier and opaque citation metadata", () => {
  render({
    type: "concept",
    sources: [
      { resource: "old", id: "r1", title: "Paper", custom: { pages: [2, 3] } },
    ],
    custom: { owner: "team" },
  });
  change("Source 1 resource", "new");
  expect(saved.sources).toEqual([
    { resource: "new", id: "r1", title: "Paper", custom: { pages: [2, 3] } },
  ]);
  expect(saved.custom).toEqual({ owner: "team" });
});
test("computation contract uses canonical top-level fields and retains receipts", () => {
  render({
    type: "concept",
    computation: "query.sql",
    runtime: "bigquery",
    executor: { resource: "old", receipt: { digest: "abc" } },
    attester: { resource: "proof.py", custom: true },
    parameters: [{ name: "days", type: "integer", required: true, default: 7 }],
  });
  change("Runtime", "python");
  change("Computation path", "query.py");
  change("Executor resource", "new");
  change("Parameter 1 name", "window");
  expect(saved).toMatchObject({
    computation: "query.py",
    runtime: "python",
    executor: { resource: "new", receipt: { digest: "abc" } },
    parameters: [
      { name: "window", type: "integer", required: true, default: 7 },
    ],
  });
});
test("malformed optional values remain repairable without crashing or silently replacing them", () => {
  const metadata = {
    type: "concept",
    tags: "legacy",
    sources: { resource: "old" },
    parameters: "bad",
    generated: "legacy",
    computation: { runtime: "old" },
    verified: [{ by: "human" }],
  };
  expect(() => render(metadata)).not.toThrow();
  expect(host.textContent).toContain("Full source");
  change("Title", "Fixed title");
  expect(saved).toEqual({ ...metadata, title: "Fixed title" });
  expect(field("Tags").disabled).toBe(true);
});
test("timestamps retain explicit offsets and verification evidence is read-only", () => {
  render({
    type: "concept",
    stale_after: "2026-09-09T11:00:00+03:00",
    generated: { by: "agent", at: "2026-09-08T20:00:00Z", custom: true },
    verified: { by: "reviewer", at: "2026-09-09T00:00:00Z" },
  });
  expect(field("Stale after").value).toBe("2026-09-09T11:00:00+03:00");
  change("Generated at", "2026-09-08T23:00:00+03:00");
  expect(saved.generated.custom).toBe(true);
  expect(host.textContent).toContain("reviewer");
  expect(
    host.querySelector('[aria-label="Verification evidence"] input'),
  ).toBeNull();
});

test("warns about invalid lifecycle timestamps and malformed verification evidence without dropping data", () => {
  render({
    type: "concept",
    stale_after: "2026-09-09T11:00",
    verified: "legacy review",
  });
  expect(host.textContent).toContain("Stale after must include a timezone");
  expect(host.textContent).toContain(
    "Verification evidence has a noncanonical value",
  );
  change("Title", "Retained");
  expect(saved.verified).toBe("legacy review");
  expect(saved.stale_after).toBe("2026-09-09T11:00");
});
