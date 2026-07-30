mod commands;
mod error;
mod fs;
mod operations;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::SizeCalculations::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::default_start_dir,
            commands::open_entry,
            commands::directory_size,
            commands::cancel_directory_size,
            commands::mkdir,
            commands::rename,
            commands::copy_entries,
            commands::copy_entries_with,
            commands::move_entries_with,
            commands::check_conflicts,
            commands::move_entries,
            commands::trash_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
