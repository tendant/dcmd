use crate::error::FsError;
use crate::fs::{validate_name, FileEntry};
use std::path::Path;

pub fn rename_entry(path: &Path, new_name: &str) -> Result<FileEntry, FsError> {
    // Trimmed for the same reason as mkdir: trailing spaces are accidental and
    // produce names that are hard to tell apart.
    let new_name = new_name.trim();
    validate_name(new_name)?;

    if !path.exists() {
        return Err(FsError::NotFound(format!(
            "path does not exist: {}",
            path.display()
        )));
    }

    let parent = path
        .parent()
        .ok_or_else(|| FsError::Io("cannot get parent directory".to_string()))?;

    let new_path = parent.join(new_name);

    // Atomic where the OS allows it: a plain rename would silently replace
    // anything created at that name between a check and the call.
    crate::fs::rename_no_replace(path, &new_path)?;

    let metadata = std::fs::metadata(&new_path)?;
    crate::fs::entry::build_entry(
        &new_path,
        new_name.to_string(),
        &metadata,
        crate::fs::paths::is_hidden(new_name),
    )
    .map_err(|e| FsError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_rename_file_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("old.txt");
        fs::write(&file_path, "content").unwrap();

        let result = rename_entry(&file_path, "new.txt");
        assert!(result.is_ok());
        assert!(!file_path.exists());
        assert!(temp_dir.path().join("new.txt").exists());
    }

    #[test]
    fn test_rename_directory_success() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path().join("old_dir");
        fs::create_dir(&dir_path).unwrap();

        let result = rename_entry(&dir_path, "new_dir");
        assert!(result.is_ok());
        assert!(!dir_path.exists());
        assert!(temp_dir.path().join("new_dir").is_dir());
    }

    #[test]
    fn test_rename_collision() {
        let temp_dir = TempDir::new().unwrap();
        let file1 = temp_dir.path().join("file1.txt");
        let file2 = temp_dir.path().join("file2.txt");
        fs::write(&file1, "1").unwrap();
        fs::write(&file2, "2").unwrap();

        let result = rename_entry(&file1, "file2.txt");
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_rename_invalid_name() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "content").unwrap();

        let result = rename_entry(&file_path, "");
        assert!(matches!(result, Err(FsError::InvalidName(_))));
    }
}
