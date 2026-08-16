// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri/commands", async () => (await import("../test-utils")).commandMocks);

import { MENU_ACTIONS } from "./menuActions";
import { useFileManagerStore } from "../state/fileManagerStore";

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

/**
 * Cmd+A is a menu accelerator, so it fires wherever focus is — including a
 * rename field, where selecting every file in the pane is the wrong half of
 * what the key means. Edit's predefined Select All cannot take the key back:
 * one key equivalent belongs to one item.
 */
describe("select all", () => {
  it("selects the rows when nothing is being typed into", () => {
    const selectAll = vi.fn();
    useFileManagerStore.setState({ selectAll } as any);

    MENU_ACTIONS["select_all"](useFileManagerStore.getState());

    expect(selectAll).toHaveBeenCalledWith(useFileManagerStore.getState().activePane);
  });

  it("selects the text instead while a field has focus", () => {
    const selectAll = vi.fn();
    useFileManagerStore.setState({ selectAll } as any);

    const input = document.createElement("input");
    input.value = "photo.jpg";
    document.body.appendChild(input);
    input.focus();

    MENU_ACTIONS["select_all"](useFileManagerStore.getState());

    expect(selectAll).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("photo.jpg".length);
  });
});
