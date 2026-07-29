use crate::error::FsError;
use std::path::Path;

pub fn trash_paths(paths: &[impl AsRef<Path>]) -> Result<(), FsError> {
    if paths.is_empty() {
        return Ok(());
    }

    trash::delete_all(paths).map_err(|e| FsError::Trash(e.to_string()))
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
