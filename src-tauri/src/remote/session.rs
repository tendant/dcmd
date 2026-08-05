use crate::error::FsError;
use crate::fs::entry::FileEntry;
use crate::remote::entry::{entry_from_stat, sort_entries, RemoteStat};
use futures_util::StreamExt;
use openssh::{KnownHosts, SessionBuilder};
use openssh_sftp_client::Sftp;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// How long the whole of connecting may take.
///
/// ssh's own `ConnectTimeout` — what `SessionBuilder::connect_timeout` sets —
/// bounds the TCP connect and nothing after it. The handshake, authentication
/// and opening the SFTP subsystem are all unbounded, so a host that accepts a
/// connection and then stops responding hangs indefinitely. This covers the lot.
const CONNECT_DEADLINE: std::time::Duration = std::time::Duration::from_secs(20);

/// Long enough not to disturb a working link, short enough that a host which
/// goes silent mid-session is noticed rather than waited on forever.
const KEEPALIVE: std::time::Duration = std::time::Duration::from_secs(10);

/// A config that forces `BatchMode` on and then defers to the user's own.
///
/// Without it, ssh prompts for a password or a key passphrase — and this is a
/// windowed app with no terminal attached, so it waits on input that can never
/// arrive. Not slow: indefinite, and `ConnectTimeout` does not apply because the
/// TCP connect already succeeded. `BatchMode yes` makes ssh fail immediately
/// instead, which is a message the pane can show.
///
/// It comes first deliberately: ssh takes the first value it obtains for each
/// option, so this wins over anything in the included file.
///
/// Passing `-F` means ssh reads only the file given, hence the `Include` — the
/// user's hosts, keys, ports and `ProxyJump` must all still apply.
fn batch_mode_config(user_config: Option<&str>) -> Result<tempfile::NamedTempFile, FsError> {
    use std::io::Write;

    let mut file = tempfile::Builder::new()
        .prefix("dcmd-ssh-")
        .suffix(".config")
        .tempfile()
        .map_err(|e| FsError::Io(format!("could not write an ssh config: {e}")))?;

    writeln!(file, "BatchMode yes").map_err(|e| FsError::Io(e.to_string()))?;

    let included = user_config
        .map(std::path::PathBuf::from)
        .or_else(crate::remote::ssh_config::default_config_path);
    if let Some(path) = included.filter(|p| p.is_file()) {
        writeln!(file, "Include {}", path.display()).map_err(|e| FsError::Io(e.to_string()))?;
    }
    file.flush().map_err(|e| FsError::Io(e.to_string()))?;

    Ok(file)
}

/// Live SFTP sessions, one per host alias.
///
/// Both the SSH handshake and opening the SFTP subsystem cost a round trip, and
/// browsing means listing directory after directory. Caching the session is what
/// makes stepping through a remote tree feel like stepping through a local one.
#[derive(Default)]
pub struct Connections {
    sessions: Mutex<HashMap<String, Arc<Sftp>>>,
    /// Connections currently being established, so Escape can abandon one.
    /// Keyed by alias; the entry exists only while a connect is in flight.
    pending: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

impl Connections {
    /// An existing session for `alias`, or a new one.
    ///
    /// `config_file` exists for tests, which must not depend on — or disturb —
    /// the user's real `~/.ssh/config`.
    pub async fn get(&self, alias: &str, config_file: Option<&str>) -> Result<Arc<Sftp>, FsError> {
        if let Some(existing) = self.sessions.lock().await.get(alias) {
            return Ok(Arc::clone(existing));
        }

        let cancel = Arc::new(tokio::sync::Notify::new());
        self.pending
            .lock()
            .await
            .insert(alias.to_string(), Arc::clone(&cancel));

        let outcome = tokio::select! {
            // Biased so that a cancel already asked for wins over a connect that
            // happens to complete in the same poll — the user pressed Escape.
            biased;
            () = cancel.notified() => Err(FsError::Cancelled(format!(
                "connecting to {alias} was cancelled"
            ))),
            r = tokio::time::timeout(CONNECT_DEADLINE, Self::open(alias, config_file)) => match r {
                Ok(r) => r,
                Err(_) => Err(FsError::Io(format!(
                    "timed out after {}s connecting to {alias}",
                    CONNECT_DEADLINE.as_secs()
                ))),
            },
        };

        self.pending.lock().await.remove(alias);

        let sftp = outcome?;
        self.sessions
            .lock()
            .await
            .insert(alias.to_string(), Arc::clone(&sftp));
        Ok(sftp)
    }

    /// Opens one session. Split out so the whole of it can be raced against a
    /// deadline and a cancellation, rather than only its first step.
    async fn open(alias: &str, config_file: Option<&str>) -> Result<Arc<Sftp>, FsError> {
        let config = batch_mode_config(config_file)?;

        let mut builder = SessionBuilder::default();
        // Defer to the user's own known_hosts handling rather than inventing a
        // second trust policy that disagrees with their terminal.
        builder.known_hosts_check(KnownHosts::Add);
        builder.connect_timeout(std::time::Duration::from_secs(15));
        builder.server_alive_interval(KEEPALIVE);
        builder.config_file(config.path());

        let session = builder
            .connect_mux(alias)
            .await
            .map_err(|e| FsError::Io(format!("could not connect to {alias}: {e}")))?;

        let sftp = Sftp::from_clonable_session(Arc::new(session), Default::default())
            .await
            .map_err(|e| FsError::Io(format!("could not start sftp on {alias}: {e}")))?;

        // Held until here: ssh reads the file as it starts, and dropping it
        // earlier would delete it out from under the process being spawned.
        drop(config);
        Ok(Arc::new(sftp))
    }

    /// Abandons a connection still being established.
    ///
    /// Does nothing if there is no connect in flight for `alias`, which is the
    /// common case — Escape means several things and this is only one of them.
    pub async fn cancel(&self, alias: &str) {
        if let Some(cancel) = self.pending.lock().await.get(alias) {
            // notify_one rather than notify_waiters: it leaves a permit if the
            // waiter has not reached its await yet, so a cancel arriving in that
            // window is not simply lost.
            cancel.notify_one();
        }
    }

    /// Drops a connection, so the next use reconnects. For when a host has gone
    /// away and the cached session is no longer good for anything.
    pub async fn disconnect(&self, alias: &str) {
        self.sessions.lock().await.remove(alias);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The reason this file generates a config at all. Without `BatchMode yes`
    /// ssh prompts for a password on a host that wants one, and a windowed app
    /// has no terminal to answer it — the connection then waits forever.
    #[test]
    fn the_generated_config_forces_batch_mode() {
        let file = batch_mode_config(None).expect("write config");
        let text = std::fs::read_to_string(file.path()).unwrap();
        assert!(text.contains("BatchMode yes"), "got: {text}");
    }

    /// ssh takes the first value it obtains for an option, so the include must
    /// come after — otherwise a user config setting BatchMode no would win and
    /// reintroduce the hang.
    #[test]
    fn batch_mode_precedes_the_include() {
        let user = tempfile::NamedTempFile::new().unwrap();
        let file = batch_mode_config(Some(user.path().to_str().unwrap())).unwrap();
        let text = std::fs::read_to_string(file.path()).unwrap();
        let batch = text.find("BatchMode").expect("BatchMode present");
        let include = text.find("Include").expect("Include present");
        assert!(batch < include, "BatchMode must come first, got: {text}");
    }

    /// The user's hosts, keys, ports and ProxyJump all live there, and passing
    /// -F means ssh reads nothing else.
    #[test]
    fn the_users_config_is_included() {
        let user = tempfile::NamedTempFile::new().unwrap();
        let path = user.path().to_str().unwrap().to_string();
        let file = batch_mode_config(Some(&path)).unwrap();
        let text = std::fs::read_to_string(file.path()).unwrap();
        assert!(text.contains(&format!("Include {path}")), "got: {text}");
    }

    /// A config file that is not there must not produce an Include line: ssh
    /// would still start, but the generated file should say only what is true.
    #[test]
    fn a_missing_config_is_not_included() {
        let file = batch_mode_config(Some("/nonexistent/dcmd/ssh/config")).unwrap();
        let text = std::fs::read_to_string(file.path()).unwrap();
        assert!(!text.contains("Include"), "got: {text}");
    }

    /// Asks ssh what it would actually do, rather than trusting this file's
    /// reading of ssh_config(5). `-G` resolves the configuration and prints it
    /// without connecting, so it checks the two things that matter: the user's
    /// hosts still resolve through the Include, and BatchMode wins over a
    /// contrary setting in their own config because it is obtained first.
    #[test]
    fn ssh_itself_agrees_the_overlay_works() {
        use std::io::Write;
        let mut user = tempfile::NamedTempFile::new().unwrap();
        writeln!(user, "Host dcmd-probe").unwrap();
        writeln!(user, "  HostName probe.example.com").unwrap();
        writeln!(user, "  Port 2222").unwrap();
        // The setting the overlay has to beat.
        writeln!(user, "  BatchMode no").unwrap();
        user.flush().unwrap();

        let generated = batch_mode_config(Some(user.path().to_str().unwrap())).unwrap();
        let out = std::process::Command::new("ssh")
            .arg("-F")
            .arg(generated.path())
            .arg("-G")
            .arg("dcmd-probe")
            .output();
        let Ok(out) = out else {
            return; // No ssh binary: nothing to check against.
        };
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();

        assert!(
            text.contains("hostname probe.example.com"),
            "the user's config must still apply, got: {text}"
        );
        assert!(text.contains("port 2222"), "got: {text}");
        assert!(
            text.contains("batchmode yes"),
            "BatchMode must win over the user's setting, got: {text}"
        );
    }

    /// Cancelling a host that is not connecting is what Escape does most of the
    /// time, since Escape means several things and this is only one of them.
    #[tokio::test]
    async fn cancelling_nothing_is_harmless() {
        let conns = Connections::default();
        conns.cancel("no-such-host").await;
    }

    /// The point of the whole exercise: a connect that never completes ends by
    /// itself rather than waiting on a server that will never answer.
    ///
    /// Uses the documentation-only address 192.0.2.1, which is unroutable, so
    /// this exercises the deadline rather than a refusal.
    #[tokio::test(flavor = "multi_thread")]
    async fn connecting_gives_up_rather_than_waiting_forever() {
        let mut cfg = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write;
        writeln!(cfg, "Host dcmd-blackhole").unwrap();
        writeln!(cfg, "  HostName 192.0.2.1").unwrap();
        writeln!(cfg, "  ConnectTimeout 2").unwrap();
        cfg.flush().unwrap();

        let conns = Connections::default();
        let started = std::time::Instant::now();
        let result = conns
            .get("dcmd-blackhole", Some(cfg.path().to_str().unwrap()))
            .await;

        assert!(
            result.is_err(),
            "an unroutable host must not appear to connect"
        );
        assert!(
            started.elapsed() < CONNECT_DEADLINE + std::time::Duration::from_secs(10),
            "took {:?}, which is not bounded",
            started.elapsed(),
        );
    }

    /// Escape must reach a connect already in flight, not only one that has not
    /// started. The host is unroutable, so without the cancel this would sit
    /// until the deadline.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_pending_connect_can_be_cancelled() {
        let mut cfg = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write;
        writeln!(cfg, "Host dcmd-blackhole").unwrap();
        writeln!(cfg, "  HostName 192.0.2.1").unwrap();
        cfg.flush().unwrap();
        let path = cfg.path().to_str().unwrap().to_string();

        let conns = std::sync::Arc::new(Connections::default());
        let c2 = std::sync::Arc::clone(&conns);
        let canceller = tokio::spawn(async move {
            // Long enough for the connect to have registered itself as pending.
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            c2.cancel("dcmd-blackhole").await;
        });

        let started = std::time::Instant::now();
        let result = conns.get("dcmd-blackhole", Some(&path)).await;
        canceller.await.unwrap();

        assert!(
            matches!(result, Err(FsError::Cancelled(_))),
            "expected a cancellation, got {result:?}"
        );
        assert!(
            started.elapsed() < CONNECT_DEADLINE,
            "cancel did not take effect: waited {:?}",
            started.elapsed(),
        );
    }
}
