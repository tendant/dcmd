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
    /// Number of direct children, for directories only. Cheap to compute (one
    /// non-recursive read_dir); the recursive byte size is opt-in via Space.
    pub item_count: Option<u64>,
    pub modified_at: Option<i64>,
    pub hidden: bool,
}

pub fn build_entry(
    path: &std::path::Path,
    name: String,
    metadata: &std::fs::Metadata,
    hidden: bool,
) -> std::io::Result<FileEntry> {
    let kind = if metadata.is_dir() {
        EntryKind::Directory
    } else if metadata.is_symlink() {
        EntryKind::Symlink
    } else {
        EntryKind::File
    };

    // Directory sizes are deliberately NOT computed here. Doing so recursively
    // walks the whole subtree for every entry, which makes listing a home
    // directory walk millions of files before returning anything. The frontend
    // requests a directory's size on demand via the `directory_size` command.
    let size = if metadata.is_file() {
        Some(metadata.len())
    } else {
        None
    };

    // One shallow read_dir, not a recursive walk. Unreadable directories (e.g.
    // permission denied) simply report no count rather than failing the listing.
    let item_count = if metadata.is_dir() {
        std::fs::read_dir(path).map(|rd| rd.count() as u64).ok()
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
        item_count,
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
        assert_eq!(
            serde_json::to_string(&EntryKind::Directory).unwrap(),
            "\"directory\""
        );
        assert_eq!(
            serde_json::to_string(&EntryKind::Symlink).unwrap(),
            "\"symlink\""
        );
    }

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            name: "test.txt".to_string(),
            path: "/tmp/test.txt".to_string(),
            kind: EntryKind::File,
            size: Some(1024),
            item_count: None,
            modified_at: Some(1000000),
            hidden: false,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"modifiedAt\""));
        assert!(json.contains("\"test.txt\""));
    }
}
