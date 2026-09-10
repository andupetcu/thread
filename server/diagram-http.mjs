import { fields } from "./diagrams.mjs";
export async function handleDiagrams({
  route,
  method,
  url,
  body,
  json,
  store,
  actor,
}) {
  const human = actor.kind === "human",
    d = store.diagrams;
  if (route === "/diagrams" && method === "GET") {
    json(200, d.list(url.searchParams.get("noteId")));
    return true;
  }
  if (route === "/diagram-proposals" && method === "POST" && !human) {
    json(201, { proposal: d.propose(await body(), actor) });
    return true;
  }
  if (!human) return false;
  if (route === "/diagram-proposals" && method === "GET") {
    json(200, { proposals: d.proposals(url.searchParams.get("noteId")) });
    return true;
  }
  if (route === "/diagram-templates" && method === "GET") {
    json(200, { templates: d.templates() });
    return true;
  }
  if (route === "/diagram-templates" && method === "POST") {
    json(201, { template: d.saveTemplate(await body()) });
    return true;
  }
  const template = route.match(/^\/diagram-templates\/([A-Za-z0-9_-]{1,128})$/);
  if (template && method === "PUT") {
    json(200, { template: d.saveTemplate(await body(), template[1]) });
    return true;
  }
  const proposal = route.match(
    /^\/diagram-proposals\/([A-Za-z0-9_-]{1,128})\/(apply|reject)$/,
  );
  if (proposal && method === "POST") {
    json(200, d.resolve(proposal[1], proposal[2], await body(), actor));
    return true;
  }
  return false;
}
