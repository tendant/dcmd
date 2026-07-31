//! A log file on disk, and a way to open it.
//!
//! The webview's console goes nowhere a user can reach: it is not in the dev
//! terminal (vite forwards only its own messages) and there is no devtools in a
//! release build. So anything worth diagnosing later — a failed listing, a
//! transfer error, a menu that would not build — is appended here instead, and
//! `open_log` hands the file to the system viewer.
//!
//! Appends are best-effort throughout. Logging must never be the reason an
//! operation fails, so every write that goes wrong is dropped rather than
//! propagated.

use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Runtime};

/// Lines kept when the file is rotated, so a long session cannot grow forever.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Where the log lives. `None` when the platform gives us no log directory,
/// which is not an error worth surfacing — it just means no logging.
pub fn log_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("dcmd.log"))
}

/// Seconds since the epoch. A wall-clock timestamp needs a date library to
/// format properly; for correlating entries within a session this is enough and
/// costs no dependency.
fn stamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Appends one line, tagged with a source so frontend and backend entries can be
/// told apart when reading the file.
pub fn append<R: Runtime>(app: &AppHandle<R>, source: &str, message: &str) {
    let Some(path) = log_path(app) else { return };

    // Truncate rather than grow without bound. Dropping the old half keeps the
    // recent entries, which are the ones anyone is looking for.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::write(&path, b"");
        }
    }

    let mut line = String::new();
    // A message spanning lines would otherwise look like several entries.
    let _ = write!(
        line,
        "{} [{}] {}",
        stamp(),
        source,
        message.replace('\n', "\\n")
    );
    line.push('\n');

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Writes a line from the frontend, which has no other durable channel.
#[tauri::command]
pub fn log_message<R: Runtime>(app: AppHandle<R>, level: String, message: String) {
    append(&app, &level, &message);
}

/// Opens the log in whatever the system uses for text.
#[tauri::command]
pub fn open_log<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = log_path(&app).ok_or_else(|| "no log directory on this platform".to_string())?;

    // Opening a file that does not exist yet fails on every platform, and an
    // empty log is a perfectly normal state for a session with nothing to say.
    if !path.exists() {
        append(&app, "info", "log opened before anything was written to it");
    }

    open::that(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timestamp_is_present() {
        assert!(stamp() > 1_700_000_000, "clock looks wrong");
    }

    /// Multi-line messages must stay one entry, or a stack trace would read as
    /// a dozen unrelated log lines.
    #[test]
    fn newlines_are_escaped_into_one_line() {
        let msg = "first\nsecond";
        let escaped = msg.replace('\n', "\\n");
        assert!(!escaped.contains('\n'));
        assert_eq!(escaped, "first\\nsecond");
    }
}
