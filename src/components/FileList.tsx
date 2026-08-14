import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useEffect } from "react";
import { FileEntry } from "../types/fileEntry";
import { useFileManagerStore, type PaneId } from "../state/fileManagerStore";
import { FileRow } from "./FileRow";

const ROW_HEIGHT = 24;

interface FileListProps {
  entries: FileEntry[];
  selected: Set<string>;
  cursor: number;
  paneId: PaneId;
  renameMode: any;
  filter: string;
}

// Blank row that hosts the inline input while creating a folder.
const NEW_FOLDER_PLACEHOLDER: FileEntry = {
  name: "",
  path: "",
  kind: "directory",
  size: null,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
};

// Synthetic parent directory entry
const PARENT_ENTRY: FileEntry = {
  name: "..",
  path: "",
  kind: "directory",
  size: null,
  itemCount: null,
  modifiedAt: null,
  createdAt: null,
  hidden: false,
};

/**
 * Composes the rows a pane displays: the ".." row, the entries, and while
 * creating a folder a trailing blank placeholder to host the input.
 *
 * Two things this must get right, both of which were previously wrong:
 * the ".." row exists even when the directory is empty, so there is always a way
 * back out; and the new-folder input is an *extra* trailing row rather than the
 * last existing entry, which would hide that entry and prefill its name.
 */
export function buildDisplayRows(
  entries: FileEntry[],
  isCreating: boolean,
): { rows: FileEntry[]; newFolderIndex: number } {
  const rows = [PARENT_ENTRY, ...entries];
  if (!isCreating) return { rows, newFolderIndex: -1 };
  rows.push(NEW_FOLDER_PLACEHOLDER);
  return { rows, newFolderIndex: rows.length - 1 };
}

export function FileList({
  entries,
  selected,
  cursor,
  paneId,
  renameMode,
  filter,
}: FileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const clearSelection = useFileManagerStore((s) => s.clearSelection);

  const isCreating = renameMode?.type === "creating";
  const { rows: displayEntries, newFolderIndex } = buildDisplayRows(entries, !!isCreating);

  const virtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Auto-scroll to cursor only if out of view
  useEffect(() => {
    virtualizer.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  /**
   * Clicking past the end of the listing drops the marks, the way a plain click
   * on a row narrows them to that row: pointing at nothing is how you say
   * "nothing", and it is the only way back to an empty selection without the
   * keyboard.
   *
   * Rows live in their own children, so a click that lands on this element came
   * from the blank space below them. Testing the target rather than stopping
   * propagation in the rows keeps their clicks reaching the pane, which is what
   * focuses it, and the document, which is what closes an open context menu.
   */
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) clearSelection(paneId);
  };

  return (
    <div
      ref={parentRef}
      onClick={handleBackgroundClick}
      className="flex-1 overflow-y-auto bg-white dark:bg-gray-950"
      style={{ height: "100%" }}
    >
      <div style={{ height: `${totalSize}px`, position: "relative" }}>
        {virtualItems.map((virtualItem) => {
          const entry = displayEntries[virtualItem.index];
          const isParent = virtualItem.index === 0;
          const isNewFolderRow = virtualItem.index === newFolderIndex;
          const isRenaming =
            isNewFolderRow ||
            (!!renameMode &&
              !isParent &&
              renameMode.type === "rename" &&
              renameMode.path === entry.path);

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
                isSelected={!isParent && selected.has(entry.path)}
                isCursor={virtualItem.index === cursor}
                isRenaming={isRenaming}
                isCreating={isNewFolderRow}
                index={virtualItem.index}
                isParentDirectory={isParent}
              />
            </div>
          );
        })}
      </div>

      {/* Shown below the ".." row rather than replacing the list: an empty
          directory still needs a way back out. */}
      {entries.length === 0 && !isCreating && (
        <div className="px-2 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
          {filter ? `No matches for "${filter}"` : "No files"}
        </div>
      )}
    </div>
  );
}
