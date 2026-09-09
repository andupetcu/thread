import { defaultDiagram } from "./diagram/model.js";
const metadataCache = new Map();
export function metadata(body) {
  if (metadataCache.has(body)) return metadataCache.get(body);
  const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const result = {
    tags: [
      ...new Set(
        [...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]),
      ),
    ],
    links: [
      ...new Set([
        ...[
          ...prose.matchAll(
            /@\[[^\]]*\]\((?:note:|block:)([^/\s)#]+)(?:[^)]*)\)/g,
          ),
        ].map((m) => m[1]),
        ...[...prose.matchAll(/!\[\[([^#\]]+)#[^\]]+\]\]/g)].map((m) => m[1]),
      ]),
    ],
  };
  if (metadataCache.size > 10000)
    metadataCache.delete(metadataCache.keys().next().value);
  metadataCache.set(body, result);
  return result;
}
export function searchNotes(
  notes,
  { query = "", tag = "", from = "", to = "", dateField = "updated" } = {},
) {
  return notes.filter(
    (n) =>
      (!query ||
        `${n.title}\n${n.body}\n${metadata(n.body)
          .links.map(
            (id) => notes.find((other) => other.id === id)?.title || "",
          )
          .join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!tag || metadata(n.body).tags.includes(tag)) &&
      (!from || Date.parse(n[dateField]) >= Date.parse(from)) &&
      (!to || Date.parse(n[dateField]) <= Date.parse(to)),
  );
}
export function validateBackup(data) {
  if (
    !Array.isArray(data) ||
    data.some(
      (n) =>
        !n ||
        ["id", "title", "body", "updated", "created"].some(
          (k) => typeof n[k] !== "string",
        ) ||
        !n.id ||
        !Number.isFinite(Date.parse(n.updated)) ||
        !Number.isFinite(Date.parse(n.created)),
    ) ||
    new Set(data.map((n) => n.id)).size !== data.length
  )
    throw new Error(
      "Invalid backup: expected unique notes with title, body and timestamps.",
    );
  return data;
}
export const templates = [
  [
    "Visual diagram",
    "```thread-diagram\n" + JSON.stringify(defaultDiagram()) + "\n```\n",
    "Visual",
  ],
  ["Bullet list", "- First item\n- Second item\n", "Structure"],
  ["Numbered list", "1. First step\n2. Second step\n", "Structure"],
  ["Quote", "> A useful quotation.\n", "Structure"],
  ["Link", "[Link text](https://example.com)\n", "Structure"],
  [
    "Image",
    "![Image description](https://example.com/image.png)\n",
    "Structure",
  ],
  [
    "User story",
    "## User story\nAs a [persona], I want [capability] so that [outcome].\n\n## Acceptance criteria\n- Given \u2026 when \u2026 then \u2026\n\n## Edge cases\n\n## Dependencies\n",
    "Product",
  ],
  [
    "Test plan",
    "## Scope\n\n## Test environment\n\n## Scenarios\n| Scenario | Expected result | Status |\n| --- | --- | --- |\n| Happy path | | Not run |\n| Failure path | | Not run |\n\n## Regression coverage\n\n## Exit criteria\n",
    "Engineering",
  ],
  [
    "Runbook",
    "## Service\n\n## Symptoms & alerts\n\n## Diagnosis\n```bash\n# Diagnostic command\n```\n\n## Recovery steps\n1. \n\n## Rollback\n\n## Verification\n\n## Escalation\n",
    "Engineering",
  ],
  [
    "Incident report",
    "## Summary\n**Severity:** \n**Status:** Investigating\n**Owner:** \n\n## Customer impact\n\n## Timeline\n| Time | Event |\n| --- | --- |\n| | |\n\n## Root cause\n\n## Resolution\n\n## Prevention\n- [ ] Action \u2014 owner \u2014 due date\n",
    "Engineering",
  ],
  [
    "RFC",
    "## Proposal\n\n## Motivation\n\n## Design\n\n## Alternatives\n\n## Compatibility\n\n## Security & performance\n\n## Open questions\n\n## Rollout plan\n",
    "Engineering",
  ],
  [
    "Roadmap",
    "## Vision\n\n## Now\n- [ ] \n\n## Next\n- [ ] \n\n## Later\n- [ ] \n\n## Dependencies\n\n## Measures of success\n",
    "Product",
  ],
  ["Heading", "## Heading\n", "Structure"],
  ["Task list", "- [ ] First task\n- [ ] Second task\n", "Structure"],
  ["Code block", "```typescript\n// Your code here\n```\n", "Engineering"],
  [
    "Table",
    "| Item | Owner | Status |\n| --- | --- | --- |\n| Deliverable | Unassigned | Planned |\n",
    "Structure",
  ],
  ["Callout", "> **Note**\n> Add context or a useful warning.\n", "Structure"],
  ["Divider", "\n---\n", "Structure"],
  [
    "PRD",
    "## Problem\n\nWhat problem are we solving?\n\n## Goals\n- \n\n## Non-goals\n- \n\n## User stories\nAs a … I want … so that …\n\n## Requirements\n| Requirement | Priority | Acceptance criteria |\n| --- | --- | --- |\n| | P0 | |\n\n## Success metrics\n\n## Risks & dependencies\n\n## Rollout\n",
    "Product",
  ],
  [
    "ADR",
    "## Context\n\n## Decision\n\n## Alternatives considered\n\n## Consequences\n\n## Status\nProposed\n",
    "Engineering",
  ],
  [
    "API reference",
    "## Endpoint\n`GET /api/resource`\n\n### Request\n```json\n{}\n```\n\n### Response\n```json\n{}\n```\n\n### Error cases\n| Code | Meaning |\n| --- | --- |\n| 400 | Invalid request |\n",
    "Engineering",
  ],
  [
    "Meeting notes",
    "## Meeting\n**Date:** " +
      new Date().toLocaleDateString() +
      "\n**Attendees:** \n\n### Agenda\n- \n\n### Decisions\n- \n\n### Action items\n- [ ] Owner — action — due date\n",
    "Product",
  ],
  [
    "Sprint plan",
    "## Sprint goal\n\n## Scope\n- [ ] \n\n## Capacity\n\n## Dependencies\n\n## Definition of done\n- [ ] Reviewed\n- [ ] Tested\n- [ ] Documented\n",
    "Product",
  ],
  [
    "Bug report",
    "## Expected behavior\n\n## Actual behavior\n\n## Reproduction steps\n1. \n\n## Environment\n\n## Evidence\n\n## Severity\n",
    "Engineering",
  ],
  [
    "Research",
    "## Question\n\n## Hypothesis\n\n## Method\n\n## Findings\n\n## Recommendation\n",
    "Product",
  ],
  [
    "Retrospective",
    "## What went well\n- \n\n## What could improve\n- \n\n## Actions\n- [ ] \n",
    "Product",
  ],
  [
    "Release notes",
    "## Added\n- \n\n## Changed\n- \n\n## Fixed\n- \n\n## Migration notes\n",
    "Engineering",
  ],
  [
    "Checklist",
    "- [ ] Scope agreed\n- [ ] Implementation complete\n- [ ] Tests passing\n- [ ] Documentation updated\n",
    "Structure",
  ],
];
const seed = [
  [
    "welcome",
    "Start here",
    "## A little space for big ideas\n\nWelcome to **Thread**, your local workspace for connected thinking. Write a spec, capture a decision, and follow the threads between them.\n\n### Make yourself at home\n\n- Type `/` for blocks, code snippets, and project templates\n- Type `@` to mention another note\n- Type `#` to organize ideas with tags\n- Open up to **three notes** side by side\n\n> **Your notes stay on this device.** Use Backup to keep a portable copy of your workspace.\n\n### Follow a thread\n\nExplore the @[Platform roadmap](note:roadmap), read the @[Authentication API](note:api), or jump into the @[Search experience](note:search).\n\n### Today’s checklist\n\n- [x] Create a space to think\n- [ ] Connect your first two notes\n- [ ] Explore your knowledge graph\n\n#workspace #guide",
  ],
  [
    "roadmap",
    "Platform roadmap",
    "## Building the next chapter\n\nA shared direction for the platform team.\n\n| Initiative | Status | Target |\n| --- | --- | --- |\n| Authentication v2 | In progress | September |\n| Unified search | Discovery | October |\n| Developer portal | Planned | November |\n\n### Priorities\n- [ ] Ship @[Authentication API](note:api)\n- [ ] Validate @[Search experience](note:search)\n- [ ] Review @[Architecture decisions](note:architecture)\n\n#product #planning",
  ],
  [
    "api",
    "Authentication API",
    "## Authentication v2\n\nToken-based access for every client. Part of the @[Platform roadmap](note:roadmap).\n\n### Endpoint\n```typescript\nPOST /v2/auth/token\n\ninterface TokenResponse {\n  accessToken: string;\n  expiresIn: number;\n}\n```\n\n### Acceptance criteria\n- [ ] Rotate refresh tokens\n- [ ] Rate-limit failed attempts\n- [ ] Emit audit events\n\nSee @[Architecture decisions](note:architecture) for context.\n\n#engineering #api",
  ],
  [
    "search",
    "Search experience",
    "## Find the right thing, faster\n\n### Problem\nKnowledge is scattered across project documents. Finding a past decision should take seconds.\n\n### Success metrics\n- Median time to useful result < 10 seconds\n- Zero-result rate < 5%\n\n### Requirements\n- [ ] Search titles and content\n- [ ] Filter by tags and time\n- [ ] Surface linked notes\n\nResearch: @[Customer interviews](note:research)\nDelivery: @[Sprint 24](note:sprint)\n\n#product #research",
  ],
  [
    "architecture",
    "Architecture decisions",
    "## ADR 001: local-first storage\n\n### Context\nThe workspace must stay fast and private.\n\n### Decision\nStore notes on the device and provide explicit portable backups.\n\n### Consequences\nNo account required. Users own their backup workflow.\n\nRelated: @[Authentication API](note:api)\n\n#engineering #decisions",
  ],
  [
    "research",
    "Customer interviews",
    "## What we heard\n\n> “I remember discussing this, but I can never find the decision.”\n\n### Themes\n- Context gets lost between tools\n- Links are more useful than folders alone\n- Search should understand project vocabulary\n\nFeeds into @[Search experience](note:search).\n\n#research #product",
  ],
  [
    "sprint",
    "Sprint 24",
    "## Connect the dots\n\n### Sprint goal\nMake knowledge discoverable.\n\n- [ ] Search prototype\n- [ ] Graph exploration\n- [ ] Keyboard navigation\n\nSpec: @[Search experience](note:search)\n\n#planning #engineering",
  ],
];
export function initialNotes() {
  return seed.map(([id, title, body], i) => ({
    id,
    title,
    body,
    created: new Date(Date.now() - i * 86400000).toISOString(),
    updated: new Date(Date.now() - i * 3600000).toISOString(),
    pinned: i === 0,
  }));
}
