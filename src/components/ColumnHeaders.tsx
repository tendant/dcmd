import { useFileManagerStore, type PaneId, type SortKey } from "../state/fileManagerStore";
import { ColumnResizer } from "./ColumnResizer";

/**
 * Clickable sort headers, with a drag handle on the leading edge of each fixed
 * column. Clicking the active column reverses it, which is the convention
 * everywhere else and avoids needing a separate direction control.
 */
export function ColumnHeaders({ paneId }: { paneId: PaneId }) {
  const sort = useFileManagerStore((s) => s.panes[paneId].sort);
  const setSort = useFileManagerStore((s) => s.setSort);
  const widths = useFileManagerStore((s) => s.panes[paneId].columnWidths);

  const label = (key: SortKey, text: string) => {
    const active = sort.key === key;
    return (
      <>
        {text}
        {active && <span aria-hidden> {sort.ascending ? "▲" : "▼"}</span>}
      </>
    );
  };

  const headerClass = (key: SortKey, extra: string) =>
    `${extra} truncate hover:text-gray-900 dark:hover:text-gray-100 ${
      sort.key === key ? "font-semibold text-gray-900 dark:text-gray-100" : ""
    }`;

  return (
    <div className="flex items-stretch gap-2 border-b border-gray-300 bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
      {/* Matches the icon column in each row so the labels line up. */}
      <span className="w-4" aria-hidden />
      <button
        onClick={() => setSort(paneId, "name")}
        aria-sort={sort.key === "name" ? (sort.ascending ? "ascending" : "descending") : "none"}
        className={headerClass("name", "min-w-0 flex-1 text-left")}
      >
        {label("name", "Name")}
      </button>

      <ColumnResizer column="size" paneId={paneId} />
      <button
        onClick={() => setSort(paneId, "size")}
        aria-sort={sort.key === "size" ? (sort.ascending ? "ascending" : "descending") : "none"}
        style={{ width: widths.size }}
        className={headerClass("size", "shrink-0 text-right")}
      >
        {label("size", "Size")}
      </button>

      <ColumnResizer column="modified" paneId={paneId} />
      <button
        onClick={() => setSort(paneId, "modified")}
        aria-sort={
          sort.key === "modified" ? (sort.ascending ? "ascending" : "descending") : "none"
        }
        style={{ width: widths.modified }}
        className={headerClass("modified", "shrink-0 text-right")}
      >
        {label("modified", "Modified")}
      </button>
    </div>
  );
}
