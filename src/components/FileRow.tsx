import { FileEntry } from "../types/fileEntry";
import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { RenameInput } from "./RenameInput";

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
      <span className="w-20 shrink-0 text-right text-xs text-gray-500 dark:text-gray-400">
        {isParentDirectory ? "" : sizeLabel}
      </span>
      <span className="w-28 shrink-0 text-right text-xs text-gray-500 dark:text-gray-400">
        {isParentDirectory ? "" : formatDate(entry.modifiedAt)}
      </span>
    </div>
  );
}

/** Compact enough for a narrow column: time for today, otherwise a short date. */
function formatDate(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + " " + sizes[i];
}
