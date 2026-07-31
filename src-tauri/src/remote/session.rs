use crate::error::FsError;
use crate::fs::entry::FileEntry;
use crate::remote::entry::{entry_from_stat, sort_entries, RemoteStat};
use futures_util::StreamExt;
use openssh::{KnownHosts, SessionBuilder};
use openssh_sftp_client::Sftp;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Live SFTP sessions, one per host alias.
///
/// Both the SSH handshake and opening the SFTP subsystem cost a round trip, and
/// browsing means listing directory after directory. Caching the session is what
/// makes stepping through a remote tree feel like stepping through a local one.
#[derive(Default)]
pub struct Connections(Mutex<HashMap<String, Arc<Sftp>>>);

impl Connections {
    /// An existing session for `alias`, or a new one.
    ///
    /// `config_file` exists for tests, which must not depend on — or disturb —
    /// the user's real `~/.ssh/config`.
    pub async fn get(&self, alias: &str, config_file: Option<&str>) -> Result<Arc<Sftp>, FsError> {
        if let Some(existing) = self.0.lock().await.get(alias) {
            return Ok(Arc::clone(existing));
        }

        let mut builder = SessionBuilder::default();
        // Defer to the user's own known_hosts handling rather than inventing a
        // second trust policy that disagrees with their terminal.
        builder.known_hosts_check(KnownHosts::Add);
        builder.connect_timeout(std::time::Duration::from_secs(15));
        if let Some(path) = config_file {
            builder.config_file(path);
        }

        let session = builder
            .connect_mux(alias)
            .await
            .map_err(|e| FsError::Io(format!("could not connect to {alias}: {e}")))?;

        let sftp = Sftp::from_clonable_session(Arc::new(session), Default::default())
            .await
            .map_err(|e| FsError::Io(format!("could not start sftp on {alias}: {e}")))?;

        let sftp = Arc::new(sftp);
        self.0
            .lock()
            .await
            .insert(alias.to_string(), Arc::clone(&sftp));
        Ok(sftp)
    }

    /// Drops a connection, so the next use reconnects. For when a host has gone
    /// away and the cached session is no longer good for anything.
    pub async fn disconnect(&self, alias: &str) {
        self.0.lock().await.remove(alias);
    }
}

/// Resolves the forms a person types into a path SFTP will accept.
///
/// SFTP has no shell, so `~` is not expanded — it is looked up as a directory
/// with that literal name, which fails confusingly with "does not exist". `.`
/// is the portable way to mean "where this session starts", so tilde forms are
/// rewritten to it and then canonicalised, leaving the pane showing a real
/// absolute path rather than a placeholder.
pub async fn resolve_path(sftp: &Sftp, path: &str) -> Result<String, FsError> {
    let trimmed = path.trim();

    // An absolute path needs no lookup, and canonicalising it would resolve
    // symlinks the user may have navigated through deliberately.
    if trimmed.starts_with('/') {
        return Ok(trimmed.to_string());
    }

    let (base, rest) = match trimmed {
        "" | "~" | "." => (".", ""),
        p if p.starts_with("~/") => (".", &p[2..]),
        p if p.starts_with("./") => (".", &p[2..]),
        p => (".", p),
    };

    // Only the base is canonicalised. Resolving the whole path would fail for a
    // directory that does not exist yet, which is a legitimate thing to type
    // into the path bar before creating it.
    let mut fs = sftp.fs();
    let home = fs
        .canonicalize(base)
        .await
        .map_err(|e| map_sftp_error(path, e))?;
    let home = home.to_string_lossy();

    Ok(if rest.is_empty() {
        home.to_string()
    } else {
        format!("{}/{}", home.trim_end_matches('/'), rest)
    })
}

/// A listing, with the path it actually resolved to.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

/// Lists a remote directory over SFTP.
///
/// SFTP rather than parsing `ls`: the attributes arrive structured, so a filename
/// containing spaces, quotes or a newline cannot corrupt the listing.
pub async fn list_dir(sftp: &Sftp, path: &str) -> Result<RemoteListing, FsError> {
    let path = &resolve_path(sftp, path).await?;
    let mut fs = sftp.fs();
    let dir = fs
        .open_dir(path)
        .await
        .map_err(|e| map_sftp_error(path, e))?
        .read_dir();
    // ReadDir holds a self-referential cancellation future, so it has to be
    // pinned before it can be polled.
    let mut dir = std::pin::pin!(dir);

    let mut entries = Vec::new();
    while let Some(item) = dir.next().await {
        let item = item.map_err(|e| map_sftp_error(path, e))?;
        let name = item.filename().as_os_str().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let meta = item.metadata();
        entries.push(entry_from_stat(
            path,
            &RemoteStat {
                name,
                is_dir: meta.file_type().map(|t| t.is_dir()).unwrap_or(false),
                is_symlink: meta.file_type().map(|t| t.is_symlink()).unwrap_or(false),
                len: meta.len(),
                modified_secs: meta.modified().and_then(|t| {
                    t.as_system_time()
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_secs())
                }),
            },
        ));
    }

    sort_entries(&mut entries);
    Ok(RemoteListing {
        path: path.clone(),
        entries,
    })
}

/// Keeps the frontend's error vocabulary the same for remote failures, so a
/// missing directory reads the same whichever side of the connection it is on.
fn map_sftp_error(path: &str, e: openssh_sftp_client::Error) -> FsError {
    let text = e.to_string();
    let lower = text.to_lowercase();
    if lower.contains("no such file") || lower.contains("not found") {
        FsError::NotFound(format!("{path} does not exist on the remote"))
    } else if lower.contains("permission") {
        FsError::PermissionDenied(format!("not allowed to read {path} on the remote"))
    } else {
        FsError::Io(format!("{path}: {text}"))
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Path to a throwaway ssh config pointing at a disposable container. These
    /// tests are skipped when it is absent, so the suite stays runnable by anyone
    /// without an SSH server to hand.
    fn test_config() -> Option<String> {
        let p = std::env::var("DCMD_TEST_SSH_CONFIG").ok()?;
        std::path::Path::new(&p).exists().then_some(p)
    }

    async fn connect() -> Option<(Connections, std::sync::Arc<Sftp>)> {
        let cfg = test_config()?;
        let conns = Connections::default();
        let sftp = conns.get("dcmd-test", Some(&cfg)).await.expect("connect");
        Some((conns, sftp))
    }

    // Regression: the default start path was "~", which SFTP looks up as a
    // directory with that literal name, so connecting reported "does not exist".
    #[tokio::test]
    async fn a_tilde_resolves_to_the_home_directory() {
        let Some((_c, sftp)) = connect().await else {
            println!("SKIP no test ssh config");
            return;
        };
        let home = resolve_path(&sftp, "~").await.expect("resolve");
        println!("LIVE tilde_resolves_to={home}");
        assert!(home.starts_with('/'), "should be absolute, got {home}");
        assert!(!home.contains('~'), "tilde should be gone, got {home}");
    }

    #[tokio::test]
    async fn the_forms_meaning_home_all_resolve_the_same_way() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let home = resolve_path(&sftp, "~").await.unwrap();
        for form in ["", ".", "~"] {
            assert_eq!(
                resolve_path(&sftp, form).await.unwrap(),
                home,
                "form {form:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_tilde_path_keeps_what_follows_it() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let home = resolve_path(&sftp, "~").await.unwrap();
        let sub = resolve_path(&sftp, "~/some/where").await.unwrap();
        println!("LIVE tilde_sub={sub}");
        assert_eq!(sub, format!("{home}/some/where"));
    }

    #[tokio::test]
    async fn an_absolute_path_is_left_alone() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        assert_eq!(resolve_path(&sftp, "/tmp/demo").await.unwrap(), "/tmp/demo");
    }

    #[tokio::test]
    async fn listing_reports_the_path_it_resolved_to() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let listing = list_dir(&sftp, "~").await.expect("list");
        println!("LIVE listing_path={}", listing.path);
        assert!(listing.path.starts_with('/'), "got {}", listing.path);
    }

    #[tokio::test]
    async fn lists_a_remote_directory() {
        let Some((_c, sftp)) = connect().await else {
            println!("SKIP no test ssh config");
            return;
        };
        let entries = list_dir(&sftp, "/tmp/demo").await.expect("list").entries;
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        println!("LIVE names={names:?}");
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"big.bin"));
        assert!(names.contains(&"sub"));
    }

    #[tokio::test]
    async fn reports_sizes_kinds_and_times() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let entries = list_dir(&sftp, "/tmp/demo").await.expect("list").entries;
        let big = entries.iter().find(|e| e.name == "big.bin").unwrap();
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        println!(
            "LIVE big={:?} kind={:?} mtime={:?} | sub kind={:?} size={:?}",
            big.size, big.kind, big.modified_at, sub.kind, sub.size
        );
        assert_eq!(big.size, Some(5000));
        assert_eq!(big.kind, crate::fs::entry::EntryKind::File);
        assert!(big.modified_at.unwrap() > 1_600_000_000_000);
        assert_eq!(sub.kind, crate::fs::entry::EntryKind::Directory);
        assert_eq!(sub.size, None, "directories report no size");
    }

    #[tokio::test]
    async fn a_missing_directory_reports_not_found() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let err = list_dir(&sftp, "/tmp/definitely-not-here")
            .await
            .unwrap_err();
        println!("LIVE missing={err:?}");
        assert!(matches!(err, FsError::NotFound(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn awkward_filenames_survive_the_listing() {
        let Some((_c, sftp)) = connect().await else {
            return;
        };
        let entries = list_dir(&sftp, "/tmp/awkward").await.expect("list").entries;
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        println!("LIVE awkward={names:?}");
        // Exactly the cases that break parsing ls output.
        assert!(names.iter().any(|n| n.contains(' ')));
        assert!(names.iter().any(|n| n.contains('\n')));
        assert!(names.contains(&"naïve.txt"));
    }

    #[tokio::test]
    async fn the_session_is_reused_rather_than_reconnected() {
        let Some(cfg) = test_config() else { return };
        let conns = Connections::default();
        let a = conns.get("dcmd-test", Some(&cfg)).await.expect("first");
        let b = conns.get("dcmd-test", Some(&cfg)).await.expect("second");
        assert!(std::sync::Arc::ptr_eq(&a, &b), "should reuse one session");
    }
}
