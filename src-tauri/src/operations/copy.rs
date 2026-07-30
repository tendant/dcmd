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
            check_not_into_itself(source, destination_dir)?;
            copy_dir_recursive(source, &dest, &mut Vec::new())?;
        } else {
            fs::copy(source, &dest)?;
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

fn copy_dir_recursive(src: &Path, dst: &Path, seen: &mut Vec<PathBuf>) -> Result<(), FsError> {
    // Symlinked directories are dereferenced, so a link pointing at an ancestor
    // would recurse forever. Track the real directories already entered.
    let real = crate::fs::paths::resolve(src);
    if seen.contains(&real) {
        return Ok(());
    }
    seen.push(real);

    fs::create_dir(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dest, seen)?;
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
