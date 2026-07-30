import { FileEntry } from "../types/fileEntry";
import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { RenameInput } from "./RenameInput";
import { formatBytes, formatTimestamp } from "../format";

interface FileRowProps {
  entry: FileEntry;
  paneId: PaneId;
  isSelected: boolean;
  isCursor: boolean;
  isRenaming: boolean;
  /** True for the placeholder row hosting the new-folder input. */
  isCreating?: boolean;
  index: number;
  isParentDirectory?: boolean;
}

export function FileRow({
  entry,
  paneId,
  isSelected,
  isCursor,
  isRenaming,
  isCreating = false,
  index,
  isParentDirectory = false,
}: FileRowProps) {
  const toggleSelection = useFileManagerStore((s) => s.toggleSelection);
  const selectRange = useFileManagerStore((s) => s.selectRange);
  const setCursor = useFileManagerStore((s) => s.setCursor);
  const paneState = useFileManagerStore((s) => s.panes[paneId]);
  const commitRename = useFileManagerStore((s) => s.commitRename);
  const commitMkdir = useFileManagerStore((s) => s.commitMkdir);
  const navigate = useFileManagerStore((s) => s.navigate);
  const goToParent = useFileManagerStore((s) => s.goToParent);
  const openEntry = useFileManagerStore((s) => s.openEntry);
  const openContextMenu = useFileManagerStore((s) => s.openContextMenu);
  const clearSelection = useFileManagerStore((s) => s.clearSelection);
  const setActivePane = useFileManagerStore((s) => s.setActivePane);

  if (isRenaming) {
    return (
      <div
        className={`flex items-center px-2 py-1 text-sm font-mono border-l-2 ${
          isCursor ? "border-l-blue-500 bg-blue-50 dark:bg-blue-900" : "border-l-transparent"
        }`}
      >
        <span className="mr-2">📁</span>
        <RenameInput
          paneId={paneId}
          initialValue={isCreating ? "" : entry.name}
          onCommit={(name) =>
            isCreating
              ? commitMkdir(paneId, name)
              : commitRename(paneId, entry.path, name)
          }
        />
      </div>
    );
  }

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click to select range
      if (paneState.rangeStart !== null) {
        selectRange(paneId, paneState.rangeStart, index);
      } else {
        selectRange(paneId, paneState.cursor, index);
      }
      setCursor(paneId, index);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click to toggle selection
      toggleSelection(paneId, entry.path);
    } else {
      // Single click positions cursor
      setCursor(paneId, index);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // ".." is not a real entry, so it gets the folder menu rather than nothing.
    // A directory full enough to have no blank space below the rows would
    // otherwise leave no way to reach those actions from the list at all, and
    // this row is always present.
    if (isParentDirectory) {
      setActivePane(paneId);
      openContextMenu({ x: e.clientX, y: e.clientY, pane: paneId, path: null });
      return;
    }

    // Right-clicking a row that is not part of the selection acts on that row,
    // so the menu can never describe acting on something the click did not hit.
    if (!paneState.selected.has(entry.path)) {
      clearSelection(paneId);
      setCursor(paneId, index);
    }
    setActivePane(paneId);
    openContextMenu({ x: e.clientX, y: e.clientY, pane: paneId, path: entry.path });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isParentDirectory) {
      // Double-click on .. goes up one level
      goToParent(paneId);
    } else if (entry.kind === "directory") {
      // Double-click navigates into directories
      navigate(paneId, entry.path);
    } else {
      // Files open in whatever application the OS has associated with them
      openEntry(paneId, entry.path);
    }
  };

  // Files show their byte size. Directories show their item count until the
  // user presses Space, which computes the (expensive) recursive total size.
  let sizeLabel = "";
  if (entry.kind === "directory") {
    const computed = paneState.dirSizes[entry.path];
    if (computed === "pending") {
      sizeLabel = "…";
    } else if (typeof computed === "number") {
      sizeLabel = formatBytes(computed);
    } else if (entry.itemCount !== null) {
      sizeLabel = `${entry.itemCount} item${entry.itemCount === 1 ? "" : "s"}`;
    }
  } else if (entry.size !== null) {
    sizeLabel = formatBytes(entry.size);
  }

  const icon = isParentDirectory
    ? "⬆️"
    : entry.kind === "directory"
      ? "📁"
      : entry.kind === "symlink"
        ? "🔗"
        : "📄";

  return (
    <div
      onClick={handleRowClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={`flex items-center gap-2 px-2 py-1 text-sm font-mono border-l-4 cursor-pointer select-none transition-colors ${
        isCursor
          ? "border-l-blue-600 bg-blue-200 dark:bg-blue-800 font-semibold text-gray-900 dark:text-gray-100"
          : isSelected
            ? "border-l-blue-400 bg-blue-100 dark:bg-blue-900 text-gray-900 dark:text-gray-100"
            : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
      } ${
        isParentDirectory ? "text-amber-700 dark:text-amber-400" : entry.hidden ? "text-gray-400" : "text-gray-900 dark:text-gray-100"
      }`}
    >
      <span className="w-4 shrink-0">{icon}</span>
      <span className="flex-1 truncate">{entry.name}</span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {isParentDirectory ? "" : sizeLabel}
      </span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {isParentDirectory ? "" : formatTimestamp(entry.modifiedAt)}
      </span>
    </div>
  );
}
