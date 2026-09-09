import React, { useState } from "react";

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalString = (value) =>
  value === undefined || typeof value === "string";
const display = (value) => (typeof value === "string" ? value : "");

export default function ConceptMetadata({ metadata = {}, onChange }) {
  const [advanced, setAdvanced] = useState(false);
  const set = (key, value) => onChange({ ...metadata, [key]: value });
  const warning = (name) => (
    <p role="status">
      {name} has a noncanonical value. It is preserved; use Full source to
      repair it.
    </p>
  );
  function stringField(label, key, parent) {
    const container = parent ? metadata[parent] : metadata;
    const validContainer =
      !parent || container === undefined || record(container);
    const value = container?.[key];
    const valid = validContainer && optionalString(value);
    return (
      <React.Fragment key={`${parent || "root"}.${key}`}>
        <label>
          {label}
          <input
            value={display(value)}
            disabled={!valid}
            onChange={(event) =>
              parent
                ? set(parent, { ...container, [key]: event.target.value })
                : set(key, event.target.value)
            }
          />
        </label>
        {!valid && warning(label)}
        {valid &&
          value &&
          (key === "stale_after" || (parent === "generated" && key === "at")) &&
          (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            value,
          ) ||
            Number.isNaN(Date.parse(value))) && (
            <p role="status">
              {label} must include a timezone and be a valid ISO timestamp. The
              original value is preserved until you edit it.
            </p>
          )}
      </React.Fragment>
    );
  }
  function rows(key, label, fields) {
    const value = metadata[key];
    if (value !== undefined && !Array.isArray(value)) return warning(label);
    const entries = value || [];
    const update = (index, field, next) =>
      set(
        key,
        entries.map((entry, i) =>
          i === index ? { ...entry, [field]: next } : entry,
        ),
      );
    return (
      <>
        {entries.map((entry, index) => (
          <fieldset key={index}>
            <legend>
              {label} {index + 1}
            </legend>
            {record(entry) ? (
              fields.map((field) => {
                const valid = optionalString(entry[field]);
                return (
                  <React.Fragment key={field}>
                    <label>
                      {label} {index + 1} {field}
                      <input
                        disabled={!valid}
                        value={display(entry[field])}
                        onChange={(event) =>
                          update(index, field, event.target.value)
                        }
                      />
                    </label>
                    {!valid && warning(field)}
                  </React.Fragment>
                );
              })
            ) : (
              <>
                {warning(`${label} ${index + 1}`)}
                <pre>{JSON.stringify(entry, null, 2)}</pre>
              </>
            )}
            {key === "parameters" && record(entry) && (
              <>
                <label>
                  {label} {index + 1} required
                  <input
                    type="checkbox"
                    checked={entry.required === true}
                    disabled={
                      entry.required !== undefined &&
                      typeof entry.required !== "boolean"
                    }
                    onChange={(event) =>
                      update(index, "required", event.target.checked)
                    }
                  />
                </label>
                {entry.required !== undefined &&
                  typeof entry.required !== "boolean" &&
                  warning("Required")}
              </>
            )}
            <button
              type="button"
              onClick={() =>
                set(
                  key,
                  entries.filter((_, i) => i !== index),
                )
              }
            >
              Remove {label.toLowerCase()} {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            set(key, [
              ...entries,
              key === "sources"
                ? { resource: "" }
                : { name: "", type: "", required: false },
            ])
          }
        >
          Add {label.toLowerCase()}
        </button>
      </>
    );
  }
  const validTags =
    metadata.tags === undefined ||
    (Array.isArray(metadata.tags) &&
      metadata.tags.every((tag) => typeof tag === "string"));
  return (
    <aside className="okf-metadata" aria-label="Concept metadata">
      <h3>Concept details</h3>
      {stringField("Title", "title")}
      <label>
        Description
        <textarea
          rows="3"
          value={display(metadata.description)}
          disabled={!optionalString(metadata.description)}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
      {!optionalString(metadata.description) && warning("Description")}
      <label>
        Tags
        <input
          value={validTags ? (metadata.tags || []).join(", ") : ""}
          disabled={!validTags}
          onChange={(event) =>
            set(
              "tags",
              event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      {!validTags && warning("Tags")}
      {stringField("Type", "type")}
      {stringField("Resource", "resource")}
      <label>
        Status
        <select
          disabled={!optionalString(metadata.status)}
          value={display(metadata.status)}
          onChange={(event) => set("status", event.target.value)}
        >
          <option value="">Stable (default)</option>
          <option value="draft">Draft</option>
          <option value="stable">Stable</option>
          <option value="deprecated">Deprecated</option>
          {typeof metadata.status === "string" &&
            !["", "draft", "stable", "deprecated"].includes(
              metadata.status,
            ) && <option value={metadata.status}>{metadata.status}</option>}
        </select>
      </label>
      {!optionalString(metadata.status) && warning("Status")}
      <details open>
        <summary>Sources and citations</summary>
        {rows("sources", "Source", ["resource", "id", "title", "author"])}
      </details>
      <details>
        <summary>Review and lifecycle</summary>
        {stringField("Stale after", "stale_after")}
        <small>
          Use an ISO timestamp including Z or a timezone offset, for example
          2026-09-09T11:00:00+03:00.
        </small>
        {stringField("Generated by", "by", "generated")}
        {stringField("Generated at", "at", "generated")}
        {metadata.verified !== undefined && (
          <section aria-label="Verification evidence">
            <h4>Verification evidence (read-only)</h4>
            {!record(metadata.verified) &&
              !(
                Array.isArray(metadata.verified) &&
                metadata.verified.every(record)
              ) &&
              warning("Verification evidence")}
            <pre className="okf-preserved">
              {JSON.stringify(metadata.verified, null, 2)}
            </pre>
          </section>
        )}
      </details>
      <details>
        <summary>Computation contract</summary>
        {stringField("Computation path", "computation")}
        {stringField("Runtime", "runtime")}
        {rows("parameters", "Parameter", ["name", "type", "description"])}
        {stringField("Executor resource", "resource", "executor")}
        {stringField("Attester resource", "resource", "attester")}
        <p>
          Computation definitions are metadata; referenced code is not executed.
        </p>
      </details>
      <button type="button" onClick={() => setAdvanced((value) => !value)}>
        {advanced ? "Hide preserved fields" : "Show preserved fields"}
      </button>
      {advanced && (
        <pre className="okf-preserved">{JSON.stringify(metadata, null, 2)}</pre>
      )}
    </aside>
  );
}
