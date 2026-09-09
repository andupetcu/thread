import { diffArrays, diffWordsWithSpace } from "diff";

function lines(body) {
  return body === "" ? [] : body.replace(/\r\n/g, "\n").split("\n");
}
function pair(base, other) {
  const changes = diffArrays(base, other, { timeout: 150 }) || [
    { removed: true, value: base },
    { added: true, value: other },
  ];
  const mapped = new Map(),
    inserted = new Map();
  let at = 0,
    number = 1;
  for (let c = 0; c < changes.length;) {
    const change = changes[c];
    if (!change.added && !change.removed) {
      for (const text of change.value)
        mapped.set(at++, { text, lineNumber: number++ });
      c++;
      continue;
    }
    const removed = [],
      added = [];
    while (c < changes.length && (changes[c].added || changes[c].removed)) {
      (changes[c].removed ? removed : added).push(...changes[c].value);
      c++;
    }
    for (let i = 0; i < removed.length; i++)
      mapped.set(
        at++,
        i < added.length ? { text: added[i], lineNumber: number++ } : null,
      );
    if (added.length > removed.length)
      inserted.set(
        at,
        added
          .slice(removed.length)
          .map((text) => ({ text, lineNumber: number++ })),
      );
  }
  return { mapped, inserted };
}
function wordParts(original, changed, side) {
  if (original === null || changed === null)
    return [
      {
        text: side === "old" ? (original ?? "") : (changed ?? ""),
        changed: true,
      },
    ];
  const diff = diffWordsWithSpace(original, changed, { timeout: 25 }) || [
    { value: original, removed: true },
    { value: changed, added: true },
  ];
  return diff
    .filter((p) => (side === "old" ? !p.added : !p.removed))
    .map((p) => ({ text: p.value, changed: !!(p.added || p.removed) }));
}
function baselineParts(text, others) {
  if (text === null) return [];
  const ranges = [];
  for (const other of others) {
    let position = 0;
    for (const part of wordParts(text, other, "old")) {
      if (part.changed) ranges.push([position, position + part.text.length]);
      position += part.text.length;
    }
  }
  const boundaries = [...new Set([0, text.length, ...ranges.flat()])].sort(
    (a, b) => a - b,
  );
  return boundaries
    .slice(1)
    .map((end, i) => ({
      text: text.slice(boundaries[i], end),
      changed: ranges.some(([a, b]) => a <= boundaries[i] && b >= end),
    }));
}
export function alignedDiff(bodies) {
  const all = bodies.slice(0, 3).map(lines);
  if (!all.length) return { rows: [], changeRows: [] };
  const base = all[0],
    pairs = all.slice(1).map((other) => pair(base, other));
  const rows = [];
  function add(cells) {
    const original = cells[0]?.text ?? null;
    const changed = cells.slice(1).some((c) => (c?.text ?? null) !== original);
    rows.push({
      changed,
      cells: cells.map((cell, index) => {
        const text = cell?.text ?? null;
        return {
          text,
          lineNumber: cell?.lineNumber ?? null,
          kind:
            text === null
              ? "missing"
              : !changed || (text === original && index > 0)
                ? "same"
                : index === 0
                  ? "removed"
                  : "added",
          parts:
            index === 0
              ? baselineParts(
                  text,
                  cells.slice(1).map((c) => c?.text ?? null),
                )
              : wordParts(original, text, "new"),
        };
      }),
    });
  }
  for (let i = 0; i <= base.length; i++) {
    const count = Math.max(
      0,
      ...pairs.map((p) => p.inserted.get(i)?.length || 0),
    );
    for (let j = 0; j < count; j++)
      add([null, ...pairs.map((p) => p.inserted.get(i)?.[j] || null)]);
    if (i < base.length)
      add([
        { text: base[i], lineNumber: i + 1 },
        ...pairs.map((p) => p.mapped.get(i) || null),
      ]);
  }
  return {
    rows,
    changeRows: rows.flatMap((row, i) =>
      row.changed && !rows[i - 1]?.changed ? [i] : [],
    ),
  };
}
