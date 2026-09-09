import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { richExtensions, richEditingReason } from "./extensions";
import { suggestions } from "../editor-model";
import { assetMarkdown, uploadAsset } from "./model";
export default function RichTextBlock({
  source,
  onChange,
  onDone,
  onSource,
  notes,
  tags,
  noteId,
}) {
  const [completion, setCompletion] = useState(null),
    [choice, setChoice] = useState(0),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const latest = useRef({}),
    fileInput = useRef();
  const editor = useEditor({
    extensions: richExtensions(),
    content: source,
    contentType: "markdown",
    autofocus: "end",
    editorProps: {
      attributes: {
        "aria-label": "Rich block text",
        role: "textbox",
        "aria-multiline": "true",
        class: "prose rich-block-content",
      },
      handleKeyDown(view, event) {
        return latest.current.keydown?.(event) || false;
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        latest.current.attach(files);
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        latest.current.attach(files);
        return true;
      },
    },
    onUpdate({ editor }) {
      latest.current.onChange(editor.getMarkdown());
      latest.current.detect(editor);
    },
    onSelectionUpdate({ editor }) {
      latest.current.detect(editor);
    },
  });
  const options = completion
    ? suggestions(completion.kind, completion.query, notes, tags, noteId).slice(
        0,
        80,
      )
    : [];
  function detect(current) {
    const { $from, empty } = current.state.selection;
    if (!empty || $from.parent.type.name === "codeBlock") {
      setCompletion(null);
      return;
    }
    const before = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc",
    );
    const match = before.match(/(?:^|\s)([/@#])([^\n/@#]*)$/);
    setCompletion(
      match
        ? {
            kind: match[1],
            query: match[2],
            from: $from.pos - match[2].length - 1,
            to: $from.pos,
          }
        : null,
    );
    setChoice(0);
  }
  function choose(option) {
    const range = { from: completion.from, to: completion.to };
    setCompletion(null);
    if (richEditingReason(option.value)) {
      editor.chain().focus().deleteRange(range).run();
      onChange(editor.getMarkdown() + "\n\n" + option.value.trim());
      onSource();
    } else if (completion.kind !== "/") {
      const parsed = editor.markdown.parse(option.value);
      editor
        .chain()
        .focus()
        .insertContentAt(
          range,
          parsed.content?.[0]?.content || [
            { type: "text", text: option.value },
          ],
        )
        .run();
    } else
      editor
        .chain()
        .focus()
        .insertContentAt(range, option.value, { contentType: "markdown" })
        .run();
    setCompletion(null);
  }
  async function attach(files) {
    if (uploading || !editor) return;
    setUploading(true);
    setError("");
    setCompletion(null);
    editor.setEditable(false);
    try {
      for (const file of files) {
        const asset = await uploadAsset(file);
        if (editor.isDestroyed) return;
        editor.commands.insertContent(assetMarkdown(asset) + " ", {
          contentType: "markdown",
        });
      }
    } catch (error) {
      setError(error.message);
    } finally {
      if (!editor.isDestroyed) {
        editor.setEditable(true);
        setUploading(false);
        editor.commands.focus();
      }
    }
  }
  function keydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onDone();
      return true;
    }
    if (completion && options.length) {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        setChoice(
          (choice + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length,
        );
        return true;
      }
      if (["Enter", "Tab"].includes(event.key)) {
        event.preventDefault();
        choose(options[choice] || options[0]);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCompletion(null);
        return true;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
      return true;
    }
    return false;
  }
  latest.current = { onChange, detect, keydown, attach };
  useEffect(
    () => () => {
      latest.current = {};
    },
    [],
  );
  if (!editor) return null;
  const tools = [
    ["Bold", "B", () => editor.chain().focus().toggleBold().run(), "bold"],
    [
      "Italic",
      "I",
      () => editor.chain().focus().toggleItalic().run(),
      "italic",
    ],
    [
      "Strike",
      "S",
      () => editor.chain().focus().toggleStrike().run(),
      "strike",
    ],
    [
      "Inline code",
      "<>",
      () => editor.chain().focus().toggleCode().run(),
      "code",
    ],
    [
      "Heading",
      "H2",
      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      "heading",
    ],
    [
      "Bullet list",
      "• List",
      () => editor.chain().focus().toggleBulletList().run(),
      "bulletList",
    ],
    [
      "Task list",
      "☑",
      () => editor.chain().focus().toggleTaskList().run(),
      "taskList",
    ],
    [
      "Quote",
      "❝",
      () => editor.chain().focus().toggleBlockquote().run(),
      "blockquote",
    ],
    [
      "Code block",
      "{ }",
      () => editor.chain().focus().toggleCodeBlock().run(),
      "codeBlock",
    ],
  ];
  return (
    <div className="rich-text-block">
      <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
        {tools.map(([label, text, run, type]) => (
          <button
            key={label}
            aria-label={label}
            aria-pressed={editor.isActive(type)}
            disabled={uploading}
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
          >
            {text}
          </button>
        ))}
        <button disabled={uploading} onClick={() => fileInput.current.click()}>
          Attach file
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          attach(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <EditorContent editor={editor} />
      {uploading && <small role="status">Uploading attachment…</small>}
      {error && <p role="alert">{error}</p>}
      {completion && options.length > 0 && (
        <div className="autocomplete rich-completion" role="listbox">
          <div className="completion-heading">
            {completion.kind === "/"
              ? "Insert a block"
              : completion.kind === "@"
                ? "Link a note or block"
                : "Add a tag"}
          </div>
          {options.slice(0, 80).map((option, i) => (
            <button
              key={option.value}
              className={choice === i ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              <small>{option.group}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
