export function Toolbar() {
  return (
    <div className="bg-gray-200 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-700 px-4 py-2 text-xs font-mono text-gray-700 dark:text-gray-300">
      <div className="flex justify-between">
        <div>
          <span className="mr-4">F5 Copy</span>
          <span className="mr-4">F6 Move</span>
          <span className="mr-4">F7 Mkdir</span>
          <span>F8 Trash</span>
        </div>
        <div>
          <span className="mr-4">Tab Pane</span>
          <span className="mr-4">⏎ Enter Dir</span>
          <span className="mr-4">Space Select</span>
          <span className="mr-4">Shift+↑↓ Range</span>
          <span className="mr-4">Shift+Click Range</span>
          <span>Double-click Open</span>
        </div>
      </div>
    </div>
  );
}
