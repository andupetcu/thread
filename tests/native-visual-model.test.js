import { mindNode } from "./native-mindmap-helpers.js";
import { describe, it, expect } from "vitest";
import {
  parseDiagram,
  defaultDiagram,
  diagramToPng,
} from "../src/diagram/model.js";
import { parseMindMap } from "../src/mindmap/model.js";
import { metadata } from "../src/model.js";
const xml =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
describe("native visual envelopes", () => {
  it("retains native draw.io XML byte for byte and indexes separate references", () => {
    const d = {
      version: 3,
      engine: "drawio",
      xml,
      references: [
        {
          id: "r",
          label: "Target",
          elementId: "1",
          link: { kind: "note", noteId: "target" },
        },
      ],
    };
    expect(parseDiagram(JSON.stringify(d))).toEqual(d);
    expect(
      metadata("```thread-diagram\n" + JSON.stringify(d) + "\n```").links,
    ).toContain("target");
  });
  it("preserves Drawnix nested plugin fields without legacy conversion", () => {
    const d = {
      version: 2,
      engine: "drawnix",
      elements: [
        {
          ...mindNode("Root", "x"),
          custom: { retained: true },
          children: [
            {
              id: "y",
              type: "mind_child",
              data: {
                topic: { children: [{ text: "Hello" }] },
                custom: [1, true],
              },
              children: [],
            },
          ],
        },
      ],
      viewport: { zoom: 1 },
      references: [],
    };
    expect(parseMindMap(d)).toEqual(d);
    expect(() =>
      parseMindMap({ version: 1, rootId: "root", nodes: [] }),
    ).toThrow();
  });
  it("rejects executable content and XML declarations", () => {
    for (const bad of [
      "<!DOCTYPE x><mxGraphModel/>",
      '<mxGraphModel><x link="javascript:alert(1)"/></mxGraphModel>',
    ])
      expect(() =>
        parseDiagram({
          version: 3,
          engine: "drawio",
          xml: bad,
          references: [],
        }),
      ).toThrow();
    expect(() =>
      parseMindMap({
        version: 2,
        engine: "drawnix",
        elements: [{ url: "javascript:alert(1)" }],
        references: [],
      }),
    ).toThrow();
  });
  it("does not fabricate a PNG before native editor export", () => {
    expect(() => diagramToPng(defaultDiagram())).toThrow(/preview/i);
  });
});
it("rejects malformed XML and entity-obfuscated executable links", () => {
  for (const xml of [
    "<mxGraphModel><root></mxGraphModel>",
    '<mxGraphModel><x link="java&#x73;cript:alert(1)"/></mxGraphModel>',
    '<mxGraphModel><x link="javascript&colon;alert(1)"/></mxGraphModel>',
  ])
    expect(() =>
      parseDiagram({ version: 3, engine: "drawio", xml, references: [] }),
    ).toThrow();
});
it("rejects embedded executable data URLs and double encoded XML links", () => {
  for (const xml of [
    '<mxGraphModel><root><x link="java&amp;#x73;cript:alert(1)"/></root></mxGraphModel>',
    '<mxGraphModel><root><x link="data:application/xhtml+xml,bad"/></root></mxGraphModel>',
  ])
    expect(() =>
      parseDiagram({ version: 3, engine: "drawio", xml, references: [] }),
    ).toThrow();
  expect(() =>
    parseMindMap({
      version: 2,
      engine: "drawnix",
      elements: [{ url: "data:application/xhtml+xml,bad" }],
      references: [],
    }),
  ).toThrow();
});
it("retains literal scripting words and assignment-like text in ordinary native labels", () => {
  for (const label of [
    "onboarding=done",
    "javascript: example",
    "file: attachment",
    "metadata: report",
  ]) {
    const xml = `<mxGraphModel><root><mxCell id="x" value="${label}"/></root></mxGraphModel>`;
    expect(
      parseDiagram({ version: 3, engine: "drawio", xml, references: [] }).xml,
    ).toBe(xml);
  }
  const xml =
    '<mxGraphModel><root><mxCell id="x" style="html=1;" value="&lt;b&gt;javascript: example&lt;/b&gt;"/></root></mxGraphModel>';
  expect(
    parseDiagram({ version: 3, engine: "drawio", xml, references: [] }).xml,
  ).toBe(xml);
});
it("rejects actual unsafe markup and HTML-label URL contexts", () => {
  for (const xml of [
    "<mxGraphModel><root><script>alert(1)</script></root></mxGraphModel>",
    '<mxGraphModel><root><mxCell id="x" onclick="alert(1)"/></root></mxGraphModel>',
    '<mxGraphModel><root><mxCell id="x" style="html=1;" value="&lt;img src=x onerror=alert(1)&gt;"/></root></mxGraphModel>',
    '<mxGraphModel><root><mxCell id="x" style="html=1;" value="&lt;a href=&quot;javascript&amp;colon;alert(1)&quot;&gt;click&lt;/a&gt;"/></root></mxGraphModel>',
  ])
    expect(() =>
      parseDiagram({ version: 3, engine: "drawio", xml, references: [] }),
    ).toThrow();
});
