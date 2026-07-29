import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useEffect } from "react";
import { FileEntry } from "../types/fileEntry";
import type { PaneId } from "../state/fileManagerStore";
import { FileRow } from "./FileRow";

const ROW_HEIGHT = 24;

interface FileListProps {
  entries: FileEntry[];
  selected: Set<string>;
  cursor: number;
  paneId: PaneId;
  renameMode: any;
}

export function FileList({
  entries,
  selected,
  cursor,
  paneId,
  renameMode,
}: FileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Auto-scroll to cursor
  useEffect(() => {
    virtualizer.scrollToIndex(cursor, { align: "center" });
  }, [cursor, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
        {entries.length === 0 ? "No files" : "Loading..."}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto bg-white dark:bg-gray-950"
      style={{ height: "100%" }}
    >
      <div style={{ height: `${totalSize}px`, position: "relative" }}>
        {virtualItems.map((virtualItem) => {
          const entry = entries[virtualItem.index];
          const isRenaming =
            renameMode &&
            ((renameMode.type === "rename" && renameMode.path === entry.path) ||
              (renameMode.type === "creating" && virtualItem.index === entries.length - 1));

          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <FileRow
                entry={entry}
                paneId={paneId}
                isSelected={selected.has(entry.path)}
                isCursor={virtualItem.index === cursor}
                isRenaming={isRenaming}
                index={virtualItem.index}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
