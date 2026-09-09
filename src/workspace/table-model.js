export const standardFields = [
  "title",
  "status",
  "priority",
  "owner",
  "dueDate",
  "updated",
  "created",
];
export const defaultView = {
  columns: ["title", "status", "priority", "owner", "dueDate", "updated"],
  filters: [],
  sort: { field: "updated", direction: "desc" },
};
export function fieldValue(note, field) {
  return ["title", "updated", "created"].includes(field)
    ? (note[field] ?? "")
    : (note.properties?.[field] ?? "");
}
export function tableFields(notes, custom = []) {
  return [
    ...new Set([
      ...standardFields,
      ...custom,
      ...notes.flatMap((n) => Object.keys(n.properties || {})),
    ]),
  ];
}
export function filterTable(notes, view = defaultView) {
  const filters = view.filters || [];
  const sort = view.sort || defaultView.sort;
  return notes
    .filter((note) =>
      filters.every(({ field, operator = "contains", value = "" }) => {
        let actual = String(fieldValue(note, field)).toLocaleLowerCase();
        const expected = String(value).toLocaleLowerCase();
        if (
          ["created", "updated"].includes(field) &&
          /^\d{4}-\d{2}-\d{2}$/.test(expected) &&
          actual
        ) {
          const date = new Date(actual);
          if (Number.isFinite(date.getTime()))
            actual = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        }
        if (operator === "empty") return !actual.trim();
        if (operator === "notEmpty") return !!actual.trim();
        if (operator === "is") return actual === expected;
        if (operator === "isNot") return actual !== expected;
        if (operator === "before") return !!actual && actual < expected;
        if (operator === "after") return !!actual && actual > expected;
        return actual.includes(expected);
      }),
    )
    .sort((a, b) => {
      const x = String(fieldValue(a, sort.field)),
        y = String(fieldValue(b, sort.field));
      if (!x && y) return 1;
      if (x && !y) return -1;
      return (
        x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) *
          (sort.direction === "desc" ? -1 : 1) || a.id.localeCompare(b.id)
      );
    });
}
export function saveView(views, id, name, draft) {
  const view = {
    id,
    name: name.trim() || "Untitled view",
    columns: [...draft.columns],
    filters: draft.filters.map((f) => ({ ...f })),
    sort: { ...draft.sort },
  };
  return views.some((v) => v.id === id)
    ? views.map((v) => (v.id === id ? view : v))
    : [...views, view];
}
