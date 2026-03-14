use serde::Serialize;

/// Result type for command execution, returned to the frontend
#[derive(Serialize)]
pub struct CmdResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}
