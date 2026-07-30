use crate::error::FsError;
use std::io;
use std::path::Path;

/// Renames `from` to `to`, refusing rather than replacing when `to` already exists.
///
/// `std::fs::rename` replaces the destination on every platform — POSIX `rename(2)`
/// by definition, and Windows because std passes `MOVEFILE_REPLACE_EXISTING`. So
/// guarding it with a prior `exists()` check leaves a window in which another
/// process can create that name and have it silently destroyed, with no error and
/// no trace.
///
/// Where the OS offers an atomic no-replace rename we use it. Where it does not,
/// or where the filesystem refuses the flag, we fall back to the check-then-rename
/// that was there before: still racy, but no worse than the previous behaviour.
pub fn rename_no_replace(from: &Path, to: &Path) -> Result<(), FsError> {
    match try_atomic(from, to) {
        Some(Ok(())) => Ok(()),
        Some(Err(e)) => Err(classify(e, to)),
        // The platform or filesystem cannot promise it; do the best we can.
        None => fallback(from, to),
    }
}

/// EEXIST and ENOTEMPTY both mean "something is already there".
fn classify(e: io::Error, to: &Path) -> FsError {
    let already = matches!(e.kind(), io::ErrorKind::AlreadyExists)
        || matches!(e.raw_os_error(), Some(c) if is_exists_errno(c));
    if already {
        FsError::AlreadyExists(format!("target already exists: {}", to.display()))
    } else {
        FsError::from(e)
    }
}

#[cfg(unix)]
fn is_exists_errno(code: i32) -> bool {
    code == libc::EEXIST || code == libc::ENOTEMPTY
}

#[cfg(windows)]
fn is_exists_errno(code: i32) -> bool {
    // ERROR_FILE_EXISTS / ERROR_ALREADY_EXISTS
    code == 80 || code == 183
}

#[cfg(not(any(unix, windows)))]
fn is_exists_errno(_code: i32) -> bool {
    false
}

/// The pre-existing behaviour: check, then rename. Racy by construction, since
/// anything created in between is silently replaced.
fn fallback(from: &Path, to: &Path) -> Result<(), FsError> {
    if to.exists() {
        return Err(FsError::AlreadyExists(format!(
            "target already exists: {}",
            to.display()
        )));
    }
    std::fs::rename(from, to)?;
    Ok(())
}

/// `None` means "this platform/filesystem cannot do it atomically, fall back".
#[cfg(target_vendor = "apple")]
fn try_atomic(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let f = CString::new(from.as_os_str().as_bytes()).ok()?;
    let t = CString::new(to.as_os_str().as_bytes()).ok()?;

    // RENAME_EXCL: fail if the destination exists, atomically.
    let rc = unsafe { libc::renamex_np(f.as_ptr(), t.as_ptr(), libc::RENAME_EXCL) };
    if rc == 0 {
        return Some(Ok(()));
    }
    let err = io::Error::last_os_error();
    // Not every filesystem implements it (notably some network mounts).
    if matches!(err.raw_os_error(), Some(libc::ENOTSUP) | Some(libc::EINVAL)) {
        return None;
    }
    Some(Err(err))
}

#[cfg(all(target_os = "linux", any(target_env = "gnu", target_env = "musl")))]
fn try_atomic(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let f = CString::new(from.as_os_str().as_bytes()).ok()?;
    let t = CString::new(to.as_os_str().as_bytes()).ok()?;

    let rc = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            f.as_ptr(),
            libc::AT_FDCWD,
            t.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if rc == 0 {
        return Some(Ok(()));
    }
    let err = io::Error::last_os_error();
    // Pre-3.15 kernels lack the syscall; several filesystems reject the flag.
    if matches!(
        err.raw_os_error(),
        Some(libc::ENOSYS) | Some(libc::EINVAL) | Some(libc::EOPNOTSUPP)
    ) {
        return None;
    }
    Some(Err(err))
}

#[cfg(windows)]
fn try_atomic(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    fn wide(p: &Path) -> Vec<u16> {
        let mut v: Vec<u16> = p.as_os_str().encode_wide().collect();
        v.push(0);
        v
    }
    let (f, t) = (wide(from), wide(to));

    // Deliberately no MOVEFILE_REPLACE_EXISTING: without it MoveFileExW fails when
    // the destination exists, which is exactly the guarantee we want. std passes
    // that flag, which is why std::fs::rename clobbers.
    let ok = unsafe { MoveFileExW(f.as_ptr(), t.as_ptr(), 0) };
    if ok != 0 {
        return Some(Ok(()));
    }
    Some(Err(io::Error::last_os_error()))
}

#[cfg(not(any(
    target_vendor = "apple",
    all(target_os = "linux", any(target_env = "gnu", target_env = "musl")),
    windows
)))]
fn try_atomic(_from: &Path, _to: &Path) -> Option<io::Result<()>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn renames_when_the_target_is_free() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("a.txt");
        let to = tmp.path().join("b.txt");
        fs::write(&from, "content").unwrap();

        rename_no_replace(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(&to).unwrap(), "content");
    }

    /// The point of the whole module: std::fs::rename would silently destroy the
    /// destination here.
    #[test]
    fn refuses_an_occupied_target_without_destroying_it() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("a.txt");
        let to = tmp.path().join("b.txt");
        fs::write(&from, "incoming").unwrap();
        fs::write(&to, "PRECIOUS").unwrap();

        let err = rename_no_replace(&from, &to).unwrap_err();
        assert!(matches!(err, FsError::AlreadyExists(_)), "got {err:?}");
        assert_eq!(fs::read_to_string(&to).unwrap(), "PRECIOUS");
        assert!(from.exists(), "source should be left alone");
    }

    #[test]
    fn refuses_an_occupied_target_that_is_a_directory() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("a.txt");
        fs::write(&from, "incoming").unwrap();
        let to = tmp.path().join("d");
        fs::create_dir(&to).unwrap();
        fs::write(to.join("keep.txt"), "keep").unwrap();

        let err = rename_no_replace(&from, &to).unwrap_err();
        assert!(matches!(err, FsError::AlreadyExists(_)), "got {err:?}");
        assert!(to.join("keep.txt").exists());
    }

    #[test]
    fn renames_directories_too() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("d1");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("f.txt"), "x").unwrap();
        let to = tmp.path().join("d2");

        rename_no_replace(&from, &to).unwrap();
        assert!(to.join("f.txt").exists());
        assert!(!from.exists());
    }

    #[test]
    fn a_missing_source_is_not_reported_as_a_collision() {
        let tmp = TempDir::new().unwrap();
        let err = rename_no_replace(&tmp.path().join("nope"), &tmp.path().join("x")).unwrap_err();
        assert!(!matches!(err, FsError::AlreadyExists(_)), "got {err:?}");
    }
}
