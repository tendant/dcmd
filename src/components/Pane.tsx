import { useFileManagerStore, visibleEntries, PaneId } from "../state/fileManagerStore";
import { PathBar } from "./PathBar";
import { FileList } from "./FileList";
import { ErrorBar } from "./ErrorBar";
import { ColumnHeaders } from "./ColumnHeaders";
import { StatusBar } from "./StatusBar";

interface PaneProps {
  paneId: PaneId;
}

export function Pane({ paneId }: PaneProps) {
  const paneState = useFileManagerStore((s) => s.panes[paneId]);
  const activePane = useFileManagerStore((s) => s.activePane);
  const setActivePane = useFileManagerStore((s) => s.setActivePane);
  const clearFilter = useFileManagerStore((s) => s.clearFilter);
  const openContextMenu = useFileManagerStore((s) => s.openContextMenu);

  const isActive = activePane === paneId;
  const visible = visibleEntries(paneState);

  const handlePaneContextMenu = (e: React.MouseEvent) => {
    // Rows stop propagation, so reaching here means empty space.
    e.preventDefault();
    setActivePane(paneId);
    openContextMenu({ x: e.clientX, y: e.clientY, pane: paneId, path: null });
  };

  const handlePaneClick = () => {
    if (!isActive) {
      setActivePane(paneId);
    }
  };

  return (
    <div
      onClick={handlePaneClick}
      onContextMenu={handlePaneContextMenu}
      className={`flex flex-col h-full border ${
        isActive ? "border-blue-500" : "border-gray-300 dark:border-gray-700"
      }`}
    >
      <PathBar path={paneState.path} paneId={paneId} isEditing={paneState.isEditingPath} />

      {paneState.error && <ErrorBar error={paneState.error} paneId={paneId} />}

      {paneState.loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 p-4">
          <div className="text-lg mb-2">Loading...</div>
          <div className="text-xs text-gray-400">{paneState.path}</div>
        </div>
      ) : (
        <>
        <ColumnHeaders paneId={paneId} />
        <FileList
          entries={visible}
          selected={paneState.selected}
          cursor={paneState.cursor}
          paneId={paneId}
          renameMode={paneState.renameMode}
          filter={paneState.filter}
        />
        </>
      )}

      {paneState.filter && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs font-mono border-t border-gray-300 bg-amber-50 dark:border-gray-700 dark:bg-amber-950">
          <span className="text-gray-500 dark:text-gray-400">filter:</span>
          <span className="flex-1 truncate font-semibold text-amber-800 dark:text-amber-200">
            {paneState.filter}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {visible.length} of {paneState.entries.length}
          </span>
          <button
            onClick={() => clearFilter(paneId)}
            className="px-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            title="Clear filter (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      <StatusBar paneId={paneId} />
    </div>
  );
}
