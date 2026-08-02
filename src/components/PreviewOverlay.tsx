import { useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { Preview } from "../tauri/commands";

/**
 * Turns Markdown into HTML that is safe to insert.
 *
 * The sanitising step is not defensive tidiness. This window's origin can call
 * IPC, so script that survived from a previewed file would be running with the
 * app's full reach over the filesystem — a `.md` downloaded from anywhere would
 * be an execution vector. Exported so a test can prove the boundary holds.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    // Nothing that loads or runs anything of its own. Markdown needs none of
    // them, and each is a way back to executing something.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["style", "srcset", "formaction", "form"],
  });
}

function Body({ content }: { content: Preview }) {
  const openEntry = useFileManagerStore((s) => s.openEntry);
  const preview = useFileManagerStore((s) => s.preview);

  const html = useMemo(
    () => (content.kind === "markdown" ? renderMarkdown(content.content) : ""),
    [content],
  );

  switch (content.kind) {
    case "text":
      return (
        <div className="flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
            {content.content}
          </pre>
          {content.truncated && <Truncated />}
        </div>
      );

    case "markdown":
      return (
        <div className="flex-1 overflow-auto">
          <div
            className="preview-markdown p-4 text-sm leading-relaxed"
            // Sanitised directly above. Never render `content.content` raw.
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {content.truncated && <Truncated />}
        </div>
      );

    case "image":
      return (
        <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-950/5 p-4 dark:bg-black/30">
          {/* An <img>, deliberately: an SVG here cannot run script, where the
              same file in an <object> or iframe could. */}
          <img
            src={`data:${content.mime};base64,${content.data}`}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );

    case "pdf":
      return (
        <embed
          type="application/pdf"
          src={`data:application/pdf;base64,${content.data}`}
          className="min-h-0 flex-1"
        />
      );

    case "unsupported":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-gray-600 dark:text-gray-400">
          <p>{content.reason}</p>
          {/* There is still a way to see it, just not in here. */}
          {preview && (
            <button
              onClick={() => void openEntry("left", preview.path)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              Open in default app
            </button>
          )}
        </div>
      );
  }
}

function Truncated() {
  return (
    <p className="border-t border-amber-300 bg-amber-50 px-3 py-1 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      Showing the first part of this file only.
    </p>
  );
}

/**
 * Read-only view of the file under the cursor.
 *
 * An overlay rather than a third pane: preview is a glance, and permanently
 * giving up a third of a two-pane window to it would cost more than it returns.
 */
export function PreviewOverlay() {
  const preview = useFileManagerStore((s) => s.preview);
  const close = useFileManagerStore((s) => s.closePreview);

  useEffect(() => {
    if (!preview) return;
    // Captured, so the global handler never sees the key: Escape there means
    // cancel a transfer, then clear a filter, and it must not do either while
    // this is the thing in front of you.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [preview, close]);

  if (!preview) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${preview.name}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900 dark:text-gray-100"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-300 px-3 py-2 dark:border-gray-700">
          <span className="truncate font-mono text-sm">{preview.name}</span>
          <button
            onClick={close}
            aria-label="Close preview"
            className="shrink-0 rounded px-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Esc ✕
          </button>
        </div>

        {preview.error ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-700 dark:text-red-300">
            {preview.error}
          </div>
        ) : preview.content ? (
          <Body content={preview.content} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Reading…
          </div>
        )}
      </div>
    </div>
  );
}
