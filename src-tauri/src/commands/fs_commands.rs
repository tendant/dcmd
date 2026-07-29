use crate::error::FsError;
use crate::fs::{self, FileEntry};
use crate::operations;
use std::path::PathBuf;

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
