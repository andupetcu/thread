import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
const version = "31.4.5";
const digest =
  "6ee1ce19242bbabf348c52e41e1fe17057d57236e731acf48d7a3710ca50c375";
const root = fileURLToPath(new URL("../public/vendor/", import.meta.url));
const target = path.join(root, "drawio");
const marker = path.join(target, "thread-version.json");
if (
  (await readFile(marker, "utf8").catch(() => "")) ===
  JSON.stringify({ version, digest })
)
  process.exit(0);
console.log(`Preparing local draw.io ${version}…`);
const bytes = process.argv[2]
  ? await readFile(process.argv[2])
  : await (async () => {
      const response = await fetch(
        `https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`,
        { signal: AbortSignal.timeout(180000) },
      );
      if (!response.ok)
        throw new Error(
          `draw.io download failed (${response.status}). Retry npm run setup:drawio.`,
        );
      return new Uint8Array(await response.arrayBuffer());
    })();
if (createHash("sha256").update(bytes).digest("hex") !== digest)
  throw new Error("draw.io archive checksum mismatch.");
const stage = path.join(root, `drawio-stage-${process.pid}`);
await mkdir(stage, { recursive: true });
try {
  const entries = unzipSync(bytes, {
    filter: ({ name }) =>
      !name.startsWith("WEB-INF/") && !name.startsWith("META-INF/"),
  });
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const dest = path.resolve(stage, name);
    if (!dest.startsWith(stage + path.sep))
      throw new Error("Invalid draw.io archive path.");
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }
  await writeFile(
    path.join(stage, "thread-version.json"),
    JSON.stringify({ version, digest }),
  );
  await rm(target, { recursive: true, force: true });
  await rename(stage, target);
} finally {
  await rm(stage, { recursive: true, force: true });
}
console.log(`Local draw.io ${version} ready.`);
