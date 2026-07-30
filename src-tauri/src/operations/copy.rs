use crate::error::FsError;
use crate::operations::transfer::{
    check_not_same_directory, commit_replace, discard_staging, resolve_destination, ConflictPolicy,
    FailedItem, Resolution, TransferControl, TransferReport,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Fails on the first problem, preserving its error kind so callers can branch on
/// it. Used where an all-or-nothing result is wanted instead of a report.
pub fn copy_paths(sources: &[PathBuf], destination_dir: &Path) -> Result<(), FsError> {
    if !destination_dir.is_dir() {
        return Err(FsError::NotADirectory(format!(
            "destination is not a directory: {}",
            destination_dir.display()
        )));
    }
    for source in sources {
        let never = std::sync::atomic::AtomicBool::new(false);
        let noop = |_: usize, _: usize, _: &str| {};
        copy_one(
            source,
            destination_dir,
            ConflictPolicy::Fail,
            &TransferControl { cancel: &never, on_progress: &noop },
        )?;
    }
    Ok(())
}

/// Copies each source into `destination_dir`, applying `policy` to name clashes.
///
/// One item failing no longer abandons the remainder: the caller gets a report of
/// what completed, what was skipped and what failed, so a partial transfer can be
/// described accurately instead of silently leaving half the work done.
pub fn copy_paths_with(
    sources: &[PathBuf],
    destination_dir: &Path,
    policy: ConflictPolicy,
) -> Result<TransferReport, FsError> {
    let never = std::sync::atomic::AtomicBool::new(false);
    let noop = |_: usize, _: usize, _: &str| {};
    copy_paths_controlled(
        sources,
        destination_dir,
        policy,
        &TransferControl { cancel: &never, on_progress: &noop },
    )
}

/// As `copy_paths_with`, but cancellable and reporting progress per item.
pub fn copy_paths_controlled(
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
        // Stop between items as well as inside a large one, so cancelling a
        // multi-file transfer does not have to wait for the current file.
        if control.is_cancelled() {
            break;
        }
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        (control.on_progress)(i, sources.len(), &name);

        match copy_one(source, destination_dir, policy, control) {
            Ok(Some(())) => report.completed.push(source.display().to_string()),
            Ok(None) => report.skipped.push(source.display().to_string()),
            Err(e) => report.failed.push(FailedItem {
                path: source.display().to_string(),
                message: e.to_string(),
            }),
        }
    }

    Ok(report)
}

/// `Ok(None)` means the item was skipped by policy.
fn copy_one(
    source: &Path,
    destination_dir: &Path,
    policy: ConflictPolicy,
    control: &TransferControl<'_>,
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

    // Before resolve_destination, which under Overwrite would delete the source.
    check_not_same_directory(source, destination_dir)?;

    let resolution = resolve_destination(&destination_dir.join(file_name), policy)?;
    let dest = match resolution.write_path() {
        Some(d) => d.to_path_buf(),
        None => return Ok(None),
    };

    if source.is_dir() {
        check_not_into_itself(source, destination_dir)?;
    }

    let written = if source.is_dir() {
        copy_dir_recursive(source, &dest, &mut Vec::new(), control)
    } else {
        fs::copy(source, &dest).map(|_| ()).map_err(Into::into)
    };

    match (&resolution, written) {
        // Nothing was in the way; the copy is already where it belongs.
        (Resolution::Direct(_), r) => r.map(|_| Some(())),

        // Only swap the replacement in once it is complete. On failure the
        // original is left exactly as it was.
        (Resolution::Replace { staging, target }, Ok(())) => {
            commit_replace(staging, target).map(|_| Some(()))
        }
        (Resolution::Replace { staging, .. }, Err(e)) => {
            discard_staging(staging);
            Err(e)
        }

        (Resolution::Skip, _) => Ok(None),
    }
}

/// Rejects copying a directory into itself or anywhere beneath it, which would
/// otherwise recurse until the path became too long, leaving a deep tree of
/// half-copied directories inside the user's source folder.
pub fn check_not_into_itself(source: &Path, destination_dir: &Path) -> Result<(), FsError> {
    if crate::fs::paths::is_same_or_inside(destination_dir, source) {
        return Err(FsError::InvalidName(format!(
            "cannot copy {} into itself",
            source.display()
        )));
    }
    Ok(())
}

fn copy_dir_recursive(
    src: &Path,
    dst: &Path,
    seen: &mut Vec<PathBuf>,
    control: &TransferControl<'_>,
) -> Result<(), FsError> {
    control.check()?;
    // Symlinked directories are dereferenced, so a link pointing at an ancestor
    // would recurse forever. Track the real directories already entered.
    let real = crate::fs::paths::resolve(src);
    if seen.contains(&real) {
        return Ok(());
    }
    seen.push(real);

    fs::create_dir(dst)?;

    for entry in fs::read_dir(src)? {
        control.check()?;
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dest, seen, control)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }

    seen.pop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_copy_single_file() {
        let temp_dir = TempDir::new().unwrap();
        let src_dir = temp_dir.path().join("src");
        fs::create_dir(&src_dir).unwrap();
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let src = src_dir.join("source.txt");
        fs::write(&src, "content").unwrap();

        let result = copy_paths(&[src.clone()], &dest_dir);
        assert!(result.is_ok());
        assert!(src.exists());
        assert!(dest_dir.join("source.txt").exists());
    }

    #[test]
    fn test_copy_directory_recursive() {
        let temp_dir = TempDir::new().unwrap();
        let base_dir = temp_dir.path().join("base");
        fs::create_dir(&base_dir).unwrap();

        let src_dir = base_dir.join("source_dir");
        fs::create_dir(&src_dir).unwrap();
        fs::write(src_dir.join("file.txt"), "content").unwrap();
        fs::create_dir(src_dir.join("subdir")).unwrap();
        fs::write(src_dir.join("subdir/nested.txt"), "nested").unwrap();

        let dest_dir = base_dir.join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = copy_paths(&[src_dir.clone()], &dest_dir);
        assert!(result.is_ok());

        let copied_dir = dest_dir.join("source_dir");
        assert!(copied_dir.is_dir());
        assert!(copied_dir.join("file.txt").exists());
        assert!(copied_dir.join("subdir/nested.txt").exists());
    }

    #[test]
    fn test_copy_collision() {
        let temp_dir = TempDir::new().unwrap();
        let src_dir = temp_dir.path().join("src");
        fs::create_dir(&src_dir).unwrap();
        let dest_dir = temp_dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let src = src_dir.join("source.txt");
        fs::write(&src, "content").unwrap();
        fs::write(dest_dir.join("source.txt"), "existing").unwrap();

        let result = copy_paths(&[src], &dest_dir);
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_copy_nonexistent_source() {
        let temp_dir = TempDir::new().unwrap();
        let nonexistent = temp_dir.path().join("nonexistent.txt");

        let result = copy_paths(&[nonexistent], temp_dir.path());
        assert!(matches!(result, Err(FsError::NotFound(_))));
    }
}


#[cfg(test)]
mod containment_tests {
    use super::*;
    use tempfile::TempDir;

    fn count_tree(p: &Path, depth: usize) -> (usize, usize) {
        if depth > 80 {
            return (0, depth);
        }
        let (mut n, mut max) = (0, depth);
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                n += 1;
                let (cn, cd) = count_tree(&e.path(), depth + 1);
                n += cn;
                if cd > max {
                    max = cd;
                }
            }
        }
        (n, max)
    }

    #[test]
    fn refuses_to_copy_a_directory_into_its_own_descendant() {
        let tmp = TempDir::new().unwrap();
        let foo = tmp.path().join("foo");
        fs::create_dir(&foo).unwrap();
        fs::write(foo.join("f.txt"), "x").unwrap();
        let inner = foo.join("inner");
        fs::create_dir(&inner).unwrap();

        let err = copy_paths(&[foo.clone()], &inner).unwrap_err();
        assert!(matches!(err, FsError::InvalidName(_)), "got {err:?}");

        // The real damage was the debris left behind, so assert the source is intact.
        let (entries, depth) = count_tree(&foo, 0);
        assert_eq!(entries, 2, "source directory was modified");
        assert!(depth <= 1, "nested debris left at depth {depth}");
    }

    #[test]
    fn refuses_to_copy_a_directory_into_itself() {
        let tmp = TempDir::new().unwrap();
        let foo = tmp.path().join("foo");
        fs::create_dir(&foo).unwrap();
        let err = copy_paths(&[foo.clone()], &foo).unwrap_err();
        assert!(matches!(err, FsError::InvalidName(_)), "got {err:?}");
    }

    #[test]
    fn still_copies_into_a_sibling_directory() {
        let tmp = TempDir::new().unwrap();
        let foo = tmp.path().join("foo");
        fs::create_dir(&foo).unwrap();
        fs::write(foo.join("f.txt"), "hello").unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();

        copy_paths(&[foo.clone()], &dest).unwrap();
        assert_eq!(fs::read_to_string(dest.join("foo/f.txt")).unwrap(), "hello");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_cycle_terminates() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), "a").unwrap();
        // A link pointing back at an ancestor: dereferencing it recurses forever
        // unless the walk remembers where it has been.
        std::os::unix::fs::symlink(&src, src.join("loop")).unwrap();

        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let _ = copy_paths(&[src.clone()], &dest);

        let (_, depth) = count_tree(&dest, 0);
        assert!(depth < 20, "symlink cycle recursed to depth {depth}");
    }
}

#[cfg(test)]
mod cancel_tests {
    use super::*;
    use crate::operations::transfer::TransferControl;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::TempDir;

    fn control<'a>(
        cancel: &'a AtomicBool,
        noop: &'a (dyn Fn(usize, usize, &str) + Send + Sync),
    ) -> TransferControl<'a> {
        TransferControl { cancel, on_progress: noop }
    }

    #[test]
    fn a_cancelled_transfer_stops_and_does_not_copy_everything() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        for i in 0..300 {
            fs::write(src.join(format!("f{i}.txt")), "x").unwrap();
        }
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();

        // Already cancelled: the walk must refuse rather than run to completion.
        let cancel = AtomicBool::new(true);
        let noop = |_: usize, _: usize, _: &str| {};
        let report =
            copy_paths_controlled(&[src.clone()], &dest, ConflictPolicy::Fail, &control(&cancel, &noop))
                .unwrap();

        assert!(report.completed.is_empty(), "nothing should have completed");
        let copied = dest.join("src");
        let n = fs::read_dir(&copied).map(|r| r.count()).unwrap_or(0);
        assert!(n < 300, "copied {n} of 300 despite cancellation");
    }

    #[test]
    fn progress_is_reported_per_item() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let mut srcs = Vec::new();
        for i in 0..3 {
            let f = tmp.path().join(format!("s{i}.txt"));
            fs::write(&f, "x").unwrap();
            srcs.push(f);
        }

        let seen = std::sync::Mutex::new(Vec::new());
        let cancel = AtomicBool::new(false);
        let record = |cur: usize, total: usize, name: &str| {
            seen.lock().unwrap().push((cur, total, name.to_string()));
        };
        let report =
            copy_paths_controlled(&srcs, &dest, ConflictPolicy::Fail, &control(&cancel, &record))
                .unwrap();

        assert_eq!(report.completed.len(), 3);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0].0, 0);
        assert_eq!(seen[0].1, 3);
        assert_eq!(seen[2].2, "s2.txt");
    }

    #[test]
    fn an_uncancelled_transfer_still_completes() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), "hello").unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();

        let cancel = AtomicBool::new(false);
        let noop = |_: usize, _: usize, _: &str| {};
        let report =
            copy_paths_controlled(&[src.clone()], &dest, ConflictPolicy::Fail, &control(&cancel, &noop))
                .unwrap();
        assert_eq!(report.completed.len(), 1);
        assert_eq!(fs::read_to_string(dest.join("src/a.txt")).unwrap(), "hello");
        assert!(!cancel.load(Ordering::Relaxed));
    }
}

#[cfg(test)]
mod same_dir_tests {
    use super::*;
    use tempfile::TempDir;

    // Regression: Overwrite resolved the destination to the source itself and
    // deleted it before copying, destroying the file outright. Reachable by
    // default, since both panes open on the same directory.
    #[test]
    fn overwrite_into_the_same_directory_does_not_destroy_the_file() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("important.txt");
        fs::write(&f, "irreplaceable").unwrap();

        let report =
            copy_paths_with(&[f.clone()], tmp.path(), ConflictPolicy::Overwrite).unwrap();

        assert!(f.exists(), "source file was destroyed");
        assert_eq!(fs::read_to_string(&f).unwrap(), "irreplaceable");
        assert_eq!(report.completed.len(), 0);
        assert_eq!(report.failed.len(), 1);
    }

    #[test]
    fn overwrite_a_directory_into_its_own_parent_does_not_destroy_it() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("project");
        fs::create_dir(&d).unwrap();
        fs::write(d.join("code.rs"), "fn main(){}").unwrap();

        let _ = copy_paths_with(&[d.clone()], tmp.path(), ConflictPolicy::Overwrite);

        assert!(d.exists(), "source directory was destroyed");
        assert_eq!(fs::read_to_string(d.join("code.rs")).unwrap(), "fn main(){}");
    }

    #[test]
    fn every_policy_refuses_the_same_directory() {
        for policy in [
            ConflictPolicy::Fail,
            ConflictPolicy::Skip,
            ConflictPolicy::Overwrite,
            ConflictPolicy::KeepBoth,
        ] {
            let tmp = TempDir::new().unwrap();
            let f = tmp.path().join("a.txt");
            fs::write(&f, "keep").unwrap();

            let report = copy_paths_with(&[f.clone()], tmp.path(), policy).unwrap();
            assert!(f.exists(), "{policy:?} destroyed the source");
            assert_eq!(fs::read_to_string(&f).unwrap(), "keep");
            assert!(report.completed.is_empty(), "{policy:?} should not have copied");
        }
    }

    #[test]
    fn a_different_directory_still_works() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("a.txt");
        fs::write(&f, "hello").unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();

        let report = copy_paths_with(&[f], &dest, ConflictPolicy::Fail).unwrap();
        assert_eq!(report.completed.len(), 1);
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "hello");
    }
}

#[cfg(test)]
mod replace_safety_tests {
    use super::*;
    use crate::operations::transfer::TransferControl;
    use std::sync::atomic::AtomicBool;
    use tempfile::TempDir;

    fn ctl<'a>(
        c: &'a AtomicBool,
        f: &'a (dyn Fn(usize, usize, &str) + Send + Sync),
    ) -> TransferControl<'a> {
        TransferControl { cancel: c, on_progress: f }
    }

    /// The core guarantee: if a replacement cannot be completed, the user keeps
    /// what they had. Previously the target was deleted up front, so a failure
    /// left them with neither the old data nor the new.
    #[test]
    fn a_cancelled_replace_leaves_the_original_intact() {
        let tmp = TempDir::new().unwrap();

        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        let payload = src.join("data");
        fs::create_dir(&payload).unwrap();
        for i in 0..200 {
            fs::write(payload.join(format!("f{i}.bin")), "xxxx").unwrap();
        }

        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let existing = dest.join("src");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("precious.txt"), "must survive").unwrap();

        // Cancelled before it can finish, mid-replace.
        let cancel = AtomicBool::new(true);
        let noop = |_: usize, _: usize, _: &str| {};
        let report =
            copy_paths_controlled(&[src], &dest, ConflictPolicy::Overwrite, &ctl(&cancel, &noop))
                .unwrap();

        assert!(existing.exists(), "the existing directory was destroyed");
        assert_eq!(
            fs::read_to_string(existing.join("precious.txt")).unwrap(),
            "must survive",
            "existing contents were lost"
        );
        assert!(report.completed.is_empty());
    }

    #[test]
    fn a_failed_replace_leaves_the_original_and_no_staging_debris() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("gone.txt"), "original").unwrap();

        // Source vanishes, so the copy cannot succeed.
        let missing = tmp.path().join("elsewhere").join("gone.txt");

        let report =
            copy_paths_with(&[missing], &dest, ConflictPolicy::Overwrite).unwrap();

        assert_eq!(report.failed.len(), 1);
        assert_eq!(
            fs::read_to_string(dest.join("gone.txt")).unwrap(),
            "original",
            "original was disturbed by a failed replace"
        );
        let debris: Vec<_> = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("dcmd-incoming"))
            .collect();
        assert!(debris.is_empty(), "staging debris left behind");
    }

    #[test]
    fn a_successful_replace_swaps_the_contents_and_cleans_up() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("new.txt"), "new").unwrap();

        let dest = tmp.path().join("dest");
        fs::create_dir(&dest).unwrap();
        let existing = dest.join("src");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("old.txt"), "old").unwrap();

        let report = copy_paths_with(&[src], &dest, ConflictPolicy::Overwrite).unwrap();

        assert_eq!(report.completed.len(), 1, "{:?}", report.failed);
        assert!(existing.join("new.txt").exists());
        assert!(!existing.join("old.txt").exists(), "replace should not merge");
        let debris: Vec<_> = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("dcmd-incoming"))
            .collect();
        assert!(debris.is_empty(), "staging debris left behind");
    }

    #[test]
    fn replacing_a_single_file_works_and_keeps_the_new_contents() {
        let tmp = TempDir::new().unwrap();
        let src_dir = tmp.path().join("s");
        fs::create_dir(&src_dir).unwrap();
        let src = src_dir.join("a.txt");
        fs::write(&src, "new").unwrap();

        let dest = tmp.path().join("d");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("a.txt"), "old").unwrap();

        let report = copy_paths_with(&[src], &dest, ConflictPolicy::Overwrite).unwrap();
        assert_eq!(report.completed.len(), 1, "{:?}", report.failed);
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "new");
    }
}
