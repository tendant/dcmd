use crate::error::FsError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// What to do when a transfer would land on an existing name.
///
/// The frontend asks the user once, up front, rather than mid-transfer: deciding
/// per item would mean blocking a background thread on a dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Refuse the whole item and report it. The historical behaviour.
    #[default]
    Fail,
    /// Leave the existing entry alone.
    Skip,
    /// Replace the existing entry.
    Overwrite,
    /// Write alongside it under a suffixed name.
    KeepBoth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub path: String,
    pub message: String,
}

/// Outcome of a transfer. One item failing no longer abandons the rest, so the
/// caller needs to know what actually happened to each.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReport {
    pub completed: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<FailedItem>,
}

impl TransferReport {
    pub fn is_complete_success(&self) -> bool {
        self.failed.is_empty() && self.skipped.is_empty()
    }
}

/// Progress for a running transfer, emitted to the frontend as it advances.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    /// Correlates events with the request that started them.
    pub id: String,
    pub current: usize,
    pub total: usize,
    /// Name of the item being worked on, for display.
    pub name: String,
}

/// Cooperative cancellation plus a place to report progress.
///
/// Passed down through the recursive walk so a long copy can be abandoned partway
/// instead of running to completion with the UI unable to intervene.
pub struct TransferControl<'a> {
    pub cancel: &'a std::sync::atomic::AtomicBool,
    pub on_progress: &'a (dyn Fn(usize, usize, &str) + Send + Sync),
}

impl TransferControl<'_> {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn check(&self) -> Result<(), FsError> {
        if self.is_cancelled() {
            return Err(FsError::Cancelled("transfer cancelled".into()));
        }
        Ok(())
    }
}

/// Names that already exist at the destination, so the user can be asked before
/// anything is written.
pub fn find_conflicts(sources: &[PathBuf], destination_dir: &Path) -> Vec<String> {
    sources
        .iter()
        .filter_map(|s| s.file_name())
        .filter(|name| destination_dir.join(name).exists())
        .map(|name| name.to_string_lossy().to_string())
        .collect()
}

/// A free path next to `dest`, e.g. `notes copy.txt`, then `notes copy 2.txt`.
/// Preserves the extension so the copy stays openable by the same application.
pub fn unique_destination(dest: &Path) -> Result<PathBuf, FsError> {
    if !dest.exists() {
        return Ok(dest.to_path_buf());
    }
    let parent = dest.parent().unwrap_or(Path::new("."));
    let stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = dest.extension().map(|e| e.to_string_lossy().to_string());

    for n in 1..1000 {
        let base = if n == 1 {
            format!("{stem} copy")
        } else {
            format!("{stem} copy {n}")
        };
        let candidate = match &ext {
            Some(e) => parent.join(format!("{base}.{e}")),
            None => parent.join(base),
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(FsError::AlreadyExists(format!(
        "could not find a free name next to {}",
        dest.display()
    )))
}

/// Applies the policy to a destination that may already exist.
///
/// `Ok(None)` means the item should be skipped.
pub fn resolve_destination(
    dest: &Path,
    policy: ConflictPolicy,
) -> Result<Option<PathBuf>, FsError> {
    if !dest.exists() {
        return Ok(Some(dest.to_path_buf()));
    }
    match policy {
        ConflictPolicy::Fail => Err(FsError::AlreadyExists(format!(
            "destination already exists: {}",
            dest.display()
        ))),
        ConflictPolicy::Skip => Ok(None),
        ConflictPolicy::KeepBoth => Ok(Some(unique_destination(dest)?)),
        ConflictPolicy::Overwrite => {
            // Remove the existing entry so a directory is replaced rather than
            // merged, which keeps the result predictable.
            if dest.is_dir() {
                std::fs::remove_dir_all(dest)?;
            } else {
                std::fs::remove_file(dest)?;
            }
            Ok(Some(dest.to_path_buf()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn finds_only_names_that_already_exist() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("taken.txt"), "x").unwrap();

        let a = tmp.path().join("taken.txt");
        let b = tmp.path().join("free.txt");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();

        assert_eq!(find_conflicts(&[a, b], &dest), vec!["taken.txt"]);
    }

    #[test]
    fn keep_both_preserves_the_extension() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("notes.txt");
        fs::write(&f, "x").unwrap();
        assert_eq!(unique_destination(&f).unwrap(), tmp.path().join("notes copy.txt"));
    }

    #[test]
    fn keep_both_keeps_counting_past_the_first_copy() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("notes.txt");
        fs::write(&f, "x").unwrap();
        fs::write(tmp.path().join("notes copy.txt"), "x").unwrap();
        assert_eq!(unique_destination(&f).unwrap(), tmp.path().join("notes copy 2.txt"));
    }

    #[test]
    fn skip_reports_no_destination() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "x").unwrap();
        assert_eq!(resolve_destination(&f, ConflictPolicy::Skip).unwrap(), None);
    }

    #[test]
    fn overwrite_clears_an_existing_directory_first() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("d");
        fs::create_dir(&d).unwrap();
        fs::write(d.join("old.txt"), "old").unwrap();

        let resolved = resolve_destination(&d, ConflictPolicy::Overwrite).unwrap();
        assert_eq!(resolved, Some(d.clone()));
        assert!(!d.exists(), "existing directory should have been removed");
    }

    #[test]
    fn fail_is_still_the_default() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "x").unwrap();
        assert!(matches!(
            resolve_destination(&f, ConflictPolicy::default()),
            Err(FsError::AlreadyExists(_))
        ));
    }

    #[test]
    fn a_free_name_is_returned_unchanged_under_every_policy() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("nope.txt");
        for p in [
            ConflictPolicy::Fail,
            ConflictPolicy::Skip,
            ConflictPolicy::Overwrite,
            ConflictPolicy::KeepBoth,
        ] {
            assert_eq!(resolve_destination(&f, p).unwrap(), Some(f.clone()));
        }
    }
}
