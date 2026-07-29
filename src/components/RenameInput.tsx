import { useEffect, useRef } from "react";
import { useFileManagerStore } from "../state/fileManagerStore";
import type { PaneId } from "../state/fileManagerStore";

interface RenameInputProps {
  paneId: PaneId;
  initialValue?: string;
  onCommit: (value: string) => void;
}

export function RenameInput({
  paneId,
  initialValue = "",
  onCommit,
}: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelInlineEdit = useFileManagerStore((s) => s.cancelInlineEdit);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    if (e.key === "Enter") {
      const value = inputRef.current?.value || "";
      if (value.trim()) {
        onCommit(value);
      } else {
        cancelInlineEdit(paneId);
      }
    } else if (e.key === "Escape") {
      cancelInlineEdit(paneId);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={initialValue}
      onKeyDown={handleKeyDown}
      onBlur={() => cancelInlineEdit(paneId)}
      className="w-full px-2 py-1 border border-blue-500 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm font-mono"
      autoFocus
    />
  );
}
