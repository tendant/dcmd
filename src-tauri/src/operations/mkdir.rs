use crate::error::FsError;
use crate::fs::{validate_name, FileEntry};
use std::path::Path;

pub fn make_dir(parent_dir: &Path, name: &str) -> Result<FileEntry, FsError> {
    validate_name(name)?;

    let new_dir_path = parent_dir.join(name);

    if new_dir_path.exists() {
        return Err(FsError::AlreadyExists(format!(
            "directory already exists: {}",
            new_dir_path.display()
        )));
    }

    std::fs::create_dir(&new_dir_path)?;

    let metadata = std::fs::metadata(&new_dir_path)?;
    crate::fs::entry::build_entry(&new_dir_path, name.to_string(), &metadata, false)
        .map_err(|e| FsError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_make_dir_success() {
        let temp_dir = TempDir::new().unwrap();
        let result = make_dir(temp_dir.path(), "new_folder");
        assert!(result.is_ok());
        assert!(temp_dir.path().join("new_folder").is_dir());
    }

    #[test]
    fn test_make_dir_already_exists() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir(temp_dir.path().join("existing")).unwrap();
        let result = make_dir(temp_dir.path(), "existing");
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_make_dir_invalid_name() {
        let temp_dir = TempDir::new().unwrap();
        let result = make_dir(temp_dir.path(), "");
        assert!(matches!(result, Err(FsError::InvalidName(_))));

        let result = make_dir(temp_dir.path(), "foo/bar");
        assert!(matches!(result, Err(FsError::InvalidName(_))));
    }
}
