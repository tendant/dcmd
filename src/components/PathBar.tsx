import { useRef, useEffect } from "react";
import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { MOD } from "../platform";

interface PathBarProps {
  path: string;
  paneId: PaneId;
  isEditing: boolean;
}

export function PathBar({ path, paneId, isEditing }: PathBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const startEditingPath = useFileManagerStore((s) => s.startEditingPath);
  const commitPathEdit = useFileManagerStore((s) => s.commitPathEdit);
  const cancelPathEdit = useFileManagerStore((s) => s.cancelPathEdit);

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

  return (
    <div
      onClick={() => startEditingPath(paneId)}
      className="bg-gray-100 dark:bg-gray-800 px-3 py-2 border-b border-gray-300 dark:border-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100 truncate cursor-text hover:bg-gray-200 dark:hover:bg-gray-700"
      title={`Click to edit path, or press ${MOD}L`}
    >
      {path || "/"}
    </div>
  );
}
