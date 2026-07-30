use crate::error::FsError;
use crate::operations::transfer::{
    check_not_same_directory, commit_replace, discard_staging, resolve_destination, ConflictPolicy,
    FailedItem, Resolution, TransferControl, TransferReport,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Test-only convenience: a transfer with no progress reporting or cancellation.
/// Production goes through `copy_paths_controlled`.
#[cfg(test)]
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
        &TransferControl {
            cancel: &never,
            on_progress: &noop,
        },
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

        match copy_one(source, destination_dir, policy, control, &mut report) {
            Ok(Some(())) => report.completed.push(source.display().to_string()),
            Ok(None) => report.skipped.push(source.display().to_string()),
            Err(e) => report.failed.push(FailedItem::new(source, &e)),
        }
    }

    Ok(report)
}

/// `Ok(None)` means the item was skipped by policy.
/// `Ok(None)` means the item was skipped by policy.
///
/// Per-file outcomes inside a merged directory are recorded straight into
/// `report`, so a directory that mostly succeeded is not reduced to a single
/// pass/fail.
fn copy_one(
    source: &Path,
    destination_dir: &Path,
    policy: ConflictPolicy,
    control: &TransferControl<'_>,
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

    // Before resolve_destination, which under Overwrite would delete the source.
    check_not_same_directory(source, destination_dir)?;

    let dest = destination_dir.join(file_name);

    // A directory landing on an existing directory is merged, not treated as one
    // conflicting unit. Replacing wholesale would discard everything the
    // destination has that the source does not, which is rarely what "copy this
    // folder in" is meant to do. The policy still applies, but to the individual
    // files inside.
    if source.is_dir() && dest.is_dir() {
        check_not_into_itself(source, destination_dir)?;
        merge_dir(source, &dest, policy, control, report, &mut Vec::new())?;
        return Ok(Some(()));
    }

    let resolution = resolve_destination(&dest, policy)?;
    let write_to = match resolution.write_path() {
        Some(d) => d.to_path_buf(),
        None => return Ok(None),
    };

    if source.is_dir() {
        check_not_into_itself(source, destination_dir)?;
    }

    let written = if source.is_dir() {
        copy_dir_recursive(source, &write_to, &mut Vec::new(), control)
    } else {
        fs::copy(source, &write_to).map(|_| ()).map_err(Into::into)
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

/// Copies the contents of `src` into the existing directory `dst`, recursing into
/// subdirectories that exist on both sides and applying `policy` to files that
/// collide. Entries present only at the destination are left alone.
fn merge_dir(
    src: &Path,
    dst: &Path,
    policy: ConflictPolicy,
    control: &TransferControl<'_>,
    report: &mut TransferReport,
    seen: &mut Vec<PathBuf>,
) -> Result<(), FsError> {
    control.check()?;

    // Same cycle guard as the plain recursive copy: dereferenced symlinks could
    // otherwise walk forever.
    let real = crate::fs::paths::resolve(src);
    if seen.contains(&real) {
        return Ok(());
    }
    seen.push(real);

    for entry in fs::read_dir(src)? {
        control.check()?;
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());

        let outcome = if from.is_dir() {
            if to.is_dir() {
                // Both sides have this directory: keep descending.
                merge_dir(&from, &to, policy, control, report, seen)
            } else if to.exists() {
                // A file is sitting where a directory needs to go; that is a real
                // conflict for the policy to decide.
                copy_conflicting(&from, &to, policy, control)
            } else {
                fs::create_dir(&to)
                    .map_err(FsError::from)
                    .and_then(|_| copy_into_new_dir(&from, &to, control, seen))
            }
        } else if to.exists() {
            match copy_conflicting(&from, &to, policy, control) {
                Ok(()) => Ok(()),
                Err(FsError::Cancelled(m)) => Err(FsError::Cancelled(m)),
                Err(e) if policy == ConflictPolicy::Skip => {
                    let _ = e;
                    report.skipped.push(from.display().to_string());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        } else {
            fs::copy(&from, &to).map(|_| ()).map_err(Into::into)
        };

        match outcome {
            Ok(()) => {}
            // Cancellation stops the whole walk rather than being recorded
            // against one file.
            Err(e @ FsError::Cancelled(_)) => return Err(e),
            Err(e) => report.failed.push(FailedItem::new(&from, &e)),
        }
    }

    seen.pop();
    Ok(())
}

/// Copies `from` over an existing `to` according to `policy`, staging replacements
/// so a failure cannot destroy what is already there.
fn copy_conflicting(
    from: &Path,
    to: &Path,
    policy: ConflictPolicy,
    control: &TransferControl<'_>,
) -> Result<(), FsError> {
    match resolve_destination(to, policy)? {
        Resolution::Skip => Err(FsError::AlreadyExists(format!(
            "skipped, already exists: {}",
            to.display()
        ))),
        Resolution::Direct(p) => {
            if from.is_dir() {
                copy_dir_recursive(from, &p, &mut Vec::new(), control)
            } else {
                fs::copy(from, &p).map(|_| ()).map_err(Into::into)
            }
        }
        Resolution::Replace { staging, target } => {
            let written = if from.is_dir() {
                copy_dir_recursive(from, &staging, &mut Vec::new(), control)
            } else {
                fs::copy(from, &staging).map(|_| ()).map_err(Into::into)
            };
            match written {
                Ok(()) => commit_replace(&staging, &target),
                Err(e) => {
                    discard_staging(&staging);
                    Err(e)
                }
            }
        }
    }
}

/// Fills a directory that was just created, so nothing inside can collide.
fn copy_into_new_dir(
    src: &Path,
    dst: &Path,
    control: &TransferControl<'_>,
    seen: &mut Vec<PathBuf>,
) -> Result<(), FsError> {
    for entry in fs::read_dir(src)? {
        control.check()?;
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            let real = crate::fs::paths::resolve(&from);
            if seen.contains(&real) {
                continue;
            }
            seen.push(real);
            fs::create_dir(&to)?;
            copy_into_new_dir(&from, &to, control, seen)?;
            seen.pop();
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
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

/// Test-only: copy everything, failing on the first problem with its error kind
/// intact. Routes through the production `copy_one`, so tests exercise the same
/// code the app does rather than a parallel implementation.
#[cfg(test)]
fn copy_strict(sources: &[PathBuf], destination_dir: &Path) -> Result<(), FsError> {
    if !destination_dir.is_dir() {
        return Err(FsError::NotADirectory(format!(
            "destination is not a directory: {}",
            destination_dir.display()
        )));
    }
    let never = std::sync::atomic::AtomicBool::new(false);
    let noop = |_: usize, _: usize, _: &str| {};
    let control = TransferControl {
        cancel: &never,
        on_progress: &noop,
    };
    let mut report = TransferReport::default();
    for source in sources {
        copy_one(
            source,
            destination_dir,
            ConflictPolicy::Fail,
            &control,
            &mut report,
        )?;
    }
    if let Some(f) = report.failed.first() {
        return Err(FsError::Io(f.message.clone()));
    }
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

        let result = copy_strict(std::slice::from_ref(&src), &dest_dir);
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

        let result = copy_strict(std::slice::from_ref(&src_dir), &dest_dir);
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

        let result = copy_strict(&[src], &dest_dir);
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_copy_nonexistent_source() {
        let temp_dir = TempDir::new().unwrap();
        let nonexistent = temp_dir.path().join("nonexistent.txt");

        let result = copy_strict(&[nonexistent], temp_dir.path());
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

        let err = copy_strict(std::slice::from_ref(&foo), &inner).unwrap_err();
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
        let err = copy_strict(std::slice::from_ref(&foo), &foo).unwrap_err();
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

        copy_strict(std::slice::from_ref(&foo), &dest).unwrap();
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
        let _ = copy_strict(std::slice::from_ref(&src), &dest);

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
        TransferControl {
            cancel,
            on_progress: noop,
        }
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
        let report = copy_paths_controlled(
            std::slice::from_ref(&src),
            &dest,
            ConflictPolicy::Fail,
            &control(&cancel, &noop),
        )
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
        let report = copy_paths_controlled(
            &srcs,
            &dest,
            ConflictPolicy::Fail,
            &control(&cancel, &record),
        )
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
        let report = copy_paths_controlled(
            std::slice::from_ref(&src),
            &dest,
            ConflictPolicy::Fail,
            &control(&cancel, &noop),
        )
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

        let report = copy_paths_with(
            std::slice::from_ref(&f),
            tmp.path(),
            ConflictPolicy::Overwrite,
        )
        .unwrap();

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

        let _ = copy_paths_with(
            std::slice::from_ref(&d),
            tmp.path(),
            ConflictPolicy::Overwrite,
        );

        assert!(d.exists(), "source directory was destroyed");
        assert_eq!(
            fs::read_to_string(d.join("code.rs")).unwrap(),
            "fn main(){}"
        );
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

            let report = copy_paths_with(std::slice::from_ref(&f), tmp.path(), policy).unwrap();
            assert!(f.exists(), "{policy:?} destroyed the source");
            assert_eq!(fs::read_to_string(&f).unwrap(), "keep");
            assert!(
                report.completed.is_empty(),
                "{policy:?} should not have copied"
            );
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
        TransferControl {
            cancel: c,
            on_progress: f,
        }
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
        let report = copy_paths_controlled(
            &[src],
            &dest,
            ConflictPolicy::Overwrite,
            &ctl(&cancel, &noop),
        )
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

        let report = copy_paths_with(&[missing], &dest, ConflictPolicy::Overwrite).unwrap();

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
    fn a_directory_landing_on_an_existing_one_merges_and_cleans_up() {
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
        assert!(
            existing.join("new.txt").exists(),
            "source file should arrive"
        );
        assert!(
            existing.join("old.txt").exists(),
            "destination file should survive"
        );
        let debris: Vec<_> = fs::read_dir(&existing)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("dcmd~"))
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

#[cfg(test)]
mod partial_conflict_tests {
    use super::*;
    use crate::operations::transfer::find_conflicts;
    use tempfile::TempDir;

    /// left/  a.txt, dup.txt, tree/{x.txt, sub/y.txt}, dup_dir/{new.txt}
    /// right/ dup.txt, dup_dir/{old.txt}          <- two of four collide
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
        fs::write(tree.join("x.txt"), "X").unwrap();
        fs::write(tree.join("sub/y.txt"), "Y").unwrap();

        let dup_dir = left.join("dup_dir");
        fs::create_dir(&dup_dir).unwrap();
        fs::write(dup_dir.join("new.txt"), "NEW").unwrap();

        // Only these two exist on the right.
        fs::write(right.join("dup.txt"), "RIGHT-dup").unwrap();
        let rdup = right.join("dup_dir");
        fs::create_dir(&rdup).unwrap();
        fs::write(rdup.join("old.txt"), "OLD").unwrap();

        let sources = vec![
            left.join("a.txt"),
            left.join("dup.txt"),
            left.join("tree"),
            left.join("dup_dir"),
        ];
        (tmp, left, right, sources)
    }

    // A shared folder name is not itself a conflict, since folders merge. Only
    // files that clash inside it are.
    #[test]
    fn conflicts_descend_into_shared_folders() {
        let (_t, _l, right, sources) = fixture();
        let mut c = find_conflicts(&sources, &right);
        c.sort();
        // dup_dir exists on both sides but holds different files, so nothing in
        // it actually collides.
        assert_eq!(c, vec!["dup.txt"]);
    }

    #[test]
    fn a_file_clashing_inside_a_shared_folder_is_reported_with_its_path() {
        let (_t, left, right, sources) = fixture();
        fs::write(left.join("dup_dir/same.txt"), "L").unwrap();
        fs::write(right.join("dup_dir/same.txt"), "R").unwrap();

        let mut c = find_conflicts(&sources, &right);
        c.sort();
        assert_eq!(c, vec!["dup.txt", "dup_dir/same.txt"]);
    }

    #[test]
    fn skip_copies_the_rest_and_leaves_colliding_files_untouched() {
        let (_t, _l, right, sources) = fixture();
        let report = copy_paths_with(&sources, &right, ConflictPolicy::Skip).unwrap();
        assert!(report.failed.is_empty(), "{report:?}");

        assert_eq!(fs::read_to_string(right.join("a.txt")).unwrap(), "A");
        assert_eq!(
            fs::read_to_string(right.join("tree/sub/y.txt")).unwrap(),
            "Y"
        );
        // The clashing file keeps the destination's version.
        assert_eq!(
            fs::read_to_string(right.join("dup.txt")).unwrap(),
            "RIGHT-dup"
        );
        // The shared folder merged: both sides' files are present.
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/old.txt")).unwrap(),
            "OLD"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/new.txt")).unwrap(),
            "NEW"
        );
    }

    #[test]
    fn keep_both_suffixes_only_the_clashing_file() {
        let (_t, _l, right, sources) = fixture();
        let report = copy_paths_with(&sources, &right, ConflictPolicy::KeepBoth).unwrap();
        assert_eq!(report.completed.len(), 4, "{report:?}");

        assert!(right.join("a.txt").exists());
        assert!(right.join("tree/sub/y.txt").exists());
        assert_eq!(
            fs::read_to_string(right.join("dup.txt")).unwrap(),
            "RIGHT-dup"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup copy.txt")).unwrap(),
            "LEFT-dup"
        );
        // The folder merged rather than becoming "dup_dir copy".
        assert!(
            !right.join("dup_dir copy").exists(),
            "folder should merge, not duplicate"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/old.txt")).unwrap(),
            "OLD"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/new.txt")).unwrap(),
            "NEW"
        );
    }

    #[test]
    fn overwrite_replaces_only_the_collisions() {
        let (_t, _l, right, sources) = fixture();
        let report = copy_paths_with(&sources, &right, ConflictPolicy::Overwrite).unwrap();

        assert_eq!(report.completed.len(), 4, "{report:?}");
        assert_eq!(fs::read_to_string(right.join("a.txt")).unwrap(), "A");
        assert_eq!(
            fs::read_to_string(right.join("dup.txt")).unwrap(),
            "LEFT-dup"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/new.txt")).unwrap(),
            "NEW"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/old.txt")).unwrap(),
            "OLD"
        );
    }

    /// The point of merging: replacing files inside a shared folder must not take
    /// the destination's other files with them.
    #[test]
    fn overwriting_inside_a_shared_folder_keeps_destination_only_files() {
        let (_t, left, right, sources) = fixture();
        fs::write(left.join("dup_dir/shared.txt"), "L-shared").unwrap();
        fs::write(right.join("dup_dir/shared.txt"), "R-shared").unwrap();

        copy_paths_with(&sources, &right, ConflictPolicy::Overwrite).unwrap();

        // The clashing file was replaced...
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/shared.txt")).unwrap(),
            "L-shared"
        );
        // ...and the file only the destination had survived.
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/old.txt")).unwrap(),
            "OLD"
        );
    }

    #[test]
    fn fail_refuses_the_clashing_file_but_still_copies_the_others() {
        let (_t, _l, right, sources) = fixture();
        let report = copy_paths_with(&sources, &right, ConflictPolicy::Fail).unwrap();

        assert_eq!(report.failed.len(), 1, "{report:?}");
        assert_eq!(
            fs::read_to_string(right.join("dup.txt")).unwrap(),
            "RIGHT-dup"
        );
        assert!(right.join("tree/sub/y.txt").exists());
        // Merging still delivered the non-clashing file into the shared folder.
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/new.txt")).unwrap(),
            "NEW"
        );
        assert_eq!(
            fs::read_to_string(right.join("dup_dir/old.txt")).unwrap(),
            "OLD"
        );
    }

    #[test]
    fn deep_structure_is_copied_faithfully() {
        let (_t, left, right, _s) = fixture();
        let deep = left.join("tree/sub/deeper/deepest");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("bottom.txt"), "BOTTOM").unwrap();

        copy_paths_with(&[left.join("tree")], &right, ConflictPolicy::Fail).unwrap();
        assert_eq!(
            fs::read_to_string(right.join("tree/sub/deeper/deepest/bottom.txt")).unwrap(),
            "BOTTOM"
        );
    }
}
