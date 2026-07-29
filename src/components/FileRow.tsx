import { FileEntry } from "../types/fileEntry";
import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { RenameInput } from "./RenameInput";

interface FileRowProps {
  entry: FileEntry;
  paneId: PaneId;
  isSelected: boolean;
  isCursor: boolean;
  isRenaming: boolean;
  index: number;
  isParentDirectory?: boolean;
}

export function FileRow({
  entry,
  paneId,
  isSelected,
  isCursor,
  isRenaming,
  index,
  isParentDirectory = false,
}: FileRowProps) {
  const toggleSelection = useFileManagerStore((s) => s.toggleSelection);
  const setCursor = useFileManagerStore((s) => s.setCursor);
  const commitRename = useFileManagerStore((s) => s.commitRename);
  const navigate = useFileManagerStore((s) => s.navigate);
  const goToParent = useFileManagerStore((s) => s.goToParent);

  if (isRenaming) {
    return (
      <div
        className={`flex items-center px-2 py-1 text-sm font-mono border-l-2 ${
          isCursor ? "border-l-blue-500 bg-blue-50 dark:bg-blue-900" : "border-l-transparent"
        }`}
      >
        <RenameInput
          paneId={paneId}
          initialValue={entry.name}
          onCommit={(newName) => commitRename(paneId, entry.path, newName)}
        />
      </div>
    );
  }

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click to toggle selection
      toggleSelection(paneId, entry.path);
    } else {
      // Single click positions cursor (and optionally selects)
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
    }
  };

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
      className={`flex items-center px-2 py-1 text-sm font-mono border-l-4 cursor-pointer select-none transition-colors ${
        isCursor
          ? "border-l-blue-600 bg-blue-200 dark:bg-blue-800 font-semibold text-gray-900 dark:text-gray-100"
          : isSelected
            ? "border-l-blue-400 bg-blue-100 dark:bg-blue-900 text-gray-900 dark:text-gray-100"
            : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
      } ${
        isParentDirectory ? "text-amber-700 dark:text-amber-400" : entry.hidden ? "text-gray-400" : "text-gray-900 dark:text-gray-100"
      }`}
    >
      <span className="mr-2">{icon}</span>
      <span className="flex-1 truncate">{entry.name}</span>
      {!isParentDirectory && entry.size !== null && (
        <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs min-w-[60px] text-right">
          {formatBytes(entry.size)}
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + " " + sizes[i];
}
