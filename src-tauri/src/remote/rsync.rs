use crate::error::FsError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One end of a transfer. A remote endpoint is written the way rsync and ssh
/// already understand it, so `~/.ssh/config` applies without translation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    /// Host alias, or None for this machine.
    pub alias: Option<String>,
    pub path: String,
}

impl Endpoint {
    /// `alias:/path` for a remote, or the bare path locally.
    pub fn spec(&self) -> String {
        match &self.alias {
            Some(a) => format!("{a}:{}", self.path),
            None => self.path.clone(),
        }
    }

    /// As above but ending in `/`, which is how rsync is told to place items
    /// *inside* a directory rather than replacing it.
    pub fn dir_spec(&self) -> String {
        let s = self.spec();
        if s.ends_with('/') {
            s
        } else {
            format!("{s}/")
        }
    }
}

/// What a transfer did, or would do.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RsyncReport {
    /// For a dry run: the changes rsync says it would make.
    pub changes: Vec<String>,
    pub cancelled: bool,
    /// rsync's own stderr, kept so a failure can say what actually went wrong.
    pub errors: Vec<String>,
}

/// Progress, as parsed from rsync's own reporting.
#[derive(Debug, Clone, Copy, Default)]
pub struct RsyncProgress {
    pub percent: u8,
    /// Files done and total, from rsync's `to-chk=` counter.
    pub done: usize,
    pub total: usize,
}

/// Reads a line of `--info=progress2` output.
///
/// Looks like: `  1,234,567  42%  5.14MB/s  0:00:03 (xfr#2, to-chk=8/10)`.
/// The trailing counter is what makes an item count possible; without it there
/// is only a byte percentage, which says little during a long directory walk.
pub fn parse_progress(line: &str) -> Option<RsyncProgress> {
    let percent = line
        .split_whitespace()
        .find(|t| t.ends_with('%'))
        .and_then(|t| t.trim_end_matches('%').parse::<u8>().ok())?;

    let (done, total) = match line.split_once("to-chk=") {
        Some((_, rest)) => {
            let counter: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '/')
                .collect();
            match counter.split_once('/') {
                Some((remaining, total)) => {
                    let total: usize = total.parse().ok()?;
                    let remaining: usize = remaining.parse().ok()?;
                    (total.saturating_sub(remaining), total)
                }
                None => (0, 0),
            }
        }
        None => (0, 0),
    };

    Some(RsyncProgress {
        percent: percent.min(100),
        done,
        total,
    })
}

/// A change line from `--itemize-changes`, e.g. `>f+++++++++ notes.txt`.
///
/// Only the name is kept: the flag field is rsync's own shorthand and would need
/// explaining before it told the user anything.
pub fn parse_itemized(line: &str) -> Option<String> {
    let (flags, name) = line.split_once(' ')?;
    // rsync's flag field is a change type followed by a file type, e.g.
    // ">f+++++++++". Testing only the first character would let plain prose
    // through — "created directory ..." begins with a valid change type.
    let mut chars = flags.chars();
    let change = chars.next()?;
    let file_type = chars.next()?;
    if !matches!(change, '<' | '>' | 'c' | 'h' | '.' | '*') {
        return None;
    }
    if !matches!(file_type, 'f' | 'd' | 'L' | 'D' | 'S') {
        return None;
    }
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Arguments for a transfer.
///
/// `-a` preserves times, permissions and links, which is the whole reason to
/// prefer rsync over reimplementing copy. `--partial` keeps what was written if
/// the transfer is interrupted, so cancelling and resuming is not wasted work.
pub fn build_args(
    sources: &[Endpoint],
    destination: &Endpoint,
    dry_run: bool,
) -> Result<Vec<String>, FsError> {
    if sources.is_empty() {
        return Err(FsError::InvalidName("nothing to transfer".into()));
    }
    // rsync cannot move data between two remote hosts; it would have to route
    // through here, which is not what the user asked for and is far slower.
    if sources.iter().any(|s| s.alias.is_some()) && destination.alias.is_some() {
        return Err(FsError::InvalidName(
            "rsync cannot transfer directly between two remote hosts".into(),
        ));
    }

    let mut args = vec![
        "-a".to_string(),
        "--partial".to_string(),
        "--info=progress2".to_string(),
        "--out-format=%i %n".to_string(),
    ];
    if dry_run {
        args.push("--dry-run".to_string());
        args.push("--itemize-changes".to_string());
    }
    args.push("--".to_string());
    for s in sources {
        // No trailing slash: the item itself is placed into the destination,
        // rather than its contents being merged over the destination.
        args.push(s.spec().trim_end_matches('/').to_string());
    }
    args.push(destination.dir_spec());
    Ok(args)
}

/// Rejects a destination that is not usable before anything is spawned.
pub fn check_local_destination(destination: &Endpoint) -> Result<(), FsError> {
    if destination.alias.is_some() {
        return Ok(());
    }
    if !Path::new(&destination.path).is_dir() {
        return Err(FsError::NotADirectory(format!(
            "destination is not a directory: {}",
            destination.path
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(p: &str) -> Endpoint {
        Endpoint {
            alias: None,
            path: p.into(),
        }
    }
    fn remote(a: &str, p: &str) -> Endpoint {
        Endpoint {
            alias: Some(a.into()),
            path: p.into(),
        }
    }

    #[test]
    fn writes_endpoints_the_way_ssh_understands_them() {
        assert_eq!(local("/tmp/x").spec(), "/tmp/x");
        assert_eq!(remote("build", "/srv").spec(), "build:/srv");
    }

    // Trailing slashes are the classic rsync foot-gun: the wrong one merges a
    // directory's contents over the destination instead of placing it inside.
    #[test]
    fn destinations_end_in_a_slash_and_sources_do_not() {
        let args = build_args(&[local("/a/src/")], &local("/b"), false).unwrap();
        assert!(args.contains(&"/a/src".to_string()), "{args:?}");
        assert!(args.contains(&"/b/".to_string()), "{args:?}");
    }

    #[test]
    fn preserves_metadata_and_keeps_partial_transfers() {
        let args = build_args(&[local("/a")], &local("/b"), false).unwrap();
        assert!(args.contains(&"-a".to_string()));
        assert!(args.contains(&"--partial".to_string()));
    }

    #[test]
    fn a_dry_run_asks_for_an_itemised_list() {
        let args = build_args(&[local("/a")], &local("/b"), true).unwrap();
        assert!(args.contains(&"--dry-run".to_string()));
        assert!(args.contains(&"--itemize-changes".to_string()));
    }

    #[test]
    fn a_real_run_does_not() {
        let args = build_args(&[local("/a")], &local("/b"), false).unwrap();
        assert!(!args.contains(&"--dry-run".to_string()));
    }

    #[test]
    fn refuses_a_transfer_between_two_hosts() {
        let err = build_args(&[remote("a", "/x")], &remote("b", "/y"), false).unwrap_err();
        assert!(matches!(err, FsError::InvalidName(_)), "got {err:?}");
    }

    #[test]
    fn allows_upload_and_download() {
        assert!(build_args(&[local("/x")], &remote("b", "/y"), false).is_ok());
        assert!(build_args(&[remote("b", "/y")], &local("/x"), false).is_ok());
    }

    #[test]
    fn refuses_an_empty_transfer() {
        assert!(build_args(&[], &local("/b"), false).is_err());
    }

    #[test]
    fn separates_options_from_paths_so_a_leading_dash_is_not_a_flag() {
        let args = build_args(&[local("/tmp/-weird")], &local("/b"), false).unwrap();
        let sep = args.iter().position(|a| a == "--").unwrap();
        let path = args.iter().position(|a| a == "/tmp/-weird").unwrap();
        assert!(sep < path, "paths must follow --");
    }

    #[test]
    fn reads_progress_and_the_file_counter() {
        let p = parse_progress("  1,234,567  42%  5.14MB/s  0:00:03 (xfr#2, to-chk=8/10)")
            .expect("parsed");
        assert_eq!(p.percent, 42);
        assert_eq!(p.done, 2, "10 total less 8 remaining");
        assert_eq!(p.total, 10);
    }

    #[test]
    fn reads_progress_without_a_counter() {
        let p = parse_progress("      5,392 100%    5.14MB/s    0:00:00").expect("parsed");
        assert_eq!(p.percent, 100);
        assert_eq!(p.total, 0);
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        assert!(parse_progress("sending incremental file list").is_none());
        assert!(parse_progress("").is_none());
    }

    #[test]
    fn reads_itemised_changes() {
        assert_eq!(
            parse_itemized(">f+++++++++ a/f.txt").as_deref(),
            Some("a/f.txt")
        );
        assert_eq!(parse_itemized("cd+++++++++ a/").as_deref(), Some("a/"));
    }

    // "created directory ..." starts with a valid change type, so checking only
    // the first character would let rsync's prose through as a filename.
    #[test]
    fn ignores_rsync_chatter_in_the_itemised_list() {
        assert!(parse_itemized("created directory /tmp/dest").is_none());
        assert!(parse_itemized("sending incremental file list").is_none());
        assert!(parse_itemized("total size is 1,234  speedup is 2.00").is_none());
    }

    #[test]
    fn recognises_a_deletion() {
        assert_eq!(
            parse_itemized("*deleting   old.txt").as_deref(),
            Some("old.txt")
        );
    }

    #[test]
    fn keeps_names_containing_spaces() {
        assert_eq!(
            parse_itemized(">f+++++++++ a file with spaces.txt").as_deref(),
            Some("a file with spaces.txt")
        );
    }
}

#[cfg(unix)]
mod run {
    use super::*;
    use std::process::Stdio;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::io::{AsyncReadExt, BufReader};
    use tokio::process::Command;

    /// Runs rsync, reporting progress as it goes.
    ///
    /// Progress arrives carriage-return separated rather than in lines, because
    /// rsync rewrites one line in place; reading by line would produce nothing
    /// until the transfer finished.
    pub async fn run_rsync<F>(
        args: &[String],
        cancel: &AtomicBool,
        mut on_progress: F,
    ) -> Result<RsyncReport, FsError>
    where
        F: FnMut(RsyncProgress),
    {
        let mut child = Command::new("rsync")
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    FsError::NotFound("rsync is not installed".into())
                } else {
                    FsError::Io(format!("could not start rsync: {e}"))
                }
            })?;

        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let mut reader = BufReader::new(stdout);
        let mut report = RsyncReport::default();
        let mut buf = [0u8; 4096];
        let mut pending = String::new();

        loop {
            if cancel.load(Ordering::Relaxed) {
                // Killing mid-flight is safe because --partial keeps whatever
                // arrived, so resuming later does not start from nothing.
                let _ = child.start_kill();
                report.cancelled = true;
                break;
            }

            let read = tokio::select! {
                r = reader.read(&mut buf) => r,
                _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => Ok(0),
            };

            match read {
                Ok(0) => {
                    if let Ok(Some(_)) = child.try_wait() {
                        break;
                    }
                }
                Ok(n) => {
                    pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                    for chunk in pending.split(['\r', '\n']) {
                        let chunk = chunk.trim();
                        if chunk.is_empty() {
                            continue;
                        }
                        if let Some(p) = parse_progress(chunk) {
                            on_progress(p);
                        } else if let Some(name) = parse_itemized(chunk) {
                            report.changes.push(name);
                        }
                    }
                    // Keep only an unterminated tail for the next read.
                    pending = match pending.rfind(['\r', '\n']) {
                        Some(i) => pending[i + 1..].to_string(),
                        None => pending,
                    };
                }
                Err(e) => return Err(FsError::Io(format!("reading rsync output: {e}"))),
            }
        }

        let status = child.wait().await.ok();
        let mut errs = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut errs).await;
        report
            .errors
            .extend(errs.lines().map(str::to_string).filter(|l| !l.is_empty()));

        if !report.cancelled && !matches!(status.and_then(|s| s.code()), Some(0)) {
            let detail = report
                .errors
                .first()
                .cloned()
                .unwrap_or_else(|| "rsync failed".into());
            return Err(FsError::Io(detail));
        }
        Ok(report)
    }
}

#[cfg(unix)]
pub use run::run_rsync;

#[cfg(all(test, unix))]
mod live_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// Live transfers need the disposable container from scripts/ssh-test-server.sh.
    fn ssh_config() -> Option<String> {
        let p = std::env::var("DCMD_TEST_SSH_CONFIG").ok()?;
        std::path::Path::new(&p).exists().then_some(p)
    }

    /// rsync has to be told which ssh config to use, exactly as the app relies on
    /// the user's default one.
    fn with_config(args: &[String], cfg: &str) -> Vec<String> {
        let mut v = vec!["-e".to_string(), format!("ssh -F {cfg}")];
        v.extend_from_slice(args);
        v
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("dcmd-rsync-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[tokio::test]
    async fn uploads_a_directory_to_the_remote() {
        let Some(cfg) = ssh_config() else {
            println!("SKIP no test ssh config");
            return;
        };
        let src = scratch("up");
        std::fs::write(src.join("hello.txt"), "from local").unwrap();
        std::fs::create_dir(src.join("nested")).unwrap();
        std::fs::write(src.join("nested/deep.txt"), "deep").unwrap();

        let args = build_args(
            &[Endpoint {
                alias: None,
                path: src.display().to_string(),
            }],
            &Endpoint {
                alias: Some("dcmd-test".into()),
                path: "/tmp/uploaded".into(),
            },
            false,
        )
        .unwrap();

        // The destination directory must exist for rsync to place items in it.
        let _ = std::process::Command::new("ssh")
            .args(["-F", &cfg, "dcmd-test", "mkdir -p /tmp/uploaded"])
            .status();

        let cancel = AtomicBool::new(false);
        let mut seen = Vec::new();
        let report = run_rsync(&with_config(&args, &cfg), &cancel, |p| seen.push(p))
            .await
            .expect("rsync");
        assert!(!report.cancelled);

        let out = std::process::Command::new("ssh")
            .args([
                "-F",
                &cfg,
                "dcmd-test",
                "cat /tmp/uploaded/dcmd-rsync-up/nested/deep.txt",
            ])
            .output()
            .unwrap();
        println!(
            "LIVE uploaded={:?} progress_events={}",
            String::from_utf8_lossy(&out.stdout).trim(),
            seen.len()
        );
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "deep");
    }

    #[tokio::test]
    async fn downloads_from_the_remote() {
        let Some(cfg) = ssh_config() else { return };
        let dest = scratch("down");
        let args = build_args(
            &[Endpoint {
                alias: Some("dcmd-test".into()),
                path: "/tmp/demo".into(),
            }],
            &Endpoint {
                alias: None,
                path: dest.display().to_string(),
            },
            false,
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        run_rsync(&with_config(&args, &cfg), &cancel, |_| {})
            .await
            .expect("rsync");

        let got = std::fs::read_to_string(dest.join("demo/a.txt")).expect("downloaded");
        println!("LIVE downloaded={:?}", got.trim());
        assert_eq!(got.trim(), "hello");
        assert!(
            dest.join("demo/sub/nested.txt").exists(),
            "nested file missing"
        );
    }

    /// The safety feature that makes remote transfers defensible: see exactly
    /// what would change before anything is written.
    #[tokio::test]
    async fn a_dry_run_reports_changes_without_making_them() {
        let Some(cfg) = ssh_config() else { return };
        let dest = scratch("dry");
        let args = build_args(
            &[Endpoint {
                alias: Some("dcmd-test".into()),
                path: "/tmp/demo".into(),
            }],
            &Endpoint {
                alias: None,
                path: dest.display().to_string(),
            },
            true,
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        let report = run_rsync(&with_config(&args, &cfg), &cancel, |_| {})
            .await
            .expect("rsync");
        println!("LIVE dry_run_changes={:?}", report.changes);

        assert!(
            report.changes.iter().any(|c| c.contains("a.txt")),
            "{:?}",
            report.changes
        );
        assert!(
            std::fs::read_dir(&dest).unwrap().next().is_none(),
            "a dry run must not write anything"
        );
    }

    #[tokio::test]
    async fn cancelling_stops_the_transfer() {
        let Some(cfg) = ssh_config() else { return };
        let dest = scratch("cancel");
        let args = build_args(
            &[Endpoint {
                alias: Some("dcmd-test".into()),
                path: "/tmp/demo".into(),
            }],
            &Endpoint {
                alias: None,
                path: dest.display().to_string(),
            },
            false,
        )
        .unwrap();

        // Already cancelled: it must refuse rather than run to completion.
        let cancel = AtomicBool::new(true);
        let report = run_rsync(&with_config(&args, &cfg), &cancel, |_| {})
            .await
            .expect("rsync");
        println!("LIVE cancelled={}", report.cancelled);
        assert!(report.cancelled);
    }

    #[tokio::test]
    async fn a_missing_remote_path_reports_the_reason() {
        let Some(cfg) = ssh_config() else { return };
        let dest = scratch("missing");
        let args = build_args(
            &[Endpoint {
                alias: Some("dcmd-test".into()),
                path: "/tmp/not-there".into(),
            }],
            &Endpoint {
                alias: None,
                path: dest.display().to_string(),
            },
            false,
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        let err = run_rsync(&with_config(&args, &cfg), &cancel, |_| {})
            .await
            .unwrap_err();
        println!("LIVE missing_err={err:?}");
        assert!(
            format!("{err:?}").to_lowercase().contains("no such file"),
            "got {err:?}"
        );
    }
}
