import { useCallback, useRef, useState } from "react";
import { MAX_SPLIT, MIN_SPLIT, useFileManagerStore } from "../state/fileManagerStore";

/**
 * The draggable split between the panes.
 *
 * Pointer capture is used rather than window listeners so the drag survives the
 * cursor leaving the divider — which it will, since the divider is a few pixels
 * wide and the pointer moves faster than the layout follows.
 */
export function PaneDivider({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const splitRatio = useFileManagerStore((s) => s.splitRatio);
  const setSplitRatio = useFileManagerStore((s) => s.setSplitRatio);
  const resetSplit = useFileManagerStore((s) => s.resetSplit);
  const nudgeSplit = useFileManagerStore((s) => s.nudgeSplit);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const applyFromPointer = useCallback(
    (clientX: number) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      // Coalesce to one update per frame; pointermove fires far more often than
      // the layout can usefully change.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setSplitRatio((clientX - box.left) / box.width);
      });
    },
    [containerRef, setSplitRatio],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuenow={Math.round(splitRatio * 100)}
      aria-valuemin={Math.round(MIN_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_SPLIT * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) applyFromPointer(e.clientX);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onDoubleClick={resetSplit}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          nudgeSplit(-0.05);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          nudgeSplit(0.05);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          resetSplit();
        }
      }}
      title="Drag to resize, double-click to even up"
      className={`w-1 shrink-0 cursor-col-resize border-x border-gray-300 transition-colors dark:border-gray-700 ${
        dragging ? "bg-blue-500" : "bg-gray-200 hover:bg-blue-400 dark:bg-gray-800"
      } focus:outline-none focus-visible:bg-blue-500`}
    />
  );
}
