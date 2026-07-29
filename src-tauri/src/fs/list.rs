use crate::error::FsError;
use crate::fs::entry::{build_entry, FileEntry};
use crate::fs::paths::is_hidden;
use std::path::Path;

pub fn read_dir_entries(dir_path: &Path) -> Result<Vec<FileEntry>, FsError> {
    if !dir_path.exists() {
        return Err(FsError::NotFound(format!("path does not exist: {}", dir_path.display())));
    }

    if !dir_path.is_dir() {
        return Err(FsError::NotADirectory(format!("path is not a directory: {}", dir_path.display())));
    }

    let mut entries = Vec::new();

    for entry in std::fs::read_dir(dir_path)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        let hidden = is_hidden(&name_str);
        let metadata = entry.metadata()?;

        let file_entry = build_entry(&path, name_str, &metadata, hidden)?;
        entries.push(file_entry);
    }

    // Sort: directories first, then case-insensitive alphabetical
    entries.sort_by(|a, b| {
        match (a.kind == crate::fs::entry::EntryKind::Directory, b.kind == crate::fs::entry::EntryKind::Directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_read_dir_entries_empty() {
        let temp_dir = TempDir::new().unwrap();
        let entries = read_dir_entries(temp_dir.path()).unwrap();
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn test_read_dir_entries_files_and_dirs() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("file1.txt"), "content1").unwrap();
        fs::write(temp_dir.path().join("file2.txt"), "content2").unwrap();
        fs::create_dir(temp_dir.path().join("subdir")).unwrap();

        let entries = read_dir_entries(temp_dir.path()).unwrap();
        assert_eq!(entries.len(), 3);

        // Directories should come first
        assert_eq!(entries[0].kind, crate::fs::entry::EntryKind::Directory);
        assert_eq!(entries[0].name, "subdir");
        assert_eq!(entries[1].kind, crate::fs::entry::EntryKind::File);
        assert_eq!(entries[2].kind, crate::fs::entry::EntryKind::File);
    }

    #[test]
    fn test_read_dir_entries_nonexistent() {
        let result = read_dir_entries(Path::new("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[test]
    fn test_read_dir_entries_not_a_directory() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "content").unwrap();

        let result = read_dir_entries(&file_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_read_dir_entries_sort_order() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("z_file.txt"), "").unwrap();
        fs::write(temp_dir.path().join("a_file.txt"), "").unwrap();
        fs::create_dir(temp_dir.path().join("b_dir")).unwrap();
        fs::create_dir(temp_dir.path().join("a_dir")).unwrap();

        let entries = read_dir_entries(temp_dir.path()).unwrap();

        // All directories first, sorted alphabetically
        assert_eq!(entries[0].name, "a_dir");
        assert_eq!(entries[1].name, "b_dir");
        // Then files, sorted alphabetically
        assert_eq!(entries[2].name, "a_file.txt");
        assert_eq!(entries[3].name, "z_file.txt");
    }
}
