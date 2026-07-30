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

/// Rejects a transfer whose destination is the folder the item is already in.
///
/// This is a safety check, not a convenience one. Such a transfer resolves the
/// destination to the source itself, and under `Overwrite` that means deleting the
/// source before copying from it — the file is destroyed and the copy then fails
/// with "No such file or directory". It is reachable by default, since both panes
/// open on the same directory. Must be called before `resolve_destination`.
pub fn check_not_same_directory(source: &Path, destination_dir: &Path) -> Result<(), FsError> {
    let parent = match source.parent() {
        Some(p) => p,
        None => return Ok(()),
    };
    if crate::fs::paths::resolve(parent) == crate::fs::paths::resolve(destination_dir) {
        return Err(FsError::InvalidName(format!(
            "{} is already in that folder",
            source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| source.display().to_string())
        )));
    }
    Ok(())
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

/// Where an item should be written, and whether an existing entry is being replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// Nothing is in the way; write straight here.
    Direct(PathBuf),
    /// Write to `staging`, then swap it into `target` once it is complete.
    Replace { staging: PathBuf, target: PathBuf },
    /// Leave the existing entry alone.
    Skip,
}

impl Resolution {
    /// The path to write to.
    pub fn write_path(&self) -> Option<&Path> {
        match self {
            Self::Direct(p) => Some(p),
            Self::Replace { staging, .. } => Some(staging),
            Self::Skip => None,
        }
    }
}

/// Distinguishes concurrent staging paths within a process.
static STAGE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A hidden sibling of `dest` to assemble the replacement in.
///
/// A sibling specifically, so it lands on the same filesystem and the final swap
/// is a rename rather than another copy.
fn staging_path(dest: &Path) -> Result<PathBuf, FsError> {
    let parent = dest.parent().unwrap_or(Path::new("."));
    let base = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    for _ in 0..1000 {
        let n = STAGE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let candidate = parent.join(format!(".{base}.dcmd-incoming-{n}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(FsError::Io(format!(
        "could not find a free staging name next to {}",
        dest.display()
    )))
}

/// Applies the policy to a destination that may already exist.
///
/// Deliberately performs no deletion. Replacing used to remove the existing entry
/// up front, which meant any later failure — a partial copy, a permission error, a
/// cancellation — left the user with neither their old data nor the new. The
/// replacement is assembled beside the target instead and swapped in by
/// `commit_replace` only once it is complete.
pub fn resolve_destination(dest: &Path, policy: ConflictPolicy) -> Result<Resolution, FsError> {
    if !dest.exists() {
        return Ok(Resolution::Direct(dest.to_path_buf()));
    }
    match policy {
        ConflictPolicy::Fail => Err(FsError::AlreadyExists(format!(
            "destination already exists: {}",
            dest.display()
        ))),
        ConflictPolicy::Skip => Ok(Resolution::Skip),
        ConflictPolicy::KeepBoth => Ok(Resolution::Direct(unique_destination(dest)?)),
        ConflictPolicy::Overwrite => Ok(Resolution::Replace {
            staging: staging_path(dest)?,
            target: dest.to_path_buf(),
        }),
    }
}

/// Swaps a fully written `staging` entry into `target`, replacing what was there.
///
/// The old entry is moved aside first and only removed once the new one is in
/// place, so a failure at any point leaves one intact copy rather than none.
pub fn commit_replace(staging: &Path, target: &Path) -> Result<(), FsError> {
    // A plain rename atomically replaces an existing file on Unix, which is the
    // common case and leaves no window at all.
    if !target.is_dir() && std::fs::rename(staging, target).is_ok() {
        return Ok(());
    }

    // Directories, and platforms where rename will not clobber, need the old
    // entry out of the way first — but preserved until the new one is in place.
    let backup = staging_path(target)?;
    std::fs::rename(target, &backup)?;

    match std::fs::rename(staging, target) {
        Ok(()) => {
            // Only now is the old copy redundant.
            if backup.is_dir() {
                let _ = std::fs::remove_dir_all(&backup);
            } else {
                let _ = std::fs::remove_file(&backup);
            }
            Ok(())
        }
        Err(e) => {
            // Put the original back rather than leaving the target missing.
            let _ = std::fs::rename(&backup, target);
            Err(FsError::Io(format!(
                "could not replace {}: {e}",
                target.display()
            )))
        }
    }
}

/// Removes a half-written staging entry. Best effort: the original is untouched
/// either way, so a leftover temp is preferable to reporting a second failure.
pub fn discard_staging(staging: &Path) {
    if staging.is_dir() {
        let _ = std::fs::remove_dir_all(staging);
    } else if staging.exists() {
        let _ = std::fs::remove_file(staging);
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
    fn skip_resolves_to_skip() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "x").unwrap();
        assert_eq!(resolve_destination(&f, ConflictPolicy::Skip).unwrap(), Resolution::Skip);
    }

    // The whole point of the redesign: resolving must not touch anything on disk.
    #[test]
    fn overwrite_deletes_nothing_when_resolved() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("d");
        fs::create_dir(&d).unwrap();
        fs::write(d.join("old.txt"), "old").unwrap();

        let resolved = resolve_destination(&d, ConflictPolicy::Overwrite).unwrap();
        match resolved {
            Resolution::Replace { staging, target } => {
                assert_eq!(target, d);
                assert_ne!(staging, d);
                assert!(!staging.exists(), "staging should not be pre-created");
            }
            other => panic!("expected Replace, got {other:?}"),
        }
        assert!(d.exists(), "resolving must not delete the existing entry");
        assert!(d.join("old.txt").exists(), "contents must be untouched");
    }

    #[test]
    fn staging_is_a_sibling_so_the_swap_is_a_rename() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "x").unwrap();
        if let Resolution::Replace { staging, .. } =
            resolve_destination(&f, ConflictPolicy::Overwrite).unwrap()
        {
            assert_eq!(staging.parent(), f.parent());
        } else {
            panic!("expected Replace");
        }
    }

    #[test]
    fn commit_replaces_a_file_and_removes_the_staging_copy() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("a.txt");
        fs::write(&target, "old").unwrap();
        let staging = tmp.path().join(".a.txt.incoming");
        fs::write(&staging, "new").unwrap();

        commit_replace(&staging, &target).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert!(!staging.exists());
    }

    #[test]
    fn commit_replaces_a_directory_wholesale() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("d");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("old.txt"), "old").unwrap();

        let staging = tmp.path().join(".d.incoming");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("new.txt"), "new").unwrap();

        commit_replace(&staging, &target).unwrap();
        assert!(target.join("new.txt").exists());
        assert!(!target.join("old.txt").exists(), "replace should not merge");
        assert!(!staging.exists());
    }

    #[test]
    fn discarding_staging_leaves_the_target_alone() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("a.txt");
        fs::write(&target, "original").unwrap();
        let staging = tmp.path().join(".a.txt.incoming");
        fs::write(&staging, "half-written").unwrap();

        discard_staging(&staging);
        assert!(!staging.exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
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
            assert_eq!(
                resolve_destination(&f, p).unwrap(),
                Resolution::Direct(f.clone())
            );
        }
    }
}
