use std::collections::HashMap;
use std::process::Command;

use crate::types::CmdResult;

/// Get the user's full shell environment by sourcing their shell profile.
/// This ensures KUBECONFIG, PATH, HOME etc. are all available.
pub fn get_shell_env() -> HashMap<String, String> {
    use std::sync::OnceLock;
    static CACHED_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    CACHED_ENV.get_or_init(|| {
        // Try to source user's shell env via login shell
        let output = Command::new("/bin/zsh")
            .args(["-ilc", "env"])
            .output();
        
        match output {
            Ok(o) if o.status.success() => {
                let env_str = String::from_utf8_lossy(&o.stdout);
                let mut env_map = HashMap::new();
                for line in env_str.lines() {
                    if let Some((key, val)) = line.split_once('=') {
                        env_map.insert(key.to_string(), val.to_string());
                    }
                }
                env_map
            }
            _ => {
                // Fallback: minimal env
                let mut env_map = HashMap::new();
                env_map.insert("PATH".to_string(), 
                    "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string());
                if let Ok(home) = std::env::var("HOME") {
                    env_map.insert("HOME".to_string(), home);
                }
                env_map
            }
        }
    }).clone()
}

/// Run a command with the full shell environment injected
pub fn run_command(cmd: &mut Command) -> CmdResult {
    // Inject full shell environment (PATH, HOME, KUBECONFIG, etc.)
    for (key, val) in get_shell_env() {
        cmd.env(key, val);
    }
    match cmd.output() {
        Ok(output) => CmdResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(e) => CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to execute command: {}", e),
        },
    }
}
