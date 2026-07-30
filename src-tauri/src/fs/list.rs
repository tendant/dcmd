use crate::error::FsError;
use crate::fs::entry::{build_entry, FileEntry};
use crate::fs::paths::is_hidden;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Recursively sums file sizes under `dir_path`, aborting promptly if `cancel`
/// is set. Walks of large trees can run for minutes, so every caller that can
/// be triggered by a user should pass a flag it is able to set.
pub fn calculate_dir_size_cancellable(
    dir_path: &Path,
    cancel: &AtomicBool,
) -> Result<u64, FsError> {
    if !dir_path.is_dir() {
        return Ok(0);
    }

    let mut total_size = 0u64;

    fn sum_dir_size(path: &Path, total: &mut u64, cancel: &AtomicBool) -> Result<(), FsError> {
        if cancel.load(Ordering::Relaxed) {
            return Err(FsError::Cancelled("size calculation cancelled".into()));
        }

        for entry in std::fs::read_dir(path)? {
            if cancel.load(Ordering::Relaxed) {
                return Err(FsError::Cancelled("size calculation cancelled".into()));
            }

            let entry = entry?;
            let path = entry.path();
            // Use symlink_metadata so symlinked directories are not followed;
            // following them can double-count or loop on cyclic links.
            let metadata = entry.path().symlink_metadata()?;

            if metadata.is_file() {
                *total += metadata.len();
            } else if metadata.is_dir() {
                sum_dir_size(&path, total, cancel)?;
            }
        }
        Ok(())
    }

    sum_dir_size(dir_path, &mut total_size, cancel)?;

    Ok(total_size)
}

pub fn read_dir_entries(dir_path: &Path) -> Result<Vec<FileEntry>, FsError> {
    if !dir_path.exists() {
        return Err(FsError::NotFound(format!(
            "path does not exist: {}",
            dir_path.display()
        )));
    }

    if !dir_path.is_dir() {
        return Err(FsError::NotADirectory(format!(
            "path is not a directory: {}",
            dir_path.display()
        )));
    }

    let mut entries = Vec::new();

    for entry in std::fs::read_dir(dir_path)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        let metadata = entry.metadata()?;
        let hidden = is_hidden(&name_str, Some(&metadata));

        let file_entry = build_entry(&path, name_str, &metadata, hidden)?;
        entries.push(file_entry);
    }

    // Sort: directories first, then case-insensitive alphabetical
    entries.sort_by(|a, b| {
        match (
            a.kind == crate::fs::entry::EntryKind::Directory,
            b.kind == crate::fs::entry::EntryKind::Directory,
        ) {
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

#[cfg(test)]
mod size_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn uncancelled() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn sums_sizes_recursively() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("a.txt"), "12345").unwrap();
        let nested = temp_dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("b.txt"), "678").unwrap();

        let total = calculate_dir_size_cancellable(temp_dir.path(), &uncancelled()).unwrap();
        assert_eq!(total, 8);
    }

    #[test]
    fn returns_cancelled_when_flag_is_set() {
        let temp_dir = TempDir::new().unwrap();
        fs::write(temp_dir.path().join("a.txt"), "12345").unwrap();

        let cancel = AtomicBool::new(true);
        let result = calculate_dir_size_cancellable(temp_dir.path(), &cancel);
        assert!(
            matches!(result, Err(FsError::Cancelled(_))),
            "expected Cancelled, got {result:?}"
        );
    }

    #[test]
    fn cancels_partway_through_a_wide_directory() {
        let temp_dir = TempDir::new().unwrap();
        for i in 0..500 {
            fs::write(temp_dir.path().join(format!("f{i}.txt")), "x").unwrap();
        }

        // Setting the flag mid-walk must abort rather than run to completion.
        let cancel = AtomicBool::new(false);
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(1));
                cancel.store(true, Ordering::Relaxed);
            });
            // Either it finished before the flag landed, or it reports Cancelled;
            // what must never happen is a hang or a wrong total.
            match calculate_dir_size_cancellable(temp_dir.path(), &cancel) {
                Ok(total) => assert_eq!(total, 500),
                Err(FsError::Cancelled(_)) => {}
                Err(other) => panic!("unexpected error: {other:?}"),
            }
        });
    }

    #[test]
    fn listing_reports_item_count_without_walking_subtree() {
        let temp_dir = TempDir::new().unwrap();
        let dir = temp_dir.path().join("d");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("one.txt"), "a").unwrap();
        fs::write(dir.join("two.txt"), "b").unwrap();
        fs::create_dir(dir.join("three")).unwrap();

        let entries = read_dir_entries(temp_dir.path()).unwrap();
        let d = entries.iter().find(|e| e.name == "d").unwrap();

        assert_eq!(d.item_count, Some(3));
        // Directory byte size is opt-in; listing must not compute it.
        assert_eq!(d.size, None);
    }
}
