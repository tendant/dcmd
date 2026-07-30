use crate::error::FsError;
use crate::fs::{self, FileEntry};
use crate::operations;
use crate::operations::transfer::{
    ConflictPolicy, TransferControl, TransferProgress, TransferReport,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, FsError> {
    crate::trace_startup("first list_directory");
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

/// Names that already exist at the destination, so the user can be asked what to
/// do before anything is written.
#[tauri::command]
pub async fn check_conflicts(
    sources: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, FsError> {
    let srcs: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let dest = PathBuf::from(destination_dir);
    tauri::async_runtime::spawn_blocking(move || {
        Ok(crate::operations::transfer::find_conflicts(&srcs, &dest))
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

/// Cancellation flags for in-flight transfers, keyed by the caller's request id.
#[derive(Default)]
pub struct Transfers(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Runs a transfer, emitting `transfer://progress` as it advances and stopping
/// early if `cancel_transfer` is called with the same id.
async fn run_transfer<F>(
    app: tauri::AppHandle,
    state: tauri::State<'_, Transfers>,
    id: String,
    sources: Vec<String>,
    destination_dir: String,
    policy: ConflictPolicy,
    run: F,
) -> Result<TransferReport, FsError>
where
    F: FnOnce(
            &[PathBuf],
            &PathBuf,
            ConflictPolicy,
            &TransferControl<'_>,
        ) -> Result<TransferReport, FsError>
        + Send
        + 'static,
{
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .0
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::clone(&cancel));

    let srcs: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let dest = PathBuf::from(destination_dir);
    let progress_id = id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let on_progress = move |current: usize, total: usize, name: &str| {
            let _ = app.emit(
                "transfer://progress",
                TransferProgress {
                    id: progress_id.clone(),
                    current,
                    total,
                    name: name.to_string(),
                },
            );
        };
        run(
            &srcs,
            &dest,
            policy,
            &TransferControl {
                cancel: &cancel,
                on_progress: &on_progress,
            },
        )
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?;

    state.0.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub async fn copy_entries_with(
    app: tauri::AppHandle,
    state: tauri::State<'_, Transfers>,
    id: String,
    sources: Vec<String>,
    destination_dir: String,
    policy: ConflictPolicy,
) -> Result<TransferReport, FsError> {
    run_transfer(
        app,
        state,
        id,
        sources,
        destination_dir,
        policy,
        |s, d, p, c| operations::copy::copy_paths_controlled(s, d, p, c),
    )
    .await
}

#[tauri::command]
pub async fn move_entries_with(
    app: tauri::AppHandle,
    state: tauri::State<'_, Transfers>,
    id: String,
    sources: Vec<String>,
    destination_dir: String,
    policy: ConflictPolicy,
) -> Result<TransferReport, FsError> {
    run_transfer(
        app,
        state,
        id,
        sources,
        destination_dir,
        policy,
        |s, d, p, c| operations::move_op::move_paths_controlled(s, d, p, c),
    )
    .await
}

/// Signals an in-flight transfer to stop. No-op if it already finished.
#[tauri::command]
pub async fn cancel_transfer(
    id: String,
    state: tauri::State<'_, Transfers>,
) -> Result<(), FsError> {
    if let Some(flag) = state.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Opens a path with the OS default application.
///
/// This calls the opener plugin's Rust API rather than exposing its JS command.
/// The JS command enforces a capability path scope meant to stop web content
/// reaching arbitrary files; for a file manager that scope is the wrong layer —
/// it rejected any path with a dot-prefixed component (`~/.config/foo`) unless
/// globally disabled. Opening is instead gated here, where the path always came
/// from the user selecting a row in a directory they had already navigated to.
#[tauri::command]
pub async fn open_entry(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = PathBuf::from(&path);
        if !file.exists() {
            return Err(FsError::NotFound(path));
        }

        // `open::that` waits for the launcher and checks its exit status, unlike
        // the plugin's detached variant which reports success even when nothing
        // can open the file.
        open::that(&file).map_err(|e| {
            // A non-zero launcher exit almost always means no application is
            // registered for the type, which is worth saying plainly.
            if e.kind() == std::io::ErrorKind::Other {
                FsError::Io(format!(
                    "No application is associated with this file type ({})",
                    file.file_name().unwrap_or_default().to_string_lossy()
                ))
            } else {
                FsError::Io(format!("could not open {path}: {e}"))
            }
        })
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
pub async fn trash_entries(paths: Vec<String>) -> Result<TransferReport, FsError> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || operations::trash::trash_paths_reported(&paths))
        .await
        .map_err(|e| FsError::Io(format!("task join error: {e}")))
}
