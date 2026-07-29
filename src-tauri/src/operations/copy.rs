use crate::error::FsError;
use std::fs;
use std::path::{Path, PathBuf};

pub fn copy_paths(sources: &[PathBuf], destination_dir: &Path) -> Result<(), FsError> {
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

        if source.is_dir() {
            copy_dir_recursive(source, &dest)?;
        } else {
            fs::copy(source, &dest)?;
        }
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
