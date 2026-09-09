import { StoreError } from "./store.mjs";
export async function handleOkf({
  route,
  method,
  url,
  body,
  json,
  res,
  store,
  actor,
}) {
  if (!route.startsWith("/okf/bundles")) return false;
  const match = route.match(
    /^\/okf\/bundles(?:\/([a-zA-Z0-9_-]+)(?:\/(.*))?)?$/,
  );
  if (!match) throw new StoreError("Not found.", 404);
  const [, id, action] = match,
    okf = store.okf;
  if (
    actor.kind === "agent" &&
    action &&
    !["documents", "validate", "index"].includes(action)
  )
    throw new StoreError("This operation is not available to agents.", 403);
  if (actor.kind === "agent" && action === "index" && method !== "GET")
    throw new StoreError("Agents cannot modify reserved files.", 403);
  if (!id && method === "GET") {
    const all = okf.list(),
      offset = Math.max(0, Number(url.searchParams.get("offset")) || 0),
      limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit")) || 100),
      );
    json(200, {
      bundles: all.slice(offset, offset + limit),
      total: all.length,
    });
    return true;
  }
  if (!id && method === "POST") {
    json(201, { bundle: okf.create(await body(), actor) });
    return true;
  }
  if (id && !action && method === "GET") {
    json(200, { bundle: okf.get(id) });
    return true;
  }
  if (id && action === "validate" && method === "GET") {
    const { ok, diagnostics, concepts } = okf.get(id);
    json(200, { ok, diagnostics, concepts });
    return true;
  }
  if (id && action === "index" && method === "GET") {
    const b = okf.get(id);
    json(200, {
      id: b.id,
      name: b.name,
      revision: b.revision,
      indexes: b.entries
        .filter((e) => e.path.split("/").pop() === "index.md")
        .map(({ path, source }) => ({ path, source })),
      diagnostics: b.diagnostics,
    });
    return true;
  }
  if (id && action === "documents" && method === "GET") {
    const b = okf.get(id),
      p = url.searchParams.get("path");
    if (p) {
      const entry = b.entries.find((e) => e.path === p);
      if (!entry) throw new StoreError("Document not found.", 404);
      json(200, { entry });
    } else {
      const all = b.entries.filter(
        (e) =>
          e.kind === "document" &&
          !["index.md", "log.md"].includes(e.path.split("/").pop()),
      );
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0),
        limit = Math.min(
          100,
          Math.max(1, Number(url.searchParams.get("limit")) || 50),
        );
      json(200, {
        entries: all.slice(offset, offset + limit),
        total: all.length,
        revision: b.revision,
      });
    }
    return true;
  }
  if (id && action === "files" && method === "GET") {
    const e = okf
      .get(id)
      .entries.find((e) => e.path === url.searchParams.get("path"));
    if (!e) throw new StoreError("File not found.", 404);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(e.path.split("/").pop())}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    res.end(e.kind === "asset" ? Buffer.from(e.data, "base64") : e.source);
    return true;
  }
  if (id && action === "export" && method === "GET") {
    const bytes = await okf.export(id);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="knowledge-bundle.zip"',
    });
    res.end(Buffer.from(bytes));
    return true;
  }
  if (
    id &&
    action === "documents" &&
    ["POST", "PUT", "PATCH"].includes(method)
  ) {
    const input = await body();
    input.path = input.path || url.searchParams.get("path");
    if (
      method === "POST" &&
      okf.get(id).entries.some((e) => e.path === input.path)
    )
      throw new StoreError("Path already exists.", 409);
    if (method === "PATCH") {
      const current = okf.get(id);
      const entry = current.entries.find((e) => e.path === input.path);
      if (!entry) throw new StoreError("Document not found.", 404);
      if (entry.revision !== input.baseRevision)
        throw new StoreError(
          "Revision conflict: this document changed elsewhere.",
          409,
          { current: entry },
        );
      input.expectedRevision = current.revision;
    }
    input.createOnly = method === "POST";
    const bundle = okf.write(id, input, actor);
    json(method === "POST" ? 201 : 200, {
      bundle,
      entry: bundle.entries.find((e) => e.path === input.path),
    });
    return true;
  }
  if (id && method === "POST") {
    const input = await body();
    let result;
    if (action === "manual") result = { bundle: okf.adoptManual(id, input) };
    else if (action === "refresh/preview")
      result = okf.refreshPreview(id, input);
    else if (action === "refresh") result = { bundle: okf.refresh(id, input) };
    else if (action === "rename/preview") result = okf.renamePreview(id, input);
    else if (action === "rename") result = { bundle: okf.rename(id, input) };
    else if (action === "review")
      result = { bundle: okf.review(id, input, actor) };
    else if (action === "index/preview") result = okf.indexPreview(id);
    else if (action === "index")
      result = { bundle: okf.manageIndex(id, input) };
    else if (action === "import/preview")
      result = await okf.importPreview(id, input);
    else if (action === "import")
      result = { bundle: await okf.import(id, input, actor) };
    else throw new StoreError("Not found.", 404);
    json(200, result);
    return true;
  }
  throw new StoreError("Not found.", 404);
}
