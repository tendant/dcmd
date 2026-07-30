use crate::error::FsError;
use crate::operations::transfer::{
    check_not_same_directory, resolve_destination, ConflictPolicy, FailedItem, TransferControl,
    TransferReport,
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

        match move_one(source, destination_dir, policy) {
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
fn move_one(
    source: &Path,
    destination_dir: &Path,
    policy: ConflictPolicy,
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

    let dest = match resolve_destination(&destination_dir.join(file_name), policy)? {
        Some(d) => d,
        None => return Ok(None),
    };

    if fs::rename(source, &dest).is_err() {
        copy_then_delete(source, &dest)?;
    }
    Ok(Some(()))
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
