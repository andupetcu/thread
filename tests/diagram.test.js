import { describe, it, expect } from "vitest";
import {
  defaultDiagram,
  parseDiagram,
  diagramToSvg,
  templateDiagram,
} from "../src/diagram/model.js";
describe("visual diagram documents", () => {
  it("round trips shapes and directed connectors", () => {
    const d = templateDiagram("flow");
    expect(parseDiagram(JSON.stringify(d))).toEqual(d);
    expect(d.edges.length).toBeGreaterThan(0);
  });
  it("has independent blank documents", () => {
    const a = defaultDiagram();
    a.nodes.push({});
    expect(defaultDiagram().nodes).toHaveLength(0);
  });
  it("rejects malformed documents instead of silently dropping content", () => {
    expect(() => parseDiagram("{")).toThrow();
    expect(() =>
      parseDiagram(JSON.stringify({ nodes: [{ id: "x" }], edges: [] })),
    ).toThrow();
  });
  it("rejects invalid edges and untrusted colors", () => {
    const d = templateDiagram("flow");
    d.edges[0].target = "absent";
    expect(() => parseDiagram(d)).toThrow();
    const a = templateDiagram("flow");
    a.nodes[0].data.color = "url(https://evil.test)";
    expect(() => parseDiagram(a)).toThrow();
  });
  it("renders safe standalone SVG with labels and arrows", () => {
    const d = templateDiagram("flow");
    d.nodes[0].data.label = '<script> & "';
    const svg = diagramToSvg(d);
    expect(svg).toContain("&lt;script&gt; &amp; &quot;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("marker-end=");
    expect(svg).toContain("viewBox=");
  });
  it("bounds hostile document size and coordinates", () => {
    const d = templateDiagram("flow");
    d.nodes[0].position.x = Infinity;
    expect(() => parseDiagram(d)).toThrow();
    expect(() => parseDiagram("x".repeat(1000001))).toThrow();
  });
  it("supports decision and database geometry and empty previews", () => {
    expect(diagramToSvg(templateDiagram("decision"))).toContain("<polygon");
    expect(diagramToSvg(templateDiagram("data"))).toContain("<ellipse");
    expect(diagramToSvg(defaultDiagram())).toContain("Add a shape");
  });
});
