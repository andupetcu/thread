import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { assetMarkdown, uploadAsset } from "./rich/model";

export default function NoteAttachments({ onAttach }) {
  const input = useRef();
  const pending = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function attach(files) {
    if (!files.length || pending.current) return;
    setError("");
    const invalid = files.find((file) => !file.size || file.size > 20_000_000);
    if (invalid) {
      setError(`${invalid.name}: files must be between 1 byte and 20 MB.`);
      return;
    }
    pending.current = true;
    setUploading(true);
    let added = 0;
    try {
      for (const file of files) {
        try {
          const asset = await uploadAsset(file);
          // Keep the callback captured at selection: changing notes must not
          // redirect an in-flight upload to the newly opened note.
          onAttach(assetMarkdown(asset));
          added++;
        } catch (failure) {
          setError(
            `${file.name}: ${failure.message} ${added} file(s) added; remaining files were not uploaded.`,
          );
          break;
        }
      }
    } finally {
      pending.current = false;
      setUploading(false);
    }
  }

  return (
    <div className="note-attachments">
      <button
        type="button"
        aria-label="Attach files"
        aria-busy={uploading}
        title="Upload images or documents to this note · stored locally · up to 20 MB each"
        disabled={uploading}
        onClick={() => input.current.click()}
      >
        <Paperclip size={15} />
        <span>{uploading ? "Uploading…" : "Attach files"}</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload note attachments"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void attach(files);
        }}
      />
      {error && (
        <div className="attachment-error" role="alert">
          {error}
          <button
            type="button"
            aria-label="Dismiss upload error"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
