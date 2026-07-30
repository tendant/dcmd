import { Pane } from "./Pane";
import { Toolbar } from "./Toolbar";
import { Dialog } from "./Dialog";

export function DualPaneLayout() {
  return (
    <div className="flex flex-col h-screen w-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <Pane paneId="left" />
        </div>
        <div className="flex-1">
          <Pane paneId="right" />
        </div>
      </div>
      <Toolbar />
      <Dialog />
    </div>
  );
}
