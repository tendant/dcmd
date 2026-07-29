use crate::error::FsError;
use crate::fs::{self, FileEntry};
use crate::operations;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, FsError> {
    let dir = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || fs::read_dir_entries(&dir))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn default_start_dir() -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(|| {
        // Try HOME first (macOS/Linux)
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return Ok(home);
            }
        }

        // Try USERPROFILE (Windows)
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Ok(profile);
            }
        }

        // Fallback to current directory
        match std::env::current_dir() {
            Ok(path) => Ok(path.to_string_lossy().to_string()),
            Err(_) => Ok("/".to_string()),
        }
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

/// Cancellation flags for in-flight directory size walks, keyed by path.
#[derive(Default)]
pub struct SizeCalculations(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Recursively sums the size of a directory's contents. This can be very slow on
/// large trees, so it is only ever invoked on explicit user request (Space) and
/// is cancellable via `cancel_directory_size`.
#[tauri::command]
pub async fn directory_size(
    path: String,
    state: tauri::State<'_, SizeCalculations>,
) -> Result<u64, FsError> {
    let cancel = Arc::new(AtomicBool::new(false));
    // Register before spawning so a cancel arriving immediately still lands.
    state
        .0
        .lock()
        .unwrap()
        .insert(path.clone(), Arc::clone(&cancel));

    let dir = PathBuf::from(&path);
    let result = tauri::async_runtime::spawn_blocking(move || {
        fs::calculate_dir_size_cancellable(&dir, &cancel)
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?;

    state.0.lock().unwrap().remove(&path);
    result
}

/// Signals an in-flight `directory_size` walk to stop. No-op if none is running.
#[tauri::command]
pub async fn cancel_directory_size(
    path: String,
    state: tauri::State<'_, SizeCalculations>,
) -> Result<(), FsError> {
    if let Some(flag) = state.0.lock().unwrap().get(&path) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn mkdir(parent_dir: String, name: String) -> Result<FileEntry, FsError> {
    let parent = PathBuf::from(parent_dir);
    tauri::async_runtime::spawn_blocking(move || operations::make_dir(&parent, &name))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn rename(path: String, new_name: String) -> Result<FileEntry, FsError> {
    let p = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || operations::rename_entry(&p, &new_name))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn copy_entries(sources: Vec<String>, destination_dir: String) -> Result<(), FsError> {
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let dest = PathBuf::from(destination_dir);
    tauri::async_runtime::spawn_blocking(move || operations::copy_paths(&sources, &dest))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn move_entries(sources: Vec<String>, destination_dir: String) -> Result<(), FsError> {
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let dest = PathBuf::from(destination_dir);
    tauri::async_runtime::spawn_blocking(move || operations::move_paths(&sources, &dest))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn trash_entries(paths: Vec<String>) -> Result<(), FsError> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || operations::trash_paths(&paths))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}
