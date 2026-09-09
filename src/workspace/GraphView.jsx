import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Expand,
  LockKeyhole,
  Network,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { neighborhood, relationshipGraph } from "./graph-model.js";
import "./workspace-tools.css";

const palette = ["#a5a1ff", "#76cbb8", "#e4b575", "#d993b3", "#86b7e4"];
function color(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
export default function GraphView({
  notes,
  open,
  settings = {},
  onSettingsChange = () => {},
}) {
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [zoomLabel, setZoomLabel] = useState(100),
    [layoutVersion, setLayoutVersion] = useState(0);
  const canvas = useRef(),
    host = useRef(),
    simulation = useRef(),
    nodesRef = useRef([]),
    edgesRef = useRef([]),
    drawRef = useRef(() => {});
  const viewport = useRef({ x: 400, y: 260, k: 1 }),
    size = useRef({ width: 800, height: 520 }),
    gesture = useRef(null),
    selectedRef = useRef(""),
    hovered = useRef(""),
    colors = useRef({});
  const settingsRef = useRef(settings),
    saveRef = useRef(onSettingsChange),
    userViewport = useRef(false),
    focusedOnce = useRef(false);
  settingsRef.current = settings;
  saveRef.current = onSettingsChange;
  selectedRef.current = selected;
  const graph = useMemo(
    () => relationshipGraph(notes, !!settings.graphTags),
    [notes, settings.graphTags],
  );
  const visible = useMemo(
    () => neighborhood(graph, settings.graphFocus, settings.graphDepth || 1),
    [graph, settings.graphFocus, settings.graphDepth],
  );
  const noteNodes = visible.nodes.filter((n) => n.kind === "note");
  const list = noteNodes.filter((n) =>
    n.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const current = visible.nodes.find((n) => n.id === selected);
  const connected = useMemo(() => {
    if (!selected) return [];
    return neighborhood(visible, selected, 1).nodes.filter(
      (n) => n.id !== selected && n.kind === "note",
    );
  }, [visible, selected]);
  function persist() {
    const positions = { ...(settingsRef.current.graphPositions || {}) };
    for (const n of nodesRef.current)
      if (Number.isFinite(n.x) && Number.isFinite(n.y))
        positions[n.id] = {
          x: Math.round(n.x * 100) / 100,
          y: Math.round(n.y * 100) / 100,
          pinned: n.fx != null,
        };
    saveRef.current({ graphPositions: positions });
  }
  function fit() {
    const nodes = nodesRef.current;
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x),
      ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const k = Math.max(
      0.08,
      Math.min(
        1.5,
        (size.current.width - 120) / Math.max(160, maxX - minX),
        (size.current.height - 120) / Math.max(160, maxY - minY),
      ),
    );
    viewport.current = {
      k,
      x: size.current.width / 2 - ((minX + maxX) * k) / 2,
      y: size.current.height / 2 - ((minY + maxY) * k) / 2,
    };
    setZoomLabel(Math.round(k * 100));
    drawRef.current();
  }
  function zoom(
    factor,
    point = { x: size.current.width / 2, y: size.current.height / 2 },
  ) {
    const v = viewport.current,
      k = Math.max(0.05, Math.min(5, v.k * factor)),
      ratio = k / v.k;
    viewport.current = {
      k,
      x: point.x - (point.x - v.x) * ratio,
      y: point.y - (point.y - v.y) * ratio,
    };
    userViewport.current = true;
    setZoomLabel(Math.round(k * 100));
    drawRef.current();
  }
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    function refreshColors() {
      const css = getComputedStyle(el);
      colors.current = {
        text: css.getPropertyValue("--text").trim() || "#e1e4ef",
        muted: css.getPropertyValue("--muted").trim() || "#939bb0",
        edge: css.getPropertyValue("--graph-edge").trim() || "#45495f",
        bg: css.getPropertyValue("--bg").trim() || "#161820",
      };
      drawRef.current();
    }
    drawRef.current = () => {
      const { width, height } = size.current,
        ratio = window.devicePixelRatio || 1,
        v = viewport.current,
        tone = colors.current;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(v.x, v.y);
      ctx.scale(v.k, v.k);
      for (const e of edgesRef.current) {
        const hot =
          e.source.id === selectedRef.current ||
          e.target.id === selectedRef.current;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.strokeStyle = hot ? color(selectedRef.current) : tone.edge;
        ctx.globalAlpha = hot ? 0.95 : e.kind === "tag" ? 0.35 : 0.65;
        ctx.lineWidth = (hot ? 1.8 : 1) / v.k;
        ctx.setLineDash(e.kind === "tag" ? [3 / v.k, 5 / v.k] : []);
        ctx.stroke();
        if (hot && e.kind === "mention") {
          const dx = e.target.x - e.source.x,
            dy = e.target.y - e.source.y,
            length = Math.hypot(dx, dy) || 1,
            ux = dx / length,
            uy = dy / length;
          const x = e.target.x - ux * 12,
            y = e.target.y - uy * 12;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - ux * 7 - uy * 4, y - uy * 7 + ux * 4);
          ctx.lineTo(x - ux * 7 + uy * 4, y - uy * 7 - ux * 4);
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const n of nodesRef.current) {
        const sx = n.x * v.k + v.x,
          sy = n.y * v.k + v.y;
        if (sx < -120 || sx > width + 120 || sy < -60 || sy > height + 60)
          continue;
        const hot = n.id === selectedRef.current || n.id === hovered.current,
          r = n.kind === "tag" ? 6 : hot ? 12 : 8;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (hot ? 9 : 4), 0, Math.PI * 2);
        ctx.fillStyle = color(n.id);
        ctx.globalAlpha = hot ? 0.15 : 0.06;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        if (n.kind === "tag") {
          ctx.moveTo(n.x, n.y - r);
          ctx.lineTo(n.x + r, n.y);
          ctx.lineTo(n.x, n.y + r);
          ctx.lineTo(n.x - r, n.y);
          ctx.closePath();
        } else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = hot ? color(n.id) : tone.bg;
        ctx.fill();
        ctx.strokeStyle = color(n.id);
        ctx.lineWidth = (hot ? 2 : 1.5) / v.k;
        ctx.stroke();
        if (n.fx != null) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = color(n.id);
          ctx.fill();
        }
        if (nodesRef.current.length < 160 || hot || v.k > 1.5) {
          ctx.font = `${(hot ? 12 : 11) / v.k}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = hot ? tone.text : tone.muted;
          const label =
            n.label.length > 34 ? n.label.slice(0, 32) + "…" : n.label;
          ctx.fillText(label, n.x, n.y + r + 17 / v.k);
        }
      }
    };
    refreshColors();
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect,
        old = size.current;
      size.current = { width, height };
      el.width = Math.round(width * (window.devicePixelRatio || 1));
      el.height = Math.round(height * (window.devicePixelRatio || 1));
      viewport.current.x += (width - old.width) / 2;
      viewport.current.y += (height - old.height) / 2;
      drawRef.current();
    });
    observer.observe(host.current);
    const theme = new MutationObserver(refreshColors);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    const wheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.001), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      theme.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    const previous = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes = visible.nodes.map((n) => {
      const saved = settingsRef.current.graphPositions?.[n.id],
        old = previous.get(n.id),
        position = saved || old;
      const result = { ...n };
      if (
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
      ) {
        result.x = position.x;
        result.y = position.y;
        if (saved?.pinned) {
          result.fx = position.x;
          result.fy = position.y;
        }
      }
      return result;
    });
    const edges = visible.edges.map((e) => ({ ...e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    const sim = forceSimulation(nodes)
      .force(
        "links",
        forceLink(edges)
          .id((n) => n.id)
          .distance((e) => (e.kind === "tag" ? 85 : 120))
          .strength((e) => (e.kind === "tag" ? 0.12 : 0.5)),
      )
      .force("charge", forceManyBody().strength(-220).distanceMax(900))
      .force("collision", forceCollide().radius(26))
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.04);
    simulation.current = sim;
    let ticks = 0;
    sim
      .on("tick", () => {
        ticks++;
        if (!focusedOnce.current && !userViewport.current && ticks === 10) {
          fit();
          focusedOnce.current = true;
        }
        drawRef.current();
      })
      .on("end", () => {
        if (!userViewport.current) fit();
        persist();
      });
    if (!nodes.length) drawRef.current();
    return () => {
      sim.stop();
    };
  }, [visible, layoutVersion]);
  useEffect(() => {
    drawRef.current();
  }, [selected]);
  function point(e) {
    const rect = canvas.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function hit(p) {
    const v = viewport.current,
      x = (p.x - v.x) / v.k,
      y = (p.y - v.y) / v.k;
    let found = null,
      near = Math.max(12, 12 / v.k);
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < near) {
        near = d;
        found = n;
      }
    }
    return found;
  }
  function pointerDown(e) {
    if (e.button !== 0) return;
    userViewport.current = true;
    const p = point(e),
      n = hit(p);
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      p,
      origin: { ...viewport.current },
      node: n,
      moved: false,
    };
    if (n) {
      setSelected(n.id);
      n.fx = n.x;
      n.fy = n.y;
      simulation.current?.alphaTarget(0.12).restart();
    }
  }
  function pointerMove(e) {
    const p = point(e),
      g = gesture.current;
    if (!g) {
      const next = hit(p)?.id || "";
      if (next !== hovered.current) {
        hovered.current = next;
        canvas.current.style.cursor = next ? "grab" : "default";
        drawRef.current();
      }
      return;
    }
    const dx = p.x - g.p.x,
      dy = p.y - g.p.y;
    if (Math.hypot(dx, dy) > 3) g.moved = true;
    if (g.node) {
      g.node.fx = (p.x - viewport.current.x) / viewport.current.k;
      g.node.fy = (p.y - viewport.current.y) / viewport.current.k;
      g.node.x = g.node.fx;
      g.node.y = g.node.fy;
    } else {
      viewport.current = {
        ...g.origin,
        x: g.origin.x + dx,
        y: g.origin.y + dy,
      };
      userViewport.current = true;
    }
    drawRef.current();
  }
  function pointerUp(e) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    simulation.current?.alphaTarget(0);
    if (g.node) {
      if (!g.moved) {
        const saved = settingsRef.current.graphPositions?.[g.node.id];
        if (!saved?.pinned) {
          g.node.fx = null;
          g.node.fy = null;
        }
      } else persist();
    } else if (!g.moved) setSelected("");
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function moveSelected(dx, dy) {
    const n = nodesRef.current.find((n) => n.id === selected);
    if (!n) return;
    userViewport.current = true;
    n.x += dx;
    n.y += dy;
    n.fx = n.x;
    n.fy = n.y;
    drawRef.current();
    persist();
  }
  function inspect(id) {
    setSelected(id);
    const n = nodesRef.current.find((n) => n.id === id);
    if (n) {
      viewport.current.x = size.current.width / 2 - n.x * viewport.current.k;
      viewport.current.y = size.current.height / 2 - n.y * viewport.current.k;
      userViewport.current = true;
      drawRef.current();
    }
  }
  return (
    <section className="wt-graph-view" aria-label="Graph workspace">
      <header className="wt-heading">
        <div>
          <h1>Follow the connections.</h1>
          <p>A living map of your notes and the ideas they share.</p>
        </div>
        <Network size={25} />
      </header>
      <div className="wt-tools">
        <label className="wt-check">
          <input
            type="checkbox"
            aria-label="Shared tag connections"
            checked={!!settings.graphTags}
            onChange={(e) => onSettingsChange({ graphTags: e.target.checked })}
          />
          Shared tags
        </label>
        <label className="wt-inline-label">
          Neighborhood
          <select
            aria-label="Neighborhood center"
            value={settings.graphFocus || ""}
            onChange={(e) => {
              onSettingsChange({ graphFocus: e.target.value });
              userViewport.current = false;
              focusedOnce.current = false;
            }}
          >
            <option value="">Entire workspace</option>
            {notes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.title || "Untitled note"}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Neighborhood depth"
          disabled={!settings.graphFocus}
          value={settings.graphDepth || 1}
          onChange={(e) => {
            onSettingsChange({ graphDepth: Number(e.target.value) });
            userViewport.current = false;
          }}
        >
          <option value={1}>1 connection away</option>
          <option value={2}>2 connections away</option>
          <option value={3}>3 connections away</option>
        </select>
        <span className="wt-count" aria-label="Graph summary">
          {noteNodes.length} notes · {visible.edges.length} links
        </span>
      </div>
      <div className="wt-graph-body">
        <div className="wt-graph-stage" ref={host}>
          <canvas
            ref={canvas}
            aria-label="Relationship graph"
            role="img"
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onDoubleClick={(e) => {
              const n = hit(point(e));
              if (n?.kind === "note") open(n.id);
            }}
            onKeyDown={(e) => {
              const directions = {
                ArrowLeft: [-25, 0],
                ArrowRight: [25, 0],
                ArrowUp: [0, -25],
                ArrowDown: [0, 25],
              };
              if (directions[e.key]) {
                e.preventDefault();
                if (e.shiftKey && selected) moveSelected(...directions[e.key]);
                else {
                  viewport.current.x += directions[e.key][0];
                  viewport.current.y += directions[e.key][1];
                  drawRef.current();
                }
              }
              if (["+", "="].includes(e.key)) {
                e.preventDefault();
                zoom(1.2);
              }
              if (e.key === "-") {
                e.preventDefault();
                zoom(1 / 1.2);
              }
              if (e.key === "Enter" && current?.kind === "note")
                open(current.id);
            }}
          />
          <div className="wt-graph-legend">
            <span>
              <i />
              Note link
            </span>
            {settings.graphTags && (
              <span>
                <i className="tag" />
                Shared tag
              </span>
            )}
          </div>
          <div className="wt-graph-controls">
            <button aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
              <ZoomOut size={16} />
            </button>
            <span>{zoomLabel}%</span>
            <button aria-label="Zoom in" onClick={() => zoom(1.2)}>
              <ZoomIn size={16} />
            </button>
            <button
              aria-label="Fit graph"
              onClick={() => {
                userViewport.current = false;
                fit();
              }}
            >
              <Expand size={16} />
            </button>
            <button
              aria-label="Reset graph positions"
              onClick={() => {
                onSettingsChange({ graphPositions: {} });
                settingsRef.current = {
                  ...settingsRef.current,
                  graphPositions: {},
                };
                nodesRef.current = [];
                focusedOnce.current = false;
                userViewport.current = false;
                setLayoutVersion((v) => v + 1);
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          {!noteNodes.length && (
            <div className="wt-graph-empty">No notes match your filters.</div>
          )}
        </div>
        <aside className="wt-graph-explorer" aria-label="Graph explorer">
          <label className="wt-graph-search">
            <Search size={14} />
            <input
              aria-label="Find graph note"
              placeholder="Find a note…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {current && (
            <div className="wt-node-detail">
              <div className="wt-node-title">
                <span style={{ background: color(current.id) }} />
                <strong>{current.label}</strong>
              </div>
              <small>{connected.length} connected notes</small>
              {current.kind === "note" && (
                <button
                  className="wt-primary"
                  aria-label="Open selected note"
                  onClick={() => open(current.id)}
                >
                  Open note
                </button>
              )}
              <button
                onClick={() =>
                  onSettingsChange({
                    graphFocus: current.kind === "note" ? current.id : "",
                  })
                }
              >
                <Crosshair size={14} />
                Explore neighborhood
              </button>
              <div className="wt-node-move" aria-label="Position selected node">
                <button
                  aria-label="Move selected node left"
                  onClick={() => moveSelected(-20, 0)}
                >
                  <ArrowLeft size={13} />
                </button>
                <button
                  aria-label="Move selected node up"
                  onClick={() => moveSelected(0, -20)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label="Move selected node down"
                  onClick={() => moveSelected(0, 20)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  aria-label="Move selected node right"
                  onClick={() => moveSelected(20, 0)}
                >
                  <ArrowRight size={13} />
                </button>
                <button
                  aria-label="Release selected node position"
                  title="Let layout position this node"
                  onClick={() => {
                    const n = nodesRef.current.find((n) => n.id === selected);
                    if (n) {
                      n.fx = null;
                      n.fy = null;
                      persist();
                      simulation.current?.alpha(0.3).restart();
                    }
                  }}
                >
                  <LockKeyhole size={13} />
                </button>
              </div>
              {!!connected.length && (
                <details>
                  <summary>Connected notes</summary>
                  {connected.slice(0, 100).map((n) => (
                    <button key={n.id} onClick={() => inspect(n.id)}>
                      {n.label}
                    </button>
                  ))}
                </details>
              )}
            </div>
          )}
          <div className="wt-node-list" aria-label="Graph notes">
            {list.slice(0, 150).map((n) => (
              <button
                key={n.id}
                className={n.id === selected ? "selected" : ""}
                aria-label={`Inspect ${n.label}`}
                onClick={() => inspect(n.id)}
                onDoubleClick={() => open(n.id)}
              >
                <span style={{ background: color(n.id) }} />
                {n.label}
              </button>
            ))}
            {list.length > 150 && (
              <p>Showing 150 of {list.length}. Search to find any note.</p>
            )}
          </div>
        </aside>
      </div>
      <footer className="wt-graph-footer">
        Drag nodes to pin their position. Drag the map to pan. Scroll to zoom.{" "}
        <span>Keyboard: arrows pan · Shift + arrows move selected node</span>
      </footer>
    </section>
  );
}
