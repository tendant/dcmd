import { useRef, useEffect } from "react";
import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { MOD } from "../platform";

interface PathBarProps {
  path: string;
  paneId: PaneId;
  isEditing: boolean;
}

function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function PathBar({ path, paneId, isEditing }: PathBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const startEditingPath = useFileManagerStore((s) => s.startEditingPath);
  const commitPathEdit = useFileManagerStore((s) => s.commitPathEdit);
  const cancelPathEdit = useFileManagerStore((s) => s.cancelPathEdit);
  const remote = useFileManagerStore((s) => s.panes[paneId].remote);
  const listingAge = useFileManagerStore((s) => s.listingAge);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const newPath = inputRef.current?.value || "";
      if (newPath.trim()) {
        commitPathEdit(paneId, newPath);
      } else {
        cancelPathEdit(paneId);
      }
    } else if (e.key === "Escape") {
      cancelPathEdit(paneId);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        defaultValue={path}
        onKeyDown={handleKeyDown}
        onBlur={() => cancelPathEdit(paneId)}
        className="w-full bg-gray-100 dark:bg-gray-800 px-3 py-2 border-b-2 border-blue-500 text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none"
      />
    );
  }

  const age = remote ? listingAge(paneId) : null;

  return (
    <div
      onClick={() => startEditingPath(paneId)}
      className={`flex items-center px-3 py-2 border-b text-sm font-mono truncate cursor-text ${
        remote
          ? "border-violet-400 bg-violet-50 text-violet-950 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900"
          : "border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
      }`}
      title={`Click to edit path, or press ${MOD}L`}
    >
      {remote && (
        <>
          {/* A remote pane has to be unmistakable: the operations available on
              it differ, and acting on the wrong machine is expensive. */}
          <span className="mr-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {remote}
          </span>
          {age !== null && (
            <span
              className="mr-1.5 text-[10px] text-gray-500 dark:text-gray-400"
              title="Cached listing. Press Cmd/Ctrl+R to refetch."
            >
              {formatAge(age)}
            </span>
          )}
        </>
      )}
      {path || "/"}
    </div>
  );
}
