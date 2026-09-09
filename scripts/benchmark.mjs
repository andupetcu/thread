import { WorkspaceStore } from "../server/store.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "thread-benchmark-")),
  store = new WorkspaceStore(dir);
try {
  const created = new Date().toISOString();
  const notes = Array.from({ length: 5000 }, (_, i) => ({
    id: "bench-" + i,
    title: "Engineering note " + i,
    body: `Architecture decisions for service ${i}. OAuth access tokens, deployment checks and release notes. #engineering\n\n${i % 7 === 0 ? "Distinctive searchneedle performance target." : ""}`,
    created,
    updated: created,
  }));
  let start = performance.now();
  store.importNotes(notes);
  const importMs = performance.now() - start;
  const timings = [];
  let matches;
  for (let i = 0; i < 30; i++) {
    start = performance.now();
    matches = store.search({ q: "searchneedle" });
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        notes: notes.length,
        matching: matches.length,
        importMs: Math.round(importMs),
        searchMedianMs: +timings[15].toFixed(2),
        searchP95Ms: +timings[28].toFixed(2),
      },
      null,
      2,
    ),
  );
  if (matches.length !== 715) throw new Error("Search result count incorrect");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
