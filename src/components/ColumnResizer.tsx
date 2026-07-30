import { useRef, useState } from "react";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  useFileManagerStore,
  type ResizableColumn,
} from "../state/fileManagerStore";

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
export function ColumnResizer({ column }: { column: ResizableColumn }) {
  const width = useFileManagerStore((s) => s.columnWidths[column]);
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
          setColumnWidth(column, from.width - (e.clientX - from.x));
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
        resetColumnWidths();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setColumnWidth(column, width + 8);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setColumnWidth(column, width - 8);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          resetColumnWidths();
        }
      }}
      title="Drag to resize, double-click to reset"
      className={`mx-0.5 w-1 shrink-0 cursor-col-resize self-stretch rounded ${
        dragging ? "bg-blue-500" : "bg-transparent hover:bg-blue-400"
      } focus:outline-none focus-visible:bg-blue-500`}
    />
  );
}
