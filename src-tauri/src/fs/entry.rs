use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified_at: Option<i64>,
    pub hidden: bool,
}

pub fn build_entry(path: &std::path::Path, name: String, metadata: &std::fs::Metadata, hidden: bool) -> std::io::Result<FileEntry> {
    let kind = if metadata.is_dir() {
        EntryKind::Directory
    } else if metadata.is_symlink() {
        EntryKind::Symlink
    } else {
        EntryKind::File
    };

    let size = if metadata.is_file() {
        Some(metadata.len())
    } else if metadata.is_dir() {
        // For directories, calculate total size recursively
        crate::fs::calculate_dir_size(path).ok()
    } else {
        None
    };

    let modified_at = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64);

    Ok(FileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        kind,
        size,
        modified_at,
        hidden,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entry_kind_serialization() {
        assert_eq!(serde_json::to_string(&EntryKind::File).unwrap(), "\"file\"");
        assert_eq!(serde_json::to_string(&EntryKind::Directory).unwrap(), "\"directory\"");
        assert_eq!(serde_json::to_string(&EntryKind::Symlink).unwrap(), "\"symlink\"");
    }

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            name: "test.txt".to_string(),
            path: "/tmp/test.txt".to_string(),
            kind: EntryKind::File,
            size: Some(1024),
            modified_at: Some(1000000),
            hidden: false,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"modifiedAt\""));
        assert!(json.contains("\"test.txt\""));
    }
}
