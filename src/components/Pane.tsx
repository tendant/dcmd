import { useFileManagerStore, PaneId } from "../state/fileManagerStore";
import { PathBar } from "./PathBar";
import { FileList } from "./FileList";

interface PaneProps {
  paneId: PaneId;
}

export function Pane({ paneId }: PaneProps) {
  const paneState = useFileManagerStore((s) => s.panes[paneId]);
  const activePane = useFileManagerStore((s) => s.activePane);
  const setActivePane = useFileManagerStore((s) => s.setActivePane);

  const isActive = activePane === paneId;

  const handlePaneClick = () => {
    if (!isActive) {
      setActivePane(paneId);
    }
  };

  return (
    <div
      onClick={handlePaneClick}
      className={`flex flex-col h-full border ${
        isActive ? "border-blue-500" : "border-gray-300 dark:border-gray-700"
      }`}
    >
      <PathBar path={paneState.path} paneId={paneId} isEditing={paneState.isEditingPath} />

      {paneState.error && (
        <div className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100 px-3 py-2 text-sm">
          {paneState.error}
        </div>
      )}

      {paneState.loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
          Loading...
        </div>
      ) : (
        <FileList
          entries={paneState.entries}
          selected={paneState.selected}
          cursor={paneState.cursor}
          paneId={paneId}
          renameMode={paneState.renameMode}
        />
      )}
    </div>
  );
}
