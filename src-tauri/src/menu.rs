//! The native application menu.
//!
//! Every item here owns its shortcut: a menu accelerator and a `keydown`
//! listener both fire, so a binding lives in exactly one of the two. Commands
//! whose meaning depends on state — Escape unwinding a transfer then a filter,
//! Backspace editing a filter or going up, Space selecting or cancelling a size
//! walk — cannot be expressed as an accelerator and stay in the frontend
//! handler. Nothing in this file may duplicate one of those.
//!
//! Selecting an item emits `menu://action` with the item's id. The frontend maps
//! that to the same store action the keyboard would reach, so there is one
//! implementation of each command however it is invoked.

use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Emitted when a menu item is chosen.
pub const MENU_EVENT: &str = "menu://action";

/// Item ids, as constants so a rename is a compile-time change that the contract
/// test then catches against `menu_ids.txt`.
pub mod ids {
    pub const NEW_FOLDER: &str = "new_folder";
    pub const RENAME: &str = "rename";
    pub const DUPLICATE: &str = "duplicate";
    pub const COPY: &str = "copy";
    pub const MOVE: &str = "move";
    pub const REVEAL: &str = "reveal";
    pub const COPY_PATH: &str = "copy_path";
    pub const TRASH: &str = "trash";
    pub const OPEN: &str = "open";
    pub const PREVIEW: &str = "preview";
    pub const BACK: &str = "back";
    pub const FORWARD: &str = "forward";
    pub const UP: &str = "up";
    pub const EDIT_PATH: &str = "edit_path";
    pub const REFRESH: &str = "refresh";
    pub const BOOKMARK: &str = "bookmark";
    pub const ADD_HOST: &str = "add_host";
    pub const OPEN_LOG: &str = "open_log";
    pub const SWITCH_PANE: &str = "switch_pane";
    pub const SELECT_ALL: &str = "select_all";
    pub const DESELECT_ALL: &str = "deselect_all";
    pub const INVERT_SELECTION: &str = "invert_selection";
    pub const CALC_SIZE: &str = "calc_size";
    pub const CLEAR_FILTER: &str = "clear_filter";
    pub const CANCEL: &str = "cancel";
    pub const SORT_NAME: &str = "sort_name";
    pub const SORT_SIZE: &str = "sort_size";
    pub const SORT_MODIFIED: &str = "sort_modified";
    pub const SORT_CREATED: &str = "sort_created";
    pub const SORT_KIND: &str = "sort_kind";
    pub const TOGGLE_HIDDEN: &str = "toggle_hidden";
    pub const TOGGLE_PLACES: &str = "toggle_places";
    pub const SPLIT_EVEN: &str = "split_even";
    pub const SPLIT_WIDER: &str = "split_wider";
    pub const SPLIT_NARROWER: &str = "split_narrower";
    pub const TOGGLE_COLLAPSE: &str = "toggle_collapse";

    /// Opens the webview inspector. Handled in Rust rather than forwarded to
    /// the frontend like everything else — it acts on the webview itself, and a
    /// page that has stopped running is exactly when you want it. Deliberately
    /// outside `ALL`, which lists the ids the frontend must implement.
    pub const DEVTOOLS: &str = "devtools";

    /// Every id the menu can emit, in the order they are declared.
    pub const ALL: &[&str] = &[
        NEW_FOLDER,
        RENAME,
        DUPLICATE,
        OPEN,
        PREVIEW,
        COPY,
        MOVE,
        REVEAL,
        COPY_PATH,
        TRASH,
        BACK,
        FORWARD,
        UP,
        EDIT_PATH,
        REFRESH,
        BOOKMARK,
        ADD_HOST,
        OPEN_LOG,
        SWITCH_PANE,
        SELECT_ALL,
        DESELECT_ALL,
        INVERT_SELECTION,
        CALC_SIZE,
        CLEAR_FILTER,
        CANCEL,
        SORT_NAME,
        SORT_SIZE,
        SORT_MODIFIED,
        SORT_CREATED,
        SORT_KIND,
        TOGGLE_HIDDEN,
        TOGGLE_PLACES,
        SPLIT_EVEN,
        SPLIT_WIDER,
        SPLIT_NARROWER,
        TOGGLE_COLLAPSE,
    ];
}

/// Builds the whole menu. Ids are stable strings the frontend matches on.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::new(label).id(id);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    // macOS expects an application menu first, and hides Quit inside it.
    let app_menu = SubmenuBuilder::new(app, "dcmd")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&item(ids::OPEN_LOG, "Open Log", None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        // No accelerator: Enter means parent, descend or open depending on the
        // row, so it cannot be one fixed command. The key is in the label
        // instead, which is the discoverability the shortcut bar used to give.
        .item(&item(ids::OPEN, "Open  (Enter)", None)?)
        // Unlike Enter, this means one fixed thing whatever the row is, so the
        // menu can own the key outright and the keyboard handler stays clear of
        // it. F3 is the view key this class of app has used for decades.
        .item(&item(ids::PREVIEW, "Preview", Some("F3"))?)
        .separator()
        .item(&item(
            ids::NEW_FOLDER,
            "New Folder",
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&item(ids::RENAME, "Rename…", Some("CmdOrCtrl+Shift+R"))?)
        .item(&item(
            ids::DUPLICATE,
            "Duplicate",
            Some("CmdOrCtrl+Shift+D"),
        )?)
        .separator()
        .item(&item(
            ids::COPY,
            "Copy to Other Pane",
            Some("CmdOrCtrl+Shift+C"),
        )?)
        .item(&item(
            ids::MOVE,
            "Move to Other Pane",
            Some("CmdOrCtrl+Shift+M"),
        )?)
        .separator()
        .item(&item(ids::REVEAL, "Reveal in File Browser", None)?)
        .item(&item(ids::COPY_PATH, "Copy Path", None)?)
        .separator()
        .item(&item(
            ids::TRASH,
            "Move to Trash",
            Some("CmdOrCtrl+Backspace"),
        )?)
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&item(ids::BACK, "Back", Some("CmdOrCtrl+["))?)
        .item(&item(ids::FORWARD, "Forward", Some("CmdOrCtrl+]"))?)
        // Not Backspace: that one edits the filter when a filter is active, so
        // it cannot be an accelerator.
        .item(&item(ids::UP, "Enclosing Folder", Some("CmdOrCtrl+Up"))?)
        .separator()
        .item(&item(ids::EDIT_PATH, "Go to Path…", Some("CmdOrCtrl+L"))?)
        .item(&item(ids::REFRESH, "Refresh", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(
            ids::BOOKMARK,
            "Bookmark This Folder",
            Some("CmdOrCtrl+D"),
        )?)
        .item(&item(ids::ADD_HOST, "Add Host…", None)?)
        .separator()
        .item(&item(ids::SWITCH_PANE, "Other Pane  (Tab)", None)?)
        .build()?;

    // These were the second and third rows of the old shortcut bar. The ones
    // whose key is contextual carry it in the label rather than as an
    // accelerator, so the keyboard handler stays their only binding.
    let selection = SubmenuBuilder::new(app, "Selection")
        .item(&item(ids::SELECT_ALL, "Select All", Some("CmdOrCtrl+A"))?)
        .item(&item(
            ids::DESELECT_ALL,
            "Deselect All",
            Some("CmdOrCtrl+Shift+A"),
        )?)
        .item(&item(
            ids::INVERT_SELECTION,
            "Invert Selection",
            Some("CmdOrCtrl+I"),
        )?)
        .separator()
        .item(&item(
            ids::CALC_SIZE,
            "Calculate Folder Size  (Space)",
            None,
        )?)
        .separator()
        .item(&item(ids::CLEAR_FILTER, "Clear Filter  (Esc)", None)?)
        .item(&item(ids::CANCEL, "Cancel Operation  (Esc)", None)?)
        .build()?;

    let sort = SubmenuBuilder::new(app, "Sort By")
        .item(&item(ids::SORT_NAME, "Name", Some("CmdOrCtrl+1"))?)
        .item(&item(ids::SORT_SIZE, "Size", Some("CmdOrCtrl+2"))?)
        .item(&item(
            ids::SORT_MODIFIED,
            "Date Modified",
            Some("CmdOrCtrl+3"),
        )?)
        .item(&item(
            ids::SORT_CREATED,
            "Date Created",
            Some("CmdOrCtrl+4"),
        )?)
        .item(&item(ids::SORT_KIND, "Kind", Some("CmdOrCtrl+5"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&sort)
        .item(&item(
            ids::TOGGLE_HIDDEN,
            "Show Hidden Files",
            Some("CmdOrCtrl+Shift+."),
        )?)
        .separator()
        .item(&item(
            ids::TOGGLE_PLACES,
            "Places Bar",
            Some("CmdOrCtrl+B"),
        )?)
        .separator()
        .item(&item(ids::SPLIT_EVEN, "Even Split", Some("CmdOrCtrl+0"))?)
        .item(&item(
            ids::SPLIT_WIDER,
            "Widen Left Pane",
            Some("CmdOrCtrl+Shift+Left"),
        )?)
        .item(&item(
            ids::SPLIT_NARROWER,
            "Widen Right Pane",
            Some("CmdOrCtrl+Shift+Right"),
        )?)
        .item(&item(
            ids::TOGGLE_COLLAPSE,
            "Single Pane",
            Some("CmdOrCtrl+\\"),
        )?);

    // Only where the webview can actually open it. A release build without the
    // devtools feature would otherwise show an item that does nothing.
    //
    // A cfg-gated rebinding rather than a `mut` reassigned inside a block: with
    // the block compiled out there is nothing left to mutate, and the `mut`
    // became an unused_mut warning in exactly the build that has no devtools.
    #[cfg(any(debug_assertions, feature = "devtools"))]
    let view = view.separator().item(&item(
        ids::DEVTOOLS,
        "Developer Tools",
        Some("CmdOrCtrl+Alt+I"),
    )?);

    let view = view.build()?;

    Menu::with_items(app, &[&app_menu, &file, &go, &selection, &view])
}

/// Forwards a chosen item to the frontend, which owns what each command does.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    // The inspector is opened here, not in the frontend: it is most useful when
    // the page itself is wedged and cannot act on an event.
    #[cfg(any(debug_assertions, feature = "devtools"))]
    if id == ids::DEVTOOLS {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
        return;
    }

    // Only the focused window should act, or both panes would respond at once.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(MENU_EVENT, id);
    } else {
        let _ = app.emit(MENU_EVENT, id);
    }
}

#[cfg(test)]
mod tests {
    use super::ids;

    /// The list both sides agree on. Included at compile time so the file cannot
    /// drift from the constants without failing here.
    const CANONICAL: &str = include_str!("../menu_ids.txt");

    fn canonical_ids() -> Vec<&'static str> {
        CANONICAL
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect()
    }

    #[test]
    fn every_id_is_declared_in_the_shared_file() {
        assert_eq!(ids::ALL.to_vec(), canonical_ids());
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for id in ids::ALL {
            assert!(seen.insert(id), "duplicate menu id: {id}");
        }
        // Separately, since a stray duplicate line in the file is easy to
        // introduce and would otherwise only show up as a confusing diff.
        let mut seen = std::collections::HashSet::new();
        for id in canonical_ids() {
            assert!(seen.insert(id), "duplicate id in menu_ids.txt: {id}");
        }
    }

    /// Their meaning depends on state, so they cannot be fixed accelerators and
    /// must remain with the frontend keyboard handler.
    /// It has no frontend handler, so listing it in the shared file would make
    /// the frontend contract test demand one that must not exist.
    #[test]
    fn the_inspector_is_not_a_frontend_command() {
        assert!(!ids::ALL.contains(&ids::DEVTOOLS));
        assert!(!canonical_ids().contains(&ids::DEVTOOLS));
    }

    #[test]
    fn no_id_names_a_contextual_key() {
        for key in ["escape", "backspace", "space", "tab", "enter", "filter"] {
            assert!(!ids::ALL.contains(&key), "{key} must not be a menu command");
        }
    }
}
