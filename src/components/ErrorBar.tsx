import { useState } from "react";
import type { AppError } from "../errors";
import { useFileManagerStore, type PaneId } from "../state/fileManagerStore";

/**
 * Shows a failure as a sentence plus, where one exists, what to do about it.
 *
 * The raw backend text is kept behind a disclosure rather than shown by default:
 * it carries absolute paths and OS error codes that help when diagnosing but only
 * obscure things for someone trying to get work done. Dismissable, because an
 * error the user has read and understood should not sit there permanently — with
 * Escape as well as the ✕, since reaching for the mouse is the thing this app
 * exists to avoid.
 *
 * Only failures reach here. The app merely declining — "Nothing to copy" — is a
 * notice in the status bar, because a bar this size is a great deal of ceremony
 * for reporting that a keypress did nothing.
 */
export function ErrorBar({ error, paneId }: { error: AppError; paneId: PaneId }) {
  const setPaneError = useFileManagerStore((s) => s.setPaneError);
  const [showDetail, setShowDetail] = useState(false);

  // Worth offering only when it says something the message does not.
  const hasDetail = !!error.detail && error.detail !== error.message;

  return (
    <div className="border-t border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-950">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 shrink-0">
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-red-900 dark:text-red-100">{error.message}</div>
          {error.hint && (
            <div className="mt-0.5 text-xs text-red-800/80 dark:text-red-200/70">{error.hint}</div>
          )}
          {hasDetail && (
            <>
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="mt-1 text-xs text-red-700 underline decoration-dotted hover:no-underline dark:text-red-300"
              >
                {showDetail ? "Hide details" : "Details"}
              </button>
              {showDetail && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-red-100 px-2 py-1 font-mono text-[11px] text-red-900 dark:bg-red-900/40 dark:text-red-100">
                  {error.detail}
                </pre>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => setPaneError(paneId, null)}
          aria-label="Dismiss"
          title="Dismiss"
          className="shrink-0 rounded px-1 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
