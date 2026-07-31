//! Browsing directories on an SSH host.
//!
//! Deliberately not a remote filesystem abstraction. Listings come over SFTP,
//! transfers are handed to rsync, and nothing else about the app changes. The
//! local operations keep their guarantees because none of them run over the wire.
//!
//! Connections drive the system `ssh` binary rather than reimplementing SSH, so
//! `~/.ssh/config`, the agent, ProxyJump and known_hosts all work as they already
//! do in a terminal. That is Unix-only, which is the accepted cost.

pub mod entry;
pub mod rsync;
pub mod ssh_config;

#[cfg(unix)]
pub mod session;

use serde::{Deserialize, Serialize};

/// A saved host. `alias` is whatever `ssh` itself would accept — a Host from
/// `~/.ssh/config`, or `user@hostname`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Remote {
    /// Shown in the UI.
    pub name: String,
    pub alias: String,
    /// Where a pane opens on this host.
    pub start_path: String,
}
