import { useRef, useState } from "react";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  useFileManagerStore,
  type PaneId,
  type ResizableColumn,
} from "../state/fileManagerStore";

/**
 * Geometry of the handle, shared with the spacer FileRow puts in its place.
 * Kept in one constant because the two are flex children of lists that must line
 * up, and hand-matching the widths in two files is how they drift apart.
 */
export const COLUMN_HANDLE_CLASS = "mx-1 w-2 shrink-0";


/**
 * The grab handle on a column's leading edge.
 *
 * Size and Modified are right-aligned at the end of the row, so dragging the
 * handle left makes the column to its right wider — the edge moves with the
 * pointer, which is what the gesture looks like it should do.
 *
 * Uses pointer capture for the same reason the pane divider does: the handle is
 * a few pixels wide and the pointer leaves it long before the layout follows.
 */
export function ColumnResizer({
  column,
  paneId,
}: {
  column: ResizableColumn;
  paneId: PaneId;
}) {
  const width = useFileManagerStore((s) => s.panes[paneId].columnWidths[column]);
  const setColumnWidth = useFileManagerStore((s) => s.setColumnWidth);
  const resetColumnWidths = useFileManagerStore((s) => s.resetColumnWidths);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const frame = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column} column`}
      aria-valuenow={width}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging || !start.current) return;
        const from = start.current;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          setColumnWidth(paneId, column, from.width - (e.clientX - from.x));
        });
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        setDragging(false);
      }}
      // Clicking a header sorts; a resize must not also reorder the list.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        resetColumnWidths(paneId);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setColumnWidth(paneId, column, width + 8);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setColumnWidth(paneId, column, width - 8);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          resetColumnWidths(paneId);
        }
      }}
      title="Drag to resize, double-click to reset"
      className={`${COLUMN_HANDLE_CLASS} group flex cursor-col-resize items-stretch justify-center self-stretch focus:outline-none`}
    >
      {/* A visible rule inside a wider grab area: the line has to be thin to read
          as a divider, but a 1px target is unusable. */}
      <span
        aria-hidden
        className={`w-px transition-colors ${
          dragging
            ? "bg-blue-500"
            : "bg-gray-300 group-hover:bg-blue-400 group-focus-visible:bg-blue-500 dark:bg-gray-600"
        }`}
      />
    </div>
  );
}
