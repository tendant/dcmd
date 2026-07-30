use crate::error::FsError;
use crate::operations::transfer::{
    check_not_same_directory, commit_replace, discard_staging, resolve_destination, ConflictPolicy,
    FailedItem, Resolution, TransferControl, TransferReport,
};
use std::fs;
use std::path::{Path, PathBuf};

pub fn move_paths(sources: &[PathBuf], destination_dir: &Path) -> Result<(), FsError> {
    if !destination_dir.is_dir() {
        return Err(FsError::NotADirectory(format!(
            "destination is not a directory: {}",
            destination_dir.display()
        )));
    }

    for source in sources {
        if !source.exists() {
            return Err(FsError::NotFound(format!(
                "source does not exist: {}",
                source.display()
            )));
        }

        let file_name = source.file_name().ok_or_else(|| {
            FsError::Io("cannot get file name".to_string())
        })?;

        let dest = destination_dir.join(&file_name);

        if dest.exists() {
            return Err(FsError::AlreadyExists(format!(
                "destination already exists: {}",
                dest.display()
            )));
        }

        // Same hazard as copy: the fallback path copies before deleting, and a
        // rename into your own subdirectory is meaningless regardless.
        if source.is_dir() {
            crate::operations::copy::check_not_into_itself(source, destination_dir)?;
        }

        // Try a direct rename first (same filesystem)
        match fs::rename(source, &dest) {
            Ok(_) => continue,
            Err(_) => {
                // Fall back to copy + delete (cross-filesystem)
                copy_then_delete(source, &dest)?;
            }
        }
    }

    Ok(())
}

/// Moves each source into `destination_dir`, applying `policy` to name clashes and
/// reporting per-item outcomes rather than abandoning the rest on first failure.
pub fn move_paths_with(
    sources: &[PathBuf],
    destination_dir: &Path,
    policy: ConflictPolicy,
) -> Result<TransferReport, FsError> {
    let never = std::sync::atomic::AtomicBool::new(false);
    let noop = |_: usize, _: usize, _: &str| {};
    move_paths_controlled(
        sources,
        destination_dir,
        policy,
        &TransferControl { cancel: &never, on_progress: &noop },
    )
}

/// As `move_paths_with`, but cancellable and reporting progress per item.
pub fn move_paths_controlled(
    sources: &[PathBuf],
    destination_dir: &Path,
    policy: ConflictPolicy,
    control: &TransferControl<'_>,
) -> Result<TransferReport, FsError> {
    if !destination_dir.is_dir() {
        return Err(FsError::NotADirectory(format!(
            "destination is not a directory: {}",
            destination_dir.display()
        )));
    }

    let mut report = TransferReport::default();

    for (i, source) in sources.iter().enumerate() {
        if control.is_cancelled() {
            break;
        }
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        (control.on_progress)(i, sources.len(), &name);

        match move_one(source, destination_dir, policy, &mut report) {
            Ok(Some(())) => report.completed.push(source.display().to_string()),
            Ok(None) => report.skipped.push(source.display().to_string()),
            Err(e) => report.failed.push(FailedItem::new(source, &e)),
        }
    }

    Ok(report)
}

/// `Ok(None)` means the item was skipped by policy.
fn move_one(
    source: &Path,
    destination_dir: &Path,
    policy: ConflictPolicy,
    report: &mut TransferReport,
) -> Result<Option<()>, FsError> {
    if !source.exists() {
        return Err(FsError::NotFound(format!(
            "source does not exist: {}",
            source.display()
        )));
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| FsError::Io("cannot get file name".to_string()))?;

    if source.is_dir() {
        crate::operations::copy::check_not_into_itself(source, destination_dir)?;
    }

    // Before resolve_destination, which under Overwrite would delete the source.
    check_not_same_directory(source, destination_dir)?;

    let landing = destination_dir.join(file_name);

    // Directories merge into an existing directory, matching copy: replacing
    // wholesale would discard whatever the destination has that the source lacks.
    if source.is_dir() && landing.is_dir() {
        merge_move(source, &landing, policy, report)?;
        // Whatever is left behind was skipped or failed, so only prune when empty.
        let _ = fs::remove_dir(source);
        return Ok(Some(()));
    }

    let resolution = resolve_destination(&landing, policy)?;
    let dest = match resolution.write_path() {
        Some(d) => d.to_path_buf(),
        None => return Ok(None),
    };

    let written = if fs::rename(source, &dest).is_ok() {
        Ok(())
    } else {
        copy_then_delete(source, &dest)
    };

    match (&resolution, written) {
        (Resolution::Direct(_), r) => r.map(|_| Some(())),
        (Resolution::Replace { staging, target }, Ok(())) => {
            commit_replace(staging, target).map(|_| Some(()))
        }
        (Resolution::Replace { staging, .. }, Err(e)) => {
            // The source may already be gone if copy_then_delete got that far;
            // discarding the staging copy would then lose it, so keep it.
            if source.exists() {
                discard_staging(staging);
            }
            Err(e)
        }
        (Resolution::Skip, _) => Ok(None),
    }
}

/// Moves the contents of `src` into the existing directory `dst`, recursing where
/// both sides have the same subdirectory and applying `policy` to files that
/// collide. Source directories are pruned as they empty; anything skipped or
/// failed is deliberately left behind rather than lost.
fn merge_move(
    src: &Path,
    dst: &Path,
    policy: ConflictPolicy,
    report: &mut TransferReport,
) -> Result<(), FsError> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());

        let outcome: Result<(), FsError> = if from.is_dir() && to.is_dir() {
            merge_move(&from, &to, policy, report).map(|_| {
                let _ = fs::remove_dir(&from);
            })
        } else if to.exists() {
            match resolve_destination(&to, policy) {
                Ok(Resolution::Skip) => {
                    report.skipped.push(from.display().to_string());
                    Ok(())
                }
                Ok(Resolution::Direct(p)) => move_entry(&from, &p),
                Ok(Resolution::Replace { staging, target }) => match move_entry(&from, &staging) {
                    Ok(()) => commit_replace(&staging, &target),
                    Err(e) => {
                        // Only discard the staging copy if the source survived;
                        // otherwise it is the last copy of the data.
                        if from.exists() {
                            discard_staging(&staging);
                        }
                        Err(e)
                    }
                },
                Err(e) => Err(e),
            }
        } else {
            move_entry(&from, &to)
        };

        if let Err(e) = outcome {
            report.failed.push(FailedItem::new(&from, &e));
        }
    }
    Ok(())
}

/// Rename where possible, falling back to copy-then-delete across filesystems.
fn move_entry(from: &Path, to: &Path) -> Result<(), FsError> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_then_delete(from, to)
}

fn copy_then_delete(src: &Path, dst: &Path) -> Result<(), FsError> {
    if src.is_dir() {
        copy_dir_recursive(src, dst)?;
        fs::remove_dir_all(src)?;
    } else {
        fs::copy(src, dst)?;
        fs::remove_file(src)?;
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), FsError> {
    fs::create_dir(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_move_file() {
        let temp_dir = TempDir::new().unwrap();
        let src_dir = temp_dir.path().join("src");
        fs::create_dir(&src_dir).unwrap();
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let src = src_dir.join("source.txt");
        fs::write(&src, "content").unwrap();

        let result = move_paths(&[src.clone()], &dest_dir);
        assert!(result.is_ok());
        assert!(!src.exists());
        assert!(dest_dir.join("source.txt").exists());
    }

    #[test]
    fn test_move_directory() {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().join("base");
        fs::create_dir(&base_dir).unwrap();

        let src_dir = base_dir.join("source_dir");
        fs::create_dir(&src_dir).unwrap();
        fs::write(src_dir.join("file.txt"), "content").unwrap();

        let dest_dir = base_dir.join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = move_paths(&[src_dir.clone()], &dest_dir);
        assert!(result.is_ok());
        assert!(!src_dir.exists());
        assert!(dest_dir.join("source_dir/file.txt").exists());
    }

    #[test]
    fn test_move_collision() {
        let temp_dir = TempDir::new().unwrap();
        let src = temp_dir.path().join("source.txt");
        fs::write(&src, "content").unwrap();
        fs::write(temp_dir.path().join("source.txt"), "existing").unwrap();

        let result = move_paths(&[src], temp_dir.path());
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_copy_then_delete() {
        let temp_dir = TempDir::new().unwrap();
        let src = temp_dir.path().join("source.txt");
        fs::write(&src, "content").unwrap();
        let dst = temp_dir.path().join("subdir/dest.txt");
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();

        let result = copy_then_delete(&src, &dst);
        assert!(result.is_ok());
        assert!(!src.exists());
        assert!(dst.exists());
    }
}

#[cfg(test)]
mod same_dir_tests {
    use super::*;
    use crate::operations::transfer::ConflictPolicy;
    use tempfile::TempDir;

    #[test]
    fn moving_into_the_same_directory_is_refused_and_keeps_the_file() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "keep").unwrap();

        let report = move_paths_with(&[f.clone()], tmp.path(), ConflictPolicy::Overwrite).unwrap();

        assert!(f.exists(), "source was destroyed");
        assert_eq!(fs::read_to_string(&f).unwrap(), "keep");
        assert_eq!(report.failed.len(), 1);
    }
}

#[cfg(test)]
mod partial_conflict_tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, PathBuf, PathBuf, Vec<PathBuf>) {
        let tmp = TempDir::new().unwrap();
        let left = tmp.path().join("left");
        let right = tmp.path().join("right");
        fs::create_dir_all(&left).unwrap();
        fs::create_dir_all(&right).unwrap();

        fs::write(left.join("a.txt"), "A").unwrap();
        fs::write(left.join("dup.txt"), "LEFT-dup").unwrap();
        let tree = left.join("tree");
        fs::create_dir_all(tree.join("sub")).unwrap();
        fs::write(tree.join("sub/y.txt"), "Y").unwrap();

        fs::write(right.join("dup.txt"), "RIGHT-dup").unwrap();

        let sources = vec![left.join("a.txt"), left.join("dup.txt"), left.join("tree")];
        (tmp, left, right, sources)
    }

    /// The dangerous asymmetry: a moved item is removed from the source, so a
    /// skipped item must be left behind rather than deleted. Losing it would mean
    /// the file exists in neither pane.
    #[test]
    fn skipped_items_remain_in_the_source() {
        let (_t, left, right, sources) = fixture();
        let report = move_paths_with(&sources, &right, ConflictPolicy::Skip).unwrap();

        assert_eq!(report.skipped.len(), 1, "{report:?}");
        assert!(left.join("dup.txt").exists(), "skipped source was deleted");
        assert_eq!(fs::read_to_string(left.join("dup.txt")).unwrap(), "LEFT-dup");
        assert_eq!(fs::read_to_string(right.join("dup.txt")).unwrap(), "RIGHT-dup");

        // The others did move, and are gone from the source.
        assert!(!left.join("a.txt").exists());
        assert!(right.join("tree/sub/y.txt").exists());
        assert!(!left.join("tree").exists());
    }

    #[test]
    fn failed_items_remain_in_the_source() {
        let (_t, left, right, sources) = fixture();
        let report = move_paths_with(&sources, &right, ConflictPolicy::Fail).unwrap();

        assert_eq!(report.failed.len(), 1, "{report:?}");
        assert!(left.join("dup.txt").exists(), "failed source was deleted");
        assert!(!left.join("a.txt").exists(), "non-colliding item should have moved");
    }

    #[test]
    fn overwrite_moves_the_collision_and_removes_the_source() {
        let (_t, left, right, sources) = fixture();
        let report = move_paths_with(&sources, &right, ConflictPolicy::Overwrite).unwrap();

        assert_eq!(report.completed.len(), 3, "{report:?}");
        assert_eq!(fs::read_to_string(right.join("dup.txt")).unwrap(), "LEFT-dup");
        assert!(!left.join("dup.txt").exists());
        assert!(right.join("tree/sub/y.txt").exists());
    }

    #[test]
    fn keep_both_moves_the_collision_alongside() {
        let (_t, left, right, sources) = fixture();
        move_paths_with(&sources, &right, ConflictPolicy::KeepBoth).unwrap();

        assert_eq!(fs::read_to_string(right.join("dup.txt")).unwrap(), "RIGHT-dup");
        assert_eq!(fs::read_to_string(right.join("dup copy.txt")).unwrap(), "LEFT-dup");
        assert!(!left.join("dup.txt").exists(), "source should be gone after a move");
    }
}

#[cfg(test)]
mod merge_tests {
    use super::*;
    use tempfile::TempDir;

    fn read(p: &Path) -> String {
        fs::read_to_string(p).unwrap_or_else(|_| "<missing>".into())
    }

    #[test]
    fn moving_into_an_existing_folder_merges_rather_than_replacing() {
        let tmp = TempDir::new().unwrap();
        let left = tmp.path().join("left");
        let right = tmp.path().join("right");
        let src = left.join("shared");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("from-left.txt"), "L").unwrap();
        let dst = right.join("shared");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("from-right.txt"), "R").unwrap();

        let report = move_paths_with(&[src.clone()], &right, ConflictPolicy::Fail).unwrap();
        assert!(report.failed.is_empty(), "{report:?}");

        assert_eq!(read(&dst.join("from-left.txt")), "L", "moved file missing");
        assert_eq!(read(&dst.join("from-right.txt")), "R", "destination file lost");
        assert!(!src.exists(), "emptied source folder should be pruned");
    }

    #[test]
    fn a_skipped_file_stays_behind_and_keeps_its_folder() {
        let tmp = TempDir::new().unwrap();
        let left = tmp.path().join("left");
        let right = tmp.path().join("right");
        let src = left.join("shared");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("clash.txt"), "L").unwrap();
        fs::write(src.join("unique.txt"), "U").unwrap();
        let dst = right.join("shared");
        fs::create_dir_all(&dst).unwrap();
        fs::write(dst.join("clash.txt"), "R").unwrap();

        let report = move_paths_with(&[src.clone()], &right, ConflictPolicy::Skip).unwrap();
        assert_eq!(report.skipped.len(), 1, "{report:?}");

        assert_eq!(read(&dst.join("clash.txt")), "R", "skipped file was overwritten");
        assert_eq!(read(&dst.join("unique.txt")), "U", "non-clashing file did not move");
        // The skipped file must still exist somewhere.
        assert_eq!(read(&src.join("clash.txt")), "L", "skipped source was lost");
        assert!(src.exists(), "folder holding a skipped file should not be pruned");
    }

    #[test]
    fn nested_folders_merge_at_every_level() {
        let tmp = TempDir::new().unwrap();
        let left = tmp.path().join("left");
        let right = tmp.path().join("right");
        fs::create_dir_all(left.join("s/a/b")).unwrap();
        fs::write(left.join("s/a/b/deep.txt"), "D").unwrap();
        fs::create_dir_all(right.join("s/a/b")).unwrap();
        fs::write(right.join("s/a/b/other.txt"), "O").unwrap();

        move_paths_with(&[left.join("s")], &right, ConflictPolicy::Fail).unwrap();

        assert_eq!(read(&right.join("s/a/b/deep.txt")), "D");
        assert_eq!(read(&right.join("s/a/b/other.txt")), "O");
    }
}
