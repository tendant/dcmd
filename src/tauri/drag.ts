import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Starting a drag that another application can receive.
 *
 * An HTML5 drag never leaves the webview: `DataTransfer` can carry text to
 * another page, but handing a *file* to Finder or Mail needs a native drag
 * session, which only the Rust side can begin. So `dragstart` is cancelled and
 * this is called in its place.
 */

/** A 1×1 transparent PNG, used when a real image cannot be produced. */
const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
  "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Draws the label that follows the pointer during the drag.
 *
 * Drawn rather than shipped as an asset so it can say what is being dragged —
 * a name, or a count for several. The plugin requires an image, so there is
 * always the blank fallback when there is no canvas to draw on (jsdom, or a
 * webview that refuses one).
 */
export function dragImage(label: string): string {
  try {
    const canvas = document.createElement("canvas");
    const scale = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return BLANK_PNG;

    const font = `${13 * scale}px -apple-system, system-ui, sans-serif`;
    ctx.font = font;
    const padding = 10 * scale;
    const width = Math.min(ctx.measureText(label).width + padding * 2, 420 * scale);
    const height = 26 * scale;
    canvas.width = width;
    canvas.height = height;

    // Setting the size resets the context, so the font has to be applied again.
    ctx.font = font;
    ctx.fillStyle = "rgba(37, 99, 235, 0.92)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padding, height / 2);

    return canvas.toDataURL("image/png");
  } catch {
    return BLANK_PNG;
  }
}

/** What the drag label says for a given set of paths. */
export function dragLabel(paths: string[]): string {
  if (paths.length === 1) {
    return paths[0].split("/").filter(Boolean).pop() || paths[0];
  }
  return `${paths.length} items`;
}

/**
 * What a drag starting on `path` should carry.
 *
 * Dragging a row that is part of the selection takes the whole selection;
 * dragging one outside it takes just that row, and leaves the selection alone.
 * That is how every file manager behaves, and the alternative — always dragging
 * the selection — would silently hand over files the pointer never touched.
 */
export function pathsForDrag(selected: Set<string>, path: string): string[] {
  return selected.has(path) ? Array.from(selected) : [path];
}

/**
 * Hands `paths` to the system so another application can receive them.
 *
 * Absolute paths only, which is what the panes hold. Resolves once the drag has
 * been started, not when it is dropped: where it lands is the other app's
 * business, and dcmd neither needs nor is told the outcome.
 */
export async function startNativeDrag(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  // The plugin reports drop/cancel through this. Nothing here acts on it — the
  // files are unchanged either way — but the command requires the channel.
  const onEvent = new Channel();

  await invoke("plugin:drag|start_drag", {
    // DragItem is untagged in the plugin, so a bare array is the Files variant.
    item: paths,
    image: dragImage(dragLabel(paths)),
    onEvent,
  });
}
