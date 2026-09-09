import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import path from "node:path";
import { WorkspaceStore } from "./store.mjs";
import { recoverAdmin } from "./recovery.mjs";
process.umask(0o077);
const username = process.argv[2] || "admin";
const input = createInterface({ input: process.stdin, output: process.stdout });
const answer = await input.question(
  `Reset administrator ${username}'s password? Type RESET to confirm: `,
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
try {
  const result = await recoverAdmin(store, username);
  console.log(
    `Account: ${result.username}\nTemporary password: ${result.password}\nSign in and change it in Workspace settings → Password. Notes and other accounts are preserved. This account's sessions and agent keys were revoked.`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  store.close();
}
