import { useEffect, useRef } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import { toAppError } from "../errors";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

const OP_TITLE = { copy: "Copy", move: "Move", delete: "Delete" } as const;

/** Lists names, summarising past a handful so the dialog stays readable. */
function NameList({ names, limit = 8 }: { names: string[]; limit?: number }) {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return (
    <ul className="my-2 max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
      {shown.map((n) => (
        <li key={n} className="truncate py-0.5">
          {n}
        </li>
      ))}
      {rest > 0 && <li className="py-0.5 text-gray-500">…and {rest} more</li>}
    </ul>
  );
}

/**
 * Modal for the two questions that must not be answered on the user's behalf:
 * what to do about a name clash, and whether to delete.
 *
 * Replaces window.confirm, which could only show a count. Naming the files is the
 * point — "Delete 3 items?" is not enough information to answer safely.
 */
export function Dialog() {
  const dialog = useFileManagerStore((s) => s.dialog);
  const dismiss = useFileManagerStore((s) => s.dismissDialog);
  const performTransfer = useFileManagerStore((s) => s.performTransfer);
  const trashSelection = useFileManagerStore((s) => s.trashSelection);
  const defaultRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog) defaultRef.current?.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    // Captured so the global shortcut handler never sees these while modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog, dismiss]);

  if (!dialog) return null;

  const button =
    "rounded px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-gray-600 " +
    "hover:bg-gray-100 dark:hover:bg-gray-700";
  const primary =
    "rounded px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700";
  const danger =
    "rounded px-3 py-1.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800 dark:text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {dialog.kind === "transferOutcome" ? (
          <>
            <h2 className="text-base font-semibold">
              {OP_TITLE[dialog.op]}
              {dialog.failed.length > 0 ? " finished with problems" : " finished"}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {dialog.completed} succeeded
              {dialog.skipped.length > 0 && `, ${dialog.skipped.length} skipped`}
              {dialog.failed.length > 0 && `, ${dialog.failed.length} failed`}.
            </p>

            {dialog.failed.length > 0 && (
              <div className="my-2 max-h-52 overflow-y-auto rounded border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
                {dialog.failed.map((f) => {
                  // Each failure is phrased individually; a shared summary cannot
                  // say why this particular item did not make it.
                  const mapped = toAppError({ kind: f.kind, message: f.message }, dialog.op);
                  return (
                    <div
                      key={f.path}
                      className="border-b border-red-100 px-3 py-1.5 last:border-0 dark:border-red-900"
                    >
                      <div className="truncate font-mono text-xs text-red-900 dark:text-red-100">
                        {basename(f.path)}
                      </div>
                      <div className="text-xs text-red-800/80 dark:text-red-200/70">
                        {mapped.message}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {dialog.skipped.length > 0 && (
              <>
                <div className="mt-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                  Skipped (already present):
                </div>
                <NameList names={dialog.skipped.map(basename)} limit={5} />
              </>
            )}

            <div className="mt-3 flex justify-end">
              <button ref={defaultRef} className={primary} onClick={dismiss}>
                Close
              </button>
            </div>
          </>
        ) : dialog.kind === "conflict" ? (
          <>
            <h2 className="text-base font-semibold">
              {dialog.names.length === 1
                ? "1 item already exists"
                : `${dialog.names.length} items already exist`}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              These names are already in {dialog.destination}:
            </p>
            <NameList names={dialog.names} />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button className={button} onClick={dismiss}>
                Cancel
              </button>
              <button
                className={button}
                onClick={() =>
                  performTransfer(
                    dialog.op,
                    dialog.pane,
                    dialog.sources,
                    dialog.destination,
                    "skip",
                  )
                }
              >
                Skip these
              </button>
              <button
                className={danger}
                onClick={() =>
                  performTransfer(
                    dialog.op,
                    dialog.pane,
                    dialog.sources,
                    dialog.destination,
                    "overwrite",
                  )
                }
              >
                Replace
              </button>
              <button
                ref={defaultRef}
                className={primary}
                onClick={() =>
                  performTransfer(
                    dialog.op,
                    dialog.pane,
                    dialog.sources,
                    dialog.destination,
                    "keepBoth",
                  )
                }
              >
                Keep both
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">
              Move {dialog.paths.length === 1 ? "this item" : `${dialog.paths.length} items`} to
              Trash?
            </h2>
            <NameList names={dialog.paths.map(basename)} />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Recoverable from the system Trash.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button ref={defaultRef} className={button} onClick={dismiss}>
                Cancel
              </button>
              <button className={danger} onClick={() => trashSelection(dialog.pane)}>
                Move to Trash
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
