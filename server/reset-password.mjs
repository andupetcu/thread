import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import path from "node:path";
import { WorkspaceStore } from "./store.mjs";
const input = createInterface({ input: process.stdin, output: process.stdout });
const answer = await input.question(
  "Reset the local workspace password? Type RESET to confirm: ",
);
input.close();
if (answer !== "RESET") {
  console.log("Cancelled.");
  process.exit(0);
}
const store = new WorkspaceStore(
  process.env.THREAD_DATA_DIR ||
    path.join(homedir(), "Documents", "Thread Workspace"),
);
store.db.exec("DELETE FROM meta WHERE key='password'; DELETE FROM sessions;");
store.close();
console.log(
  "Password reset. Open Thread locally to set a new password. Notes are preserved.",
);
