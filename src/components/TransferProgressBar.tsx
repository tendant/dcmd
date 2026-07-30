import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { TransferProgress } from "../tauri/commands";

/**
 * Shows a running copy or move and offers a way out of it.
 *
 * Without this a large transfer looks like a frozen app, and there is no way to
 * change your mind once it starts.
 */
export function TransferProgressBar() {
  const transfer = useFileManagerStore((s) => s.transfer);
  const setProgress = useFileManagerStore((s) => s.setTransferProgress);
  const cancel = useFileManagerStore((s) => s.cancelTransfer);

  useEffect(() => {
    // Subscribed once for the app's lifetime; the store ignores events whose id
    // does not match the transfer currently on screen.
    const unlisten = listen<TransferProgress>("transfer://progress", (e) => {
      setProgress(e.payload);
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, [setProgress]);

  if (!transfer) return null;

  const { op, current, total, name } = transfer;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div className="border-t border-gray-300 bg-blue-50 px-3 py-2 dark:border-gray-700 dark:bg-blue-950">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-semibold capitalize">{op}ing</span>
        <span className="flex-1 truncate font-mono text-gray-600 dark:text-gray-400">
          {name || "…"}
        </span>
        <span className="tabular-nums text-gray-600 dark:text-gray-400">
          {current} / {total}
        </span>
        <button
          onClick={cancel}
          className="rounded border border-gray-300 px-2 py-0.5 font-medium hover:bg-white dark:border-gray-600 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
        <div
          className="h-full bg-blue-600 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
