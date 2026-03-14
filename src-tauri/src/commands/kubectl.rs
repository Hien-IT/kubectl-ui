use std::collections::HashMap;
use std::fs;
use std::process::Command;

use crate::types::CmdResult;
use crate::shell::run_command;

/// Apply a single YAML string via kubectl apply
#[tauri::command]
pub fn apply_yaml(yaml: String, namespace: Option<String>) -> CmdResult {
    let tmp_dir = std::env::temp_dir().join("kubectl-ui");
    fs::create_dir_all(&tmp_dir).ok();
    let tmp_file = tmp_dir.join("apply.yaml");
    
    if let Err(e) = fs::write(&tmp_file, &yaml) {
        return CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to write temp file: {}", e),
        };
    }

    let mut cmd = Command::new("kubectl");
    cmd.arg("apply").arg("-f").arg(&tmp_file);
    
    if let Some(ns) = namespace {
        if !ns.is_empty() {
            cmd.arg("-n").arg(&ns);
        }
    }

    run_command(&mut cmd)
}

/// Save multiple YAML files to a temp directory and apply them all
#[tauri::command]
pub fn save_and_apply_files(files: HashMap<String, String>, namespace: Option<String>) -> CmdResult {
    let tmp_dir = std::env::temp_dir().join("kubectl-ui").join("manifests");
    
    // Clean and recreate
    if tmp_dir.exists() {
        fs::remove_dir_all(&tmp_dir).ok();
    }
    fs::create_dir_all(&tmp_dir).ok();

    // Write each file
    for (name, content) in &files {
        let file_path = tmp_dir.join(name);
        if let Err(e) = fs::write(&file_path, content) {
            return CmdResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to write {}: {}", name, e),
            };
        }
    }

    // Apply the entire directory
    let mut cmd = Command::new("kubectl");
    cmd.arg("apply").arg("-f").arg(&tmp_dir);
    
    if let Some(ns) = namespace {
        if !ns.is_empty() {
            cmd.arg("-n").arg(&ns);
        }
    }

    run_command(&mut cmd)
}

/// Get list of kubectl contexts
#[tauri::command]
pub fn get_kubectl_contexts() -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("get-contexts").arg("-o").arg("name");
    run_command(&mut cmd)
}

/// Get current kubectl context
#[tauri::command]
pub fn get_current_context() -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("current-context");
    run_command(&mut cmd)
}

/// Switch kubectl context
#[tauri::command]
pub fn switch_context(context: String) -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("use-context").arg(&context);
    run_command(&mut cmd)
}

/// Run any kubectl command with args + optional stdin
#[tauri::command]
pub fn run_kubectl(args: Vec<String>, stdin_input: Option<String>) -> CmdResult {
    let mut cmd = Command::new("kubectl");
    for arg in &args {
        cmd.arg(arg);
    }
    if let Some(input) = stdin_input {
        use std::process::Stdio;
        cmd.stdin(Stdio::piped());

        // Inject shell env before spawning
        for (key, val) in crate::shell::get_shell_env() {
            cmd.env(key, val);
        }

        match cmd.spawn() {
            Ok(mut child) => {
                use std::io::Write;
                if let Some(mut child_stdin) = child.stdin.take() {
                    let _ = child_stdin.write_all(input.as_bytes());
                }
                match child.wait_with_output() {
                    Ok(output) => CmdResult {
                        success: output.status.success(),
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    },
                    Err(e) => CmdResult {
                        success: false,
                        stdout: String::new(),
                        stderr: format!("Failed: {}", e),
                    },
                }
            }
            Err(e) => CmdResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to spawn: {}", e),
            },
        }
    } else {
        run_command(&mut cmd)
    }
}
