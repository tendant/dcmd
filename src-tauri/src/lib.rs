mod commands;
mod error;
mod fs;
mod operations;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::default_start_dir,
            commands::mkdir,
            commands::rename,
            commands::copy_entries,
            commands::move_entries,
            commands::trash_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
