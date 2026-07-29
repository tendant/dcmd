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
}

export function FileRow({
  entry,
  paneId,
  isSelected,
  isCursor,
  isRenaming,
  index,
}: FileRowProps) {
  const toggleSelection = useFileManagerStore((s) => s.toggleSelection);
  const setCursor = useFileManagerStore((s) => s.setCursor);
  const commitRename = useFileManagerStore((s) => s.commitRename);

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

  const navigate = useFileManagerStore((s) => s.navigate);

  const handleRowClick = (e: React.MouseEvent) => {
    setCursor(paneId, index);

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click to toggle selection
      toggleSelection(paneId, entry.path);
    } else if (entry.kind === "directory" && !e.metaKey && !e.ctrlKey) {
      // Click navigates into directories
      navigate(paneId, entry.path);
    }
  };

  const icon =
    entry.kind === "directory"
      ? "📁"
      : entry.kind === "symlink"
        ? "🔗"
        : "📄";

  return (
    <div
      onClick={handleRowClick}
      className={`flex items-center px-2 py-1 text-sm font-mono border-l-2 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 ${
        isSelected ? "bg-blue-200 dark:bg-blue-900" : ""
      } ${isCursor ? "border-l-blue-500 bg-blue-50 dark:bg-blue-900" : "border-l-transparent"} ${
        entry.hidden ? "text-gray-400" : "text-gray-900 dark:text-gray-100"
      }`}
    >
      <span className="mr-2">{icon}</span>
      <span className="flex-1 truncate">{entry.name}</span>
      {entry.size !== null && (
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
