mod commands;
mod error;
mod fs;
mod operations;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::SizeCalculations::default())
        .manage(commands::Transfers::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::mark_startup,
            commands::startup_info,
            commands::save_settings,
            commands::default_start_dir,
            commands::open_entry,
            commands::directory_size,
            commands::cancel_directory_size,
            commands::mkdir,
            commands::rename,
            commands::copy_entries_with,
            commands::move_entries_with,
            commands::check_conflicts,
            commands::cancel_transfer,
            commands::trash_entries,
        ])
        .setup(|_app| {
            trace_startup("window created");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
