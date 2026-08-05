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

/// Everything the frontend needs before it can draw: where to start, and the
/// persisted settings.
///
/// One command rather than two, because each round trip is on the startup
/// critical path and the measurements showed no headroom there.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub start_dir: String,
    pub settings: crate::settings::Settings,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, FsError> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map(|d| d.join("settings.json"))
        .map_err(|e| FsError::Io(format!("no config directory: {e}")))
}

#[tauri::command]
pub async fn startup_info(app: tauri::AppHandle) -> Result<StartupInfo, FsError> {
    crate::trace_startup_once("startup_info requested");
    let start_dir = default_start_dir().await?;
    let settings = match settings_path(&app) {
        Ok(p) => crate::settings::load_from(&p),
        // Settings are a convenience; failing to locate them must not stop the
        // app opening on a usable directory.
        Err(_) => crate::settings::Settings::default(),
    };
    Ok(StartupInfo {
        start_dir,
        settings,
    })
}

#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    settings: crate::settings::Settings,
) -> Result<(), FsError> {
    let path = settings_path(&app)?;
    let settings = settings.sanitised();
    tauri::async_runtime::spawn_blocking(move || {
        crate::settings::save_to(&path, &settings)
            .map_err(|e| FsError::Io(format!("could not save settings: {e}")))
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

/// Lets the frontend record a startup milestone, since the interesting ones —
/// when the panes are actually usable — are only observable from that side.
#[tauri::command]
pub fn mark_startup(label: String) {
    crate::trace_startup_once(&label);
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, FsError> {
    crate::trace_startup_once("first listing requested");
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

/// Host aliases from the user's ssh config, offered when adding a host.
///
/// Read-only, and only the names. Typing an alias by hand is error-prone and the
/// list already exists; the app has no business duplicating what ssh knows.
#[tauri::command]
pub async fn ssh_config_hosts() -> Result<Vec<String>, FsError> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(crate::remote::ssh_config::default_config_path()
            .map(|p| crate::remote::ssh_config::hosts_from_file(&p))
            .unwrap_or_default())
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

/// Transfers between this machine and a host, using rsync.
///
/// rsync rather than our own copy: it preserves metadata, resumes, skips what is
/// already identical, and can say in advance what it would change. Reimplementing
/// any of that over SFTP would be worse in every respect.
#[cfg(unix)]
#[tauri::command]
pub async fn rsync_transfer(
    app: tauri::AppHandle,
    state: tauri::State<'_, Transfers>,
    id: String,
    sources: Vec<crate::remote::rsync::Endpoint>,
    destination: crate::remote::rsync::Endpoint,
    dry_run: bool,
) -> Result<crate::remote::rsync::RsyncReport, FsError> {
    use crate::remote::rsync;

    rsync::check_local_destination(&destination)?;
    let args = rsync::build_args(&sources, &destination, dry_run)?;

    let cancel = Arc::new(AtomicBool::new(false));
    state
        .0
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::clone(&cancel));

    let progress_id = id.clone();
    let result = rsync::run_rsync(&args, &cancel, move |p| {
        let _ = app.emit(
            "transfer://progress",
            TransferProgress {
                id: progress_id.clone(),
                // rsync counts files when it can; fall back to its byte
                // percentage so the bar still moves during one large file.
                current: if p.total > 0 {
                    p.done
                } else {
                    p.percent as usize
                },
                total: if p.total > 0 { p.total } else { 100 },
                name: String::new(),
            },
        );
    })
    .await;

    state.0.lock().unwrap().remove(&id);
    result
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn rsync_transfer(
    _id: String,
    _sources: Vec<crate::remote::rsync::Endpoint>,
    _destination: crate::remote::rsync::Endpoint,
    _dry_run: bool,
) -> Result<crate::remote::rsync::RsyncReport, FsError> {
    Err(FsError::Io(
        "Remote transfers are not available on this platform".to_string(),
    ))
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

/// Lists a directory on a remote host over SFTP.
///
/// Remote browsing is read-only plus rsync by design, so this is the only remote
/// command that touches a listing. Nothing here can modify the far side.
#[cfg(unix)]
#[tauri::command]
pub async fn list_remote_directory(
    alias: String,
    path: String,
    connections: tauri::State<'_, crate::remote::session::Connections>,
) -> Result<crate::remote::session::RemoteListing, FsError> {
    let sftp = connections.get(&alias, None).await?;
    match crate::remote::session::list_dir(&sftp, &path).await {
        Ok(listing) => Ok(listing),
        Err(e) => {
            // A dead session would otherwise fail every later listing too; drop
            // it so the next attempt reconnects rather than reusing a corpse.
            if matches!(e, FsError::Io(_)) {
                connections.disconnect(&alias).await;
            }
            Err(e)
        }
    }
}

/// Abandons a connection still being established.
///
/// Connecting can outlast anyone's patience — a host that accepts TCP and then
/// stops responding, an alias pointing somewhere that no longer exists — and
/// until this existed there was no way out of it but quitting the app.
#[cfg(unix)]
#[tauri::command]
pub async fn cancel_remote_connect(
    alias: String,
    connections: tauri::State<'_, crate::remote::session::Connections>,
) -> Result<(), FsError> {
    connections.cancel(&alias).await;
    Ok(())
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn cancel_remote_connect(_alias: String) -> Result<(), FsError> {
    Ok(())
}

/// Windows has no ssh multiplexing to build on, so remote browsing is not
/// available there. Reported plainly rather than the command being absent, which
/// would surface as an unhelpful "command not found".
#[cfg(not(unix))]
#[tauri::command]
pub async fn list_remote_directory(_alias: String, _path: String) -> Result<(), FsError> {
    Err(FsError::Io(
        "Remote browsing is not available on this platform".to_string(),
    ))
}

/// Shows the entry in the OS file browser.
///
/// Goes through the plugin's Rust API for the same reason `open_entry` does: the
/// JS command is gated by a capability path scope meant to restrain web content,
/// which is the wrong model for a file manager acting on a row the user picked.
#[tauri::command]
pub async fn reveal_entry(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err(FsError::NotFound(path));
        }
        tauri_plugin_opener::reveal_item_in_dir(&p)
            .map_err(|e| FsError::Io(format!("could not reveal {path}: {e}")))
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

/// One way of starting a terminal: the program, and the arguments it needs.
///
/// `open -a Terminal` on macOS takes the directory as an argument; everything
/// else inherits it from the working directory of the spawned process. Both are
/// set, so a candidate that ignores one still lands in the right place.
#[derive(Debug, PartialEq, Eq)]
pub struct TerminalLaunch {
    pub program: String,
    pub args: Vec<String>,
}

/// What to try, in order.
///
/// `$TERMINAL` first: a preference stated in the environment should beat
/// whatever the platform happens to ship, and on Linux there is no other way to
/// know which of a dozen terminals someone actually uses.
///
/// A plain function rather than logic buried in `#[cfg]`, so the ordering rule
/// is testable from any host — only the platform-specific tail differs.
pub fn terminal_launches(env_terminal: Option<&str>, dir: &str) -> Vec<TerminalLaunch> {
    let plain = |program: &str| TerminalLaunch {
        program: program.to_string(),
        args: Vec::new(),
    };
    let mut out = Vec::new();

    if let Some(t) = env_terminal.map(str::trim).filter(|t| !t.is_empty()) {
        out.push(plain(t));
    }

    if cfg!(target_os = "macos") {
        out.push(TerminalLaunch {
            program: "open".to_string(),
            args: vec!["-a".to_string(), "Terminal".to_string(), dir.to_string()],
        });
    } else if cfg!(target_os = "windows") {
        out.push(TerminalLaunch {
            program: "wt".to_string(),
            args: vec!["-d".to_string(), dir.to_string()],
        });
        out.push(plain("cmd"));
    } else {
        // x-terminal-emulator is Debian's alternatives symlink and respects a
        // system-wide choice, so it goes before any specific terminal.
        for program in [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "alacritty",
            "kitty",
            "xterm",
        ] {
            out.push(plain(program));
        }
    }

    out
}

/// Opens a terminal at `path`.
///
/// Tries each candidate and keeps the last failure, so a machine with none of
/// them installed gets a message naming what was attempted rather than silence.
#[tauri::command]
pub async fn open_terminal(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        if !dir.is_dir() {
            return Err(FsError::NotADirectory(path));
        }

        let env_terminal = std::env::var("TERMINAL").ok();
        let mut last: Option<String> = None;
        for launch in terminal_launches(env_terminal.as_deref(), &path) {
            // Not waited on: a terminal outlives the click that opened it, and
            // blocking here would hold a blocking-pool thread for its lifetime.
            match std::process::Command::new(&launch.program)
                .args(&launch.args)
                .current_dir(&dir)
                .spawn()
            {
                Ok(_) => return Ok(()),
                Err(e) => last = Some(format!("{} ({e})", launch.program)),
            }
        }
        Err(FsError::Io(format!(
            "could not open a terminal; last tried {}",
            last.as_deref().unwrap_or("nothing"),
        )))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The one rule that holds on every platform: an explicit preference wins.
    #[test]
    fn env_terminal_is_tried_first() {
        let launches = terminal_launches(Some("wezterm"), "/tmp");
        assert_eq!(launches[0].program, "wezterm");
        assert!(launches[0].args.is_empty());
        // And it does not replace the platform defaults, which remain as fallback.
        assert!(launches.len() > 1);
    }

    #[test]
    fn blank_env_terminal_is_ignored() {
        // An exported-but-empty TERMINAL is common in shell profiles, and
        // spawning "" fails in a way that would mask the real candidates.
        for value in ["", "   "] {
            let launches = terminal_launches(Some(value), "/tmp");
            assert_ne!(launches[0].program, value.to_string());
        }
        assert_eq!(
            terminal_launches(None, "/tmp"),
            terminal_launches(Some("  "), "/tmp"),
        );
    }

    #[test]
    fn there_is_always_something_to_try() {
        assert!(!terminal_launches(None, "/tmp").is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_passes_the_directory_as_an_argument() {
        let launches = terminal_launches(None, "/tmp/some dir");
        assert_eq!(launches[0].program, "open");
        assert_eq!(launches[0].args.last().unwrap(), "/tmp/some dir");
    }
}
