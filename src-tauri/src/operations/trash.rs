use crate::error::FsError;
use crate::operations::transfer::{FailedItem, TransferReport};
use std::path::Path;

/// Test-only: fail on the first problem. Production uses the reporting form so a
/// partial failure can name what survived.
#[cfg(test)]
pub fn trash_paths(paths: &[impl AsRef<Path>]) -> Result<(), FsError> {
    let report = trash_paths_reported(paths);
    match report.failed.into_iter().next() {
        Some(f) => Err(FsError::Trash(f.message)),
        None => Ok(()),
    }
}

/// Moves each path to the Trash, reporting which ones could not be taken.
///
/// `trash::delete_all` is all-or-nothing: one unwritable item fails the batch
/// with a single message, leaving the user unable to tell what survived. The
/// batch call is still tried first because it is one OS call and groups the
/// items together for "Put Back"; only when it fails does this fall back to
/// per-path deletion to find out exactly which ones are the problem.
pub fn trash_paths_reported(paths: &[impl AsRef<Path>]) -> TransferReport {
    let mut report = TransferReport::default();
    if paths.is_empty() {
        return report;
    }

    if trash::delete_all(paths).is_ok() {
        report.completed = paths
            .iter()
            .map(|p| p.as_ref().display().to_string())
            .collect();
        return report;
    }

    for path in paths {
        let path = path.as_ref();
        match trash::delete(path) {
            Ok(()) => report.completed.push(path.display().to_string()),
            Err(e) => report
                .failed
                .push(FailedItem::new(path, &FsError::Trash(describe(path, &e)))),
        }
    }
    report
}

/// The crate's own message rarely says which item it was about.
fn describe(path: &Path, e: &trash::Error) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());
    if !path.exists() {
        return format!("{name} no longer exists");
    }
    format!("{name}: {e}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_trash_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "content").unwrap();

        let result = trash_paths(&[&file_path]);
        assert!(result.is_ok());
        assert!(!file_path.exists());
    }

    #[test]
    fn test_trash_multiple_files() {
        let temp_dir = TempDir::new().unwrap();
        let file1 = temp_dir.path().join("file1.txt");
        let file2 = temp_dir.path().join("file2.txt");
        fs::write(&file1, "1").unwrap();
        fs::write(&file2, "2").unwrap();

        let result = trash_paths(&[&file1, &file2]);
        assert!(result.is_ok());
        assert!(!file1.exists());
        assert!(!file2.exists());
    }

    #[test]
    fn test_trash_directory() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path().join("subdir");
        fs::create_dir(&dir_path).unwrap();
        fs::write(dir_path.join("file.txt"), "content").unwrap();

        let result = trash_paths(&[&dir_path]);
        assert!(result.is_ok());
        assert!(!dir_path.exists());
    }
}
