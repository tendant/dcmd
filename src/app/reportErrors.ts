import * as commands from "../tauri/commands";

/**
 * Sends anything that escapes React to the log file.
 *
 * Installed before the first render rather than from an effect: a component
 * that throws while rendering never reaches its effects, and that is precisely
 * the case that shows as a blank window. The webview console is no help — it is
 * not forwarded to the dev terminal and does not exist in a release build — so
 * without this a blank screen leaves no trace anywhere at all.
 */
export function reportUncaughtErrors() {
  // Also marks the frontend's own start. It doubles as an IPC check: if this
  // line is missing while "app started" is present, the Rust side is up and the
  // webview cannot reach it, which looks identical to a blank window.
  void commands.logMessage("info", "frontend started");

  window.addEventListener("error", (e) => {
    void commands.logMessage(
      "error",
      `uncaught: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ""}`,
    );
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { stack?: string } | undefined;
    void commands.logMessage(
      "error",
      `unhandled rejection: ${String(e.reason)}\n${reason?.stack ?? ""}`,
    );
  });
}
