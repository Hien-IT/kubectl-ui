use std::collections::HashMap;
use std::fs;

use crate::types::CmdResult;

/// Save YAML files to a user-specified directory
#[tauri::command]
pub fn save_yaml_to_dir(dir: String, files: HashMap<String, String>) -> CmdResult {
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

/// Save content to a specific file path
#[tauri::command]
pub fn save_file(path: String, content: String) -> CmdResult {
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
pub fn get_home_dir() -> CmdResult {
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
