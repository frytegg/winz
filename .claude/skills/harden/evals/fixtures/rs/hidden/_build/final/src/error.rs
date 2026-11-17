//! Crate-wide error type.

use std::fmt;
use std::io;

#[derive(Debug)]
pub enum Error {
    /// A line of the order file could not be parsed.
    Parse { line: usize, msg: String },
    /// The config file is malformed.
    Config(String),
    /// The configured strategy is not registered.
    UnknownStrategy(String),
    /// The reference price service failed or answered garbage.
    RefData(String),
    Io(io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Parse { line, msg } => write!(f, "line {line}: {msg}"),
            Error::Config(msg) => write!(f, "config: {msg}"),
            Error::UnknownStrategy(name) => write!(f, "unknown strategy `{name}`"),
            Error::RefData(msg) => write!(f, "reference data: {msg}"),
            Error::Io(err) => write!(f, "i/o error: {err}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Error {
        Error::Io(err)
    }
}
