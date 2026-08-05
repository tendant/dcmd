mod commands;
mod error;
mod fs;
pub mod logging;
pub mod menu;
mod operations;
pub mod preview;
pub mod remote;
pub mod settings;

/// When `DCMD_TRACE_STARTUP=1`, report milestones as milliseconds since process
/// start. The design document sets a sub-100ms startup target, which cannot be
/// checked from a dev build and cannot be observed from outside the window, so
/// the app reports it itself.
pub fn trace_startup(label: &str) {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    static ENABLED: OnceLock<bool> = OnceLock::new();

    let start = START.get_or_init(Instant::now);
    if !*ENABLED.get_or_init(|| std::env::var("DCMD_TRACE_STARTUP").as_deref() == Ok("1")) {
        return;
    }
    eprintln!(
        "[startup] {label}: {:.1}ms",
        start.elapsed().as_secs_f64() * 1000.0
    );
}

/// As `trace_startup`, but only the first time it is reached for a given label.
/// Commands that run repeatedly would otherwise report every later call as if it
/// were part of startup.
pub fn trace_startup_once(label: &str) {
    use std::collections::HashSet;
    use std::sync::Mutex;
    use std::sync::OnceLock;
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashSet::new()));
    if seen.lock().unwrap().insert(label.to_string()) {
        trace_startup(label);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    trace_startup("run() entered");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::SizeCalculations::default())
        .manage(commands::Transfers::default())
        // Dragging a file out to another application needs a native drag
        // session; an HTML5 drag inside a webview cannot hand a file to another
        // app. This plugin starts one for the paths we give it.
        .plugin(tauri_plugin_drag::init());

    // Unix-only: remote browsing drives the system ssh binary. A separate
    // statement rather than a cfg inside `.manage()`, which on other platforms
    // registered a unit value — state nothing ever asks for, and something
    // clippy rightly refuses.
    #[cfg(unix)]
    let builder = builder.manage(remote::session::Connections::default());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::list_remote_directory,
            commands::cancel_remote_connect,
            commands::rsync_transfer,
            commands::ssh_config_hosts,
            commands::mark_startup,
            commands::startup_info,
            commands::save_settings,
            commands::default_start_dir,
            commands::open_entry,
            commands::reveal_entry,
            commands::open_terminal,
            commands::directory_size,
            commands::cancel_directory_size,
            commands::mkdir,
            commands::rename,
            commands::copy_entries_with,
            commands::move_entries_with,
            commands::check_conflicts,
            commands::cancel_transfer,
            commands::trash_entries,
            preview::preview_file,
            logging::log_message,
            logging::open_log,
        ])
        .setup(|app| {
            trace_startup("window created");
            // Built here rather than declaratively so the ids and accelerators
            // live next to the code that documents why each one is safe.
            let handle = app.handle();
            // Marks the start of a session in the log, and proves at a glance
            // whether the log file can be written at all.
            logging::append(handle, "info", "app started");
            match menu::build(handle) {
                Ok(m) => {
                    let _ = app.set_menu(m);
                }
                // A missing menu should not stop the app opening: every command
                // is also reachable from the context menu.
                Err(e) => {
                    eprintln!("could not build the menu: {e}");
                    logging::append(handle, "error", &format!("menu build failed: {e}"));
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_event(app, event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
