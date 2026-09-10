import { COLORS, parseDiagram, defaultDiagram } from "./document.js";
export function templateDiagram(name) {
  const n = (id, shape, label, x, y, color = COLORS[0], extra = {}) => ({
    id,
    position: { x, y },
    data: { shape, label, color },
    ...extra,
  });
  const e = (source, target, label = "", extra = {}) => ({
    id: `${source}-${target}`,
    source,
    target,
    label,
    ...extra,
  });
  let nodes, edges;
  switch (name) {
    case "flow":
      nodes = [
        n("start", "process", "Start", 0, 0),
        n("work", "process", "Do the work", 0, 170, COLORS[1]),
        n("finish", "process", "Finish", 0, 340),
      ];
      edges = [e("start", "work"), e("work", "finish")];
      break;
    case "decision":
      nodes = [
        n("check", "decision", "Ready?", 140, 0, COLORS[2]),
        n("yes", "process", "Continue", 0, 190, COLORS[1]),
        n("no", "process", "Revise", 280, 190, COLORS[3]),
      ];
      edges = [e("check", "yes", "Yes"), e("check", "no", "No")];
      break;
    case "data":
      nodes = [
        n("input", "process", "Collect", 0, 0),
        n("store", "database", "Store", 0, 180, COLORS[4]),
      ];
      edges = [e("input", "store", "Save")];
      break;
    case "architecture":
      nodes = [
        n("client", "process", "Client", 0, 0),
        n("api", "process", "API", 280, 0, COLORS[1]),
        n("store", "database", "Database", 560, 0, COLORS[4]),
        n("worker", "process", "Worker", 280, 180, COLORS[2]),
      ];
      edges = [
        e("client", "api", "Request", {
          sourceHandle: "out-right",
          targetHandle: "in-left",
        }),
        e("api", "store", "Query", {
          sourceHandle: "out-right",
          targetHandle: "in-left",
        }),
        e("api", "worker", "Queue"),
      ];
      break;
    case "approval":
      nodes = [
        n("draft", "document", "Draft", 0, 0),
        n("review", "decision", "Approved?", 0, 170, COLORS[2]),
        n("publish", "terminator", "Publish", 0, 350, COLORS[1]),
        n("revise", "process", "Revise", 300, 170, COLORS[3]),
      ];
      edges = [
        e("draft", "review"),
        e("review", "publish", "Yes"),
        e("review", "revise", "No", {
          sourceHandle: "out-right",
          targetHandle: "in-left",
          kind: "orthogonal",
        }),
        e("revise", "draft", "Resubmit", {
          sourceHandle: "out-top",
          targetHandle: "in-right",
        }),
      ];
      break;
    case "knowledge":
      nodes = [
        n("idea", "ellipse", "Central concept", 250, 0, COLORS[4]),
        n("evidence", "document", "Evidence", 0, 180, COLORS[1]),
        n("question", "annotation", "Open questions", 250, 180, COLORS[2]),
        n("related", "process", "Related notes", 500, 180),
      ];
      edges = [
        e("idea", "evidence", "Supported by"),
        e("idea", "question", "Investigate"),
        e("idea", "related", "See also"),
      ];
      break;
    case "swimlane":
      nodes = [
        n("requester", "swimlane", "Requester", 0, 0, COLORS[0], {
          width: 700,
          height: 180,
        }),
        n("reviewer", "swimlane", "Reviewer", 0, 210, COLORS[1], {
          width: 700,
          height: 180,
        }),
        n("request", "process", "Submit", 35, 60, COLORS[0], {
          parentId: "requester",
        }),
        n("review", "decision", "Review", 250, 60, COLORS[2], {
          parentId: "reviewer",
        }),
        n("done", "terminator", "Complete", 480, 60, COLORS[1], {
          parentId: "requester",
        }),
      ];
      edges = [
        e("request", "review", "Request", { kind: "orthogonal" }),
        e("review", "done", "Approved", {
          kind: "orthogonal",
          sourceHandle: "out-right",
          targetHandle: "in-bottom",
        }),
      ];
      break;
    default:
      return defaultDiagram();
  }
  return parseDiagram({ version: 2, nodes, edges });
}
