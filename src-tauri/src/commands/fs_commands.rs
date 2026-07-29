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
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .and_then(|h| h.into_string().ok())
            .ok_or_else(|| FsError::Io("could not determine home directory".to_string()))
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
