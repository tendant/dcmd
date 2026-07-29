use serde::Serialize;
use std::io;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum FsError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("invalid name: {0}")]
    InvalidName(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("trash error: {0}")]
    Trash(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("cancelled: {0}")]
    Cancelled(String),
}

impl From<io::Error> for FsError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => FsError::NotFound(err.to_string()),
            io::ErrorKind::AlreadyExists => FsError::AlreadyExists(err.to_string()),
            io::ErrorKind::PermissionDenied => FsError::PermissionDenied(err.to_string()),
            _ => FsError::Io(err.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_serializes_to_the_kind_the_frontend_checks() {
        let json = serde_json::to_string(&FsError::Cancelled("stopped".into())).unwrap();
        assert_eq!(json, r#"{"kind":"cancelled","message":"stopped"}"#);
    }
}
