use crate::fs::entry::{EntryKind, FileEntry};

/// The subset of SFTP metadata a listing needs, so the mapping below can be
/// tested without a server.
#[derive(Debug, Clone, Default)]
pub struct RemoteStat {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub len: Option<u64>,
    /// Seconds since the epoch, as SFTP reports it.
    pub modified_secs: Option<u64>,
}

/// Builds the entry the UI already understands from an SFTP stat.
///
/// Several fields are unavoidably absent over SFTP and are left empty rather
/// than guessed at:
///
/// - `item_count` would need a listing per subdirectory, which is a round trip
///   each and the reason listings feel slow over a network in the first place.
/// - `created_at` is not in the SFTP v3 attribute set at all.
/// - Directory sizes stay unknown, as they are locally, until asked for.
///
/// Hidden is decided by the leading dot only: the Windows attribute has no
/// meaning on the far side of an SSH connection to a POSIX host.
pub fn entry_from_stat(dir_path: &str, stat: &RemoteStat) -> FileEntry {
    let kind = if stat.is_symlink {
        EntryKind::Symlink
    } else if stat.is_dir {
        EntryKind::Directory
    } else {
        EntryKind::File
    };

    FileEntry {
        path: join_remote(dir_path, &stat.name),
        hidden: stat.name.starts_with('.'),
        name: stat.name.clone(),
        kind,
        size: if stat.is_dir { None } else { stat.len },
        item_count: None,
        // SFTP reports whole seconds; the UI works in milliseconds.
        modified_at: stat.modified_secs.map(|s| (s as i64).saturating_mul(1000)),
        created_at: None,
    }
}

/// Joins a remote path. Always `/`: the far side is POSIX, whatever this side is.
pub fn join_remote(dir: &str, name: &str) -> String {
    if dir.is_empty() || dir == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", dir.trim_end_matches('/'), name)
    }
}

/// The directory above a remote path, or None at the root.
pub fn remote_parent(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    match trimmed.rfind('/') {
        Some(0) => Some("/".to_string()),
        Some(i) => Some(trimmed[..i].to_string()),
        None => None,
    }
}

/// Same ordering the local listing uses, so a remote pane does not behave
/// differently from a local one before the frontend sorts it.
pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        let dir = |e: &FileEntry| e.kind != EntryKind::Directory;
        dir(a)
            .cmp(&dir(b))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(name: &str) -> RemoteStat {
        RemoteStat {
            name: name.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn builds_a_file_entry() {
        let e = entry_from_stat(
            "/home/tester",
            &RemoteStat {
                name: "notes.txt".into(),
                len: Some(1234),
                modified_secs: Some(1_700_000_000),
                ..Default::default()
            },
        );
        assert_eq!(e.path, "/home/tester/notes.txt");
        assert_eq!(e.kind, EntryKind::File);
        assert_eq!(e.size, Some(1234));
        assert_eq!(e.modified_at, Some(1_700_000_000_000));
        assert!(!e.hidden);
    }

    #[test]
    fn directories_have_no_size_just_as_locally() {
        let e = entry_from_stat(
            "/d",
            &RemoteStat {
                name: "sub".into(),
                is_dir: true,
                len: Some(4096),
                ..Default::default()
            },
        );
        assert_eq!(e.kind, EntryKind::Directory);
        assert_eq!(
            e.size, None,
            "4096 is the directory inode, not its contents"
        );
    }

    // The Windows hidden attribute means nothing on a POSIX host.
    #[test]
    fn hidden_is_decided_by_the_leading_dot() {
        assert!(entry_from_stat("/d", &stat(".bashrc")).hidden);
        assert!(!entry_from_stat("/d", &stat("bashrc")).hidden);
    }

    #[test]
    fn fields_sftp_cannot_supply_are_left_empty_rather_than_guessed() {
        let e = entry_from_stat("/d", &stat("x"));
        assert_eq!(e.created_at, None);
        assert_eq!(e.item_count, None);
    }

    #[test]
    fn symlinks_are_reported_as_symlinks() {
        let e = entry_from_stat(
            "/d",
            &RemoteStat {
                name: "link".into(),
                is_symlink: true,
                is_dir: true,
                ..Default::default()
            },
        );
        assert_eq!(e.kind, EntryKind::Symlink);
    }

    #[test]
    fn joins_paths_with_forward_slashes_whatever_this_platform_is() {
        assert_eq!(join_remote("/home/x", "f"), "/home/x/f");
        assert_eq!(join_remote("/home/x/", "f"), "/home/x/f");
        assert_eq!(join_remote("/", "f"), "/f");
        assert_eq!(join_remote("", "f"), "/f");
    }

    #[test]
    fn finds_the_parent_directory() {
        assert_eq!(remote_parent("/a/b/c").as_deref(), Some("/a/b"));
        assert_eq!(remote_parent("/a").as_deref(), Some("/"));
        assert_eq!(remote_parent("/a/b/").as_deref(), Some("/a"));
    }

    #[test]
    fn there_is_nothing_above_the_root() {
        assert_eq!(remote_parent("/"), None);
        assert_eq!(remote_parent(""), None);
    }

    #[test]
    fn sorts_directories_first_then_by_name() {
        let mut v = vec![
            entry_from_stat("/d", &stat("b.txt")),
            entry_from_stat(
                "/d",
                &RemoteStat {
                    name: "zdir".into(),
                    is_dir: true,
                    ..Default::default()
                },
            ),
            entry_from_stat("/d", &stat("A.txt")),
        ];
        sort_entries(&mut v);
        assert_eq!(
            v.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["zdir", "A.txt", "b.txt"]
        );
    }
}
