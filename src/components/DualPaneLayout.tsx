import { useRef } from "react";
import { Pane } from "./Pane";
import { Toolbar } from "./Toolbar";
import { Dialog } from "./Dialog";
import { TransferProgressBar } from "./TransferProgressBar";
import { PaneDivider } from "./PaneDivider";
import { useFileManagerStore } from "../state/fileManagerStore";

export function DualPaneLayout() {
  const splitRatio = useFileManagerStore((s) => s.splitRatio);
  const collapsed = useFileManagerStore((s) => s.collapsed);
  const containerRef = useRef<HTMLDivElement>(null);

  // A collapsed pane is removed from the layout rather than given zero width, so
  // it cannot take focus or be reached by Tab while invisible.
  const showLeft = collapsed !== "left";
  const showRight = collapsed !== "right";

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-50 dark:bg-gray-950">
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {showLeft && (
          <div
            style={showRight ? { width: `${splitRatio * 100}%` } : undefined}
            className={showRight ? "min-w-0" : "min-w-0 flex-1"}
          >
            <Pane paneId="left" />
          </div>
        )}
        {showLeft && showRight && <PaneDivider containerRef={containerRef} />}
        {showRight && (
          <div className="min-w-0 flex-1">
            <Pane paneId="right" />
          </div>
        )}
      </div>
      <TransferProgressBar />
      <Toolbar />
      <Dialog />
    </div>
  );
}
