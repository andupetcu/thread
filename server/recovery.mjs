import { randomBytes } from "node:crypto";
import { Accounts, passwordRecord } from "./auth.mjs";
import { StoreError } from "./store.mjs";
export async function recoverAdmin(store, username = "admin") {
  const accounts = new Accounts(store),
    user = accounts.byName(username);
  if (!user || user.role !== "admin")
    throw new StoreError(
      "Administrator not found. Pass its username: npm run reset-password -- username",
    );
  const password = randomBytes(24).toString("base64url");
  const record = await passwordRecord(password);
  store.tx(() => {
    store.db
      .prepare("UPDATE users SET password=?,disabled=0 WHERE id=?")
      .run(JSON.stringify(record), user.id);
    accounts.revoke(user.id);
    store.bump();
  });
  return { username: user.username, password };
}
