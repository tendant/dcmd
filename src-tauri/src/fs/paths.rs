use crate::error::FsError;
use std::path::{Path, PathBuf};

/// Resolves a path as far as it exists, so containment can be compared even when
/// the destination has not been created yet. Falls back to the path itself.
pub fn resolve(path: &Path) -> PathBuf {
    if let Ok(p) = path.canonicalize() {
        return p;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => match parent.canonicalize() {
            Ok(p) => p.join(name),
            Err(_) => path.to_path_buf(),
        },
        _ => path.to_path_buf(),
    }
}

/// True when `inner` is `outer` or sits beneath it.
///
/// Copying a directory into its own descendant is unbounded: the new directory
/// appears inside the tree still being walked, so the walk keeps finding more to
/// copy. Callers must reject that before starting rather than discovering it when
/// the path grows too long.
pub fn is_same_or_inside(inner: &Path, outer: &Path) -> bool {
    let (inner, outer) = (resolve(inner), resolve(outer));
    inner == outer || inner.starts_with(&outer)
}

/// Windows refuses these as filenames regardless of extension. Checked on every
/// platform so a name created on macOS does not become unusable once the folder is
/// synced or shared to Windows.
const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn validate_name(name: &str) -> Result<(), FsError> {
    if name.is_empty() {
        return Err(FsError::InvalidName("name cannot be empty".to_string()));
    }

    // "." and ".." resolve to the directory itself or its parent, which both
    // already exist. Left unchecked they surface as a confusing "already exists".
    if name == "." || name == ".." {
        return Err(FsError::InvalidName(format!(
            "\"{name}\" is not a usable name"
        )));
    }

    let stem = name.split('.').next().unwrap_or(name);
    if WINDOWS_RESERVED
        .iter()
        .any(|r| stem.eq_ignore_ascii_case(r))
    {
        return Err(FsError::InvalidName(format!(
            "\"{name}\" is a reserved device name"
        )));
    }

    if name.contains('/') || name.contains('\0') {
        return Err(FsError::InvalidName(format!(
            "name cannot contain path separators or null: {}",
            name
        )));
    }

    if cfg!(windows) && (name.contains('\\') || name.ends_with('.')) {
        return Err(FsError::InvalidName(format!(
            "invalid name for this platform: {}",
            name
        )));
    }

    Ok(())
}

pub fn is_hidden(name: &str) -> bool {
    #[cfg(unix)]
    {
        name.starts_with('.')
    }
    #[cfg(windows)]
    {
        use std::fs;
        use std::os::windows::fs::MetadataExt;
        // Windows hidden files are handled via the FILE_ATTRIBUTE_HIDDEN flag
        // For now, just check if it starts with a dot (Unix convention)
        name.starts_with('.')
    }
    #[cfg(not(any(unix, windows)))]
    {
        name.starts_with('.')
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_name_valid() {
        assert!(validate_name("file.txt").is_ok());
        assert!(validate_name("my folder").is_ok());
        assert!(validate_name("file-123_test").is_ok());
    }

    #[test]
    fn test_validate_name_empty() {
        assert!(validate_name("").is_err());
    }

    #[test]
    fn test_validate_name_separators() {
        assert!(validate_name("foo/bar").is_err());
        assert!(validate_name("foo\0bar").is_err());
    }

    #[test]
    fn test_is_hidden() {
        assert!(is_hidden(".hidden"));
        assert!(is_hidden(".config"));
        assert!(!is_hidden("visible"));
        assert!(!is_hidden("file.txt"));
    }
}

#[cfg(test)]
mod hygiene_tests {
    use super::*;

    #[test]
    fn rejects_dot_and_dotdot_as_names() {
        // These resolve to existing directories, so without this they surfaced as
        // a confusing "already exists" rather than an invalid name.
        for n in [".", ".."] {
            assert!(
                matches!(validate_name(n), Err(FsError::InvalidName(_))),
                "{n} should be rejected"
            );
        }
    }

    #[test]
    fn allows_dotfiles_and_names_containing_dots() {
        for n in [".env", "..hidden", "a.b.c", "...", ".gitignore"] {
            assert!(validate_name(n).is_ok(), "{n} should be allowed");
        }
    }

    #[test]
    fn rejects_windows_device_names_on_every_platform() {
        for n in ["CON", "con", "NUL", "com1", "LPT9", "con.txt"] {
            assert!(
                matches!(validate_name(n), Err(FsError::InvalidName(_))),
                "{n} should be rejected"
            );
        }
    }

    #[test]
    fn does_not_reject_names_merely_starting_with_a_device_name() {
        for n in ["console", "contacts", "nulls", "com10"] {
            assert!(validate_name(n).is_ok(), "{n} should be allowed");
        }
    }
}
