#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_yaml,
            save_and_apply_files,
            get_kubectl_contexts,
            switch_context,
            get_current_context,
            save_yaml_to_dir,
            run_kubectl,
            save_file,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::process::Command;

#[derive(Serialize)]
pub struct CmdResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Get the user's full shell environment by sourcing their shell profile.
/// This ensures KUBECONFIG, PATH, HOME etc. are all available.
fn get_shell_env() -> HashMap<String, String> {
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

/// Apply a single YAML string via kubectl apply
#[tauri::command]
fn apply_yaml(yaml: String, namespace: Option<String>) -> CmdResult {
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
fn save_and_apply_files(files: HashMap<String, String>, namespace: Option<String>) -> CmdResult {
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

/// Save YAML files to a user-specified directory
#[tauri::command]
fn save_yaml_to_dir(dir: String, files: HashMap<String, String>) -> CmdResult {
    let save_dir = std::path::PathBuf::from(&dir);
    
    if let Err(e) = fs::create_dir_all(&save_dir) {
        return CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create directory: {}", e),
        };
    }

    let mut saved_files = Vec::new();
    for (name, content) in &files {
        let file_path = save_dir.join(name);
        if let Err(e) = fs::write(&file_path, content) {
            return CmdResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to write {}: {}", name, e),
            };
        }
        saved_files.push(name.clone());
    }

    CmdResult {
        success: true,
        stdout: format!("Saved {} files to {}:\n{}", saved_files.len(), dir, saved_files.join("\n")),
        stderr: String::new(),
    }
}

/// Get list of kubectl contexts
#[tauri::command]
fn get_kubectl_contexts() -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("get-contexts").arg("-o").arg("name");
    run_command(&mut cmd)
}

/// Get current kubectl context
#[tauri::command]
fn get_current_context() -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("current-context");
    run_command(&mut cmd)
}

/// Switch kubectl context
#[tauri::command]
fn switch_context(context: String) -> CmdResult {
    let mut cmd = Command::new("kubectl");
    cmd.arg("config").arg("use-context").arg(&context);
    run_command(&mut cmd)
}

/// Save content to a specific file path
#[tauri::command]
fn save_file(path: String, content: String) -> CmdResult {
    let file_path = std::path::PathBuf::from(&path);
    if let Some(parent) = file_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return CmdResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to create directory: {}", e),
            };
        }
    }
    match fs::write(&file_path, &content) {
        Ok(_) => CmdResult {
            success: true,
            stdout: format!("Saved to {}", path),
            stderr: String::new(),
        },
        Err(e) => CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to write: {}", e),
        },
    }
}

/// Get user home directory
#[tauri::command]
fn get_home_dir() -> CmdResult {
    match std::env::var("HOME") {
        Ok(home) => CmdResult {
            success: true,
            stdout: home,
            stderr: String::new(),
        },
        Err(_) => CmdResult {
            success: false,
            stdout: String::new(),
            stderr: "Cannot get HOME".to_string(),
        },
    }
}

/// Run any kubectl command with args + optional stdin
#[tauri::command]
fn run_kubectl(args: Vec<String>, stdin_input: Option<String>) -> CmdResult {
    let mut cmd = Command::new("kubectl");
    for arg in &args {
        cmd.arg(arg);
    }
    if let Some(input) = stdin_input {
        use std::process::Stdio;
        cmd.stdin(Stdio::piped());
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

fn run_command(cmd: &mut Command) -> CmdResult {
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
