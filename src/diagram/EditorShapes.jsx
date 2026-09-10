import React, { useState } from "react";
import { Handle, Position, NodeResizer, BaseEdge } from "@xyflow/react";
import { nodeShapeSvg, nodeLabelLayout, edgeGeometry } from "./model.js";
export function EditorShape({ id, data, selected, width = 180, height = 90 }) {
  const [editing, setEditing] = useState(false),
    [label, setLabel] = useState("");
  const node = { id, data, width, height };
  const layout = nodeLabelLayout(node);
  return (
    <div
      className={`diagram-shape${selected ? " is-selected" : ""}`}
      style={{ width, height }}
      onDoubleClick={() => {
        if (!data._locked) {
          setLabel(data.label);
          setEditing(true);
        }
      }}
    >
      <NodeResizer
        isVisible={selected && !data._locked}
        minWidth={60}
        minHeight={40}
        maxWidth={4096}
        maxHeight={4096}
      />
      {["Top", "Right", "Bottom", "Left"].flatMap((side) =>
        ["in", "out"].map((kind) => (
          <Handle
            key={kind + side}
            id={`${kind}-${side.toLowerCase()}`}
            type={kind === "in" ? "target" : "source"}
            position={Position[side]}
            style={{
              ...(side === "Top" || side === "Bottom"
                ? { left: kind === "in" ? "43%" : "57%" }
                : { top: kind === "in" ? "43%" : "57%" }),
            }}
          />
        )),
      )}
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <g dangerouslySetInnerHTML={{ __html: nodeShapeSvg(node) }} />
        {data.shape === "image" && data.image && (
          <image
            href={data.image.url}
            x={1}
            y={1}
            width={width - 2}
            height={height - 2}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        <text
          x={layout.x}
          y={layout.y}
          textAnchor={layout.textAnchor}
          fill={data.textColor || "#202b40"}
          fontSize={layout.fontSize}
          fontFamily="Arial,sans-serif"
          fontWeight={data.fontWeight || 400}
        >
          {layout.lines.map((line, i) => (
            <tspan key={i} x={layout.x} dy={i ? layout.lineHeight : 0}>
              {line}
            </tspan>
          ))}
        </text>
      </svg>
      {editing && (
        <textarea
          autoFocus
          className="diagram-direct-label nodrag"
          aria-label="Edit label directly"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            data._update({ label });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              data._update({ label });
              setEditing(false);
            }
          }}
        />
      )}
      {data.link && (
        <button
          className="diagram-node-link nodrag"
          aria-label={`Open link: ${data.label}`}
          onClick={(e) => {
            e.stopPropagation();
            data._open(data.link);
          }}
        >
          ↗
        </button>
      )}
    </div>
  );
}
export function EditorEdge(props) {
  const e = props.data.edge;
  const g = edgeGeometry(e, props.data.nodes);
  const marker = (kind, end) =>
    kind && kind !== "none" ? `url(#diagram-${props.id}-${end})` : undefined;
  return (
    <>
      <defs>
        {["start", "end"].map((end) => {
          const kind = e[`${end}Arrow`];
          return (
            <marker
              key={end}
              id={`diagram-${props.id}-${end}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              {kind === "circle" ? (
                <circle cx="5" cy="5" r="4" fill={e.color} />
              ) : (
                <path
                  d={
                    kind === "diamond"
                      ? "M0 5L5 0L10 5L5 10Z"
                      : "M0 0L10 5L0 10Z"
                  }
                  fill={e.color}
                />
              )}
            </marker>
          );
        })}
      </defs>
      <BaseEdge
        id={props.id}
        path={g.path}
        markerStart={marker(e.startArrow, "start")}
        markerEnd={marker(e.endArrow, "end")}
        style={{
          stroke: e.color,
          strokeWidth: e.width,
          strokeDasharray: e.dashed ? "8 5" : undefined,
        }}
        label={e.label}
        labelX={g.labelX}
        labelY={g.labelY}
      />
    </>
  );
}
export const nodeTypes = { diagramShape: EditorShape };
export const edgeTypes = { diagramEdge: EditorEdge };
