import { useFileManagerStore, type PaneId } from "../state/fileManagerStore";
import { MOD, SHIFT } from "../platform";

/**
 * Bookmarks and SSH hosts across the top, as one click each.
 *
 * Both were reachable only through a submenu, which is a poor home for the
 * places you go most. Everything here is also on a shortcut — the bar is the
 * discoverable surface for bindings that would otherwise have to be memorised.
 */
export function PlacesBar() {
  const shown = useFileManagerStore((s) => s.showPlaces);
  const bookmarks = useFileManagerStore((s) => s.bookmarks);
  const remotes = useFileManagerStore((s) => s.remotes);
  const activePane = useFileManagerStore((s) => s.activePane);
  const panes = useFileManagerStore((s) => s.panes);
  const connectPane = useFileManagerStore((s) => s.connectPane);
  const openContextMenu = useFileManagerStore((s) => s.openContextMenu);

  if (!shown || (bookmarks.length === 0 && remotes.length === 0)) return null;

  // Alt sends the place to the pane you are not in, which is most of the point
  // of a two-pane file manager: line up a source and a destination.
  const target = (e: React.MouseEvent): PaneId =>
    e.altKey ? (activePane === "left" ? "right" : "left") : activePane;

  const menuFor = (kind: "bookmark" | "remote", id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({ x: e.clientX, y: e.clientY, pane: activePane, path: null, place: { kind, id } });
  };

  const chip =
    "shrink-0 rounded px-2 py-0.5 text-[11px] whitespace-nowrap border transition-colors";

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto border-b border-gray-300 bg-gray-100 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
      title="Click to open in the active pane, Alt-click for the other one"
    >
      {bookmarks.map((b, i) => (
        <button
          key={`b:${b.path}`}
          // Through connectPane, not navigate: a bookmark carries the machine
          // it belongs to, and opening a local one from a pane that is on a
          // server has to come back here rather than look for the path there.
          onClick={(e) => void connectPane(target(e), b.remote ?? null, b.path)}
          onContextMenu={menuFor("bookmark", b.path)}
          title={`${b.remote ? `${b.remote}:` : ""}${b.path}${i < 9 ? `  (${MOD}${SHIFT}${i + 1})` : ""}`}
          className={`${chip} border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-blue-300`}
        >
          <span aria-hidden className="mr-1">
            {b.remote ? "⇄" : "★"}
          </span>
          {b.name}
        </button>
      ))}

      {bookmarks.length > 0 && remotes.length > 0 && (
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-gray-300 dark:bg-gray-600" />
      )}

      {remotes.map((r) => {
        // Marked when a pane is already on this host, so it is obvious where
        // you are before clicking somewhere expensive.
        const connected = panes.left.remote === r.alias || panes.right.remote === r.alias;
        return (
          <button
            key={`r:${r.alias}`}
            onClick={(e) => void connectPane(target(e), r.alias)}
            onContextMenu={menuFor("remote", r.alias)}
            title={`${r.alias}:${r.startPath || "/"}`}
            className={`${chip} ${
              connected
                ? "border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100"
                : "border-gray-300 bg-white text-gray-700 hover:border-violet-400 hover:text-violet-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-violet-300"
            }`}
          >
            <span aria-hidden className="mr-1">
              ⇄
            </span>
            {r.name || r.alias}
          </button>
        );
      })}
    </div>
  );
}
