import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  TableKit,
  Table,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
const lowlight = createLowlight(common);
const MarkdownTable = Table.extend({
  renderMarkdown(node, helpers) {
    return renderTableToMarkdown(node, {
      ...helpers,
      renderChildren(...args) {
        return helpers
          .renderChildren(...args)
          .replace(/(\\*)\|/g, (match, slashes) =>
            slashes.length % 2 ? match : slashes + "\\|",
          );
      },
    });
  },
});
export function richExtensions() {
  return [
    StarterKit.configure({
      link: false,
      codeBlock: false,
      trailingNode: false,
    }),
    Markdown,
    Link.configure({
      protocols: ["note", "block"],
      openOnClick: false,
      autolink: false,
    }),
    Image.configure({ inline: true }),
    TableKit.configure({ table: false }),
    MarkdownTable,
    TaskList,
    TaskItem.configure({ nested: true }),
    CodeBlockLowlight.configure({ lowlight }),
  ];
}

// A capability check is deliberately conservative: formatting can change bytes,
// but must retain the parsed meaning before a block becomes editable.
import { MarkdownManager } from "@tiptap/markdown";
import { markdownMeaning, richFallbackReason } from "./model";
const manager = new MarkdownManager({ extensions: richExtensions() });
export function richEditingReason(source) {
  const unsupported = richFallbackReason(source);
  if (unsupported) return unsupported;
  try {
    const serialized = manager.serialize(manager.parse(source));
    if (markdownMeaning(source) !== markdownMeaning(serialized))
      return "This Markdown needs source mode to preserve its exact structure.";
    return "";
  } catch {
    return "This Markdown is preserved in source mode.";
  }
}
