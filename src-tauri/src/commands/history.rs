use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use crate::types::CmdResult;

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub context: String,
    pub namespace: String,
    pub files: Vec<String>,
    pub yaml: String,
    pub success: bool,
    pub output: String,
}

/// Get the history directory path (~/.kubectl-ui/history/)
fn history_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".kubectl-ui").join("history")
}

/// Save a history entry after kubectl apply
#[tauri::command]
pub fn save_history(
    timestamp: String,
    context: String,
    namespace: String,
    files: Vec<String>,
    yaml: String,
    success: bool,
    output: String,
) -> CmdResult {
    let dir = history_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        return CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create history dir: {}", e),
        };
    }

    // Use current timestamp in millis as ID
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());

    let entry = HistoryEntry {
        id: id.clone(),
        timestamp,
        context,
        namespace,
        files,
        yaml,
        success,
        output,
    };

    let file_path = dir.join(format!("{}.json", id));
    match serde_json::to_string_pretty(&entry) {
        Ok(json) => {
            if let Err(e) = fs::write(&file_path, json) {
                return CmdResult {
                    success: false,
                    stdout: String::new(),
                    stderr: format!("Failed to write history: {}", e),
                };
            }
            CmdResult {
                success: true,
                stdout: id,
                stderr: String::new(),
            }
        }
        Err(e) => CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to serialize history: {}", e),
        },
    }
}

/// Get all history entries, sorted by timestamp descending (newest first)
#[tauri::command]
pub fn get_history() -> CmdResult {
    let dir = history_dir();
    if !dir.exists() {
        return CmdResult {
            success: true,
            stdout: "[]".to_string(),
            stderr: String::new(),
        };
    }

    let mut entries: Vec<HistoryEntry> = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(hist) = serde_json::from_str::<HistoryEntry>(&content) {
                        entries.push(hist);
                    }
                }
            }
        }
    }

    // Sort by ID desc (higher timestamp = newer)
    entries.sort_by(|a, b| b.id.cmp(&a.id));

    match serde_json::to_string(&entries) {
        Ok(json) => CmdResult {
            success: true,
            stdout: json,
            stderr: String::new(),
        },
        Err(e) => CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to serialize entries: {}", e),
        },
    }
}

/// Delete a single history entry by ID
#[tauri::command]
pub fn delete_history(id: String) -> CmdResult {
    let file_path = history_dir().join(format!("{}.json", id));
    if file_path.exists() {
        match fs::remove_file(&file_path) {
            Ok(_) => CmdResult {
                success: true,
                stdout: format!("Deleted history entry {}", id),
                stderr: String::new(),
            },
            Err(e) => CmdResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to delete: {}", e),
            },
        }
    } else {
        CmdResult {
            success: false,
            stdout: String::new(),
            stderr: format!("History entry {} not found", id),
        }
    }
}

/// Clear all history entries
#[tauri::command]
pub fn clear_history() -> CmdResult {
    let dir = history_dir();
    if !dir.exists() {
        return CmdResult {
            success: true,
            stdout: "No history to clear".to_string(),
            stderr: String::new(),
        };
    }

    let mut count = 0;
    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if fs::remove_file(&path).is_ok() {
                    count += 1;
                }
            }
        }
    }

    CmdResult {
        success: true,
        stdout: format!("Cleared {} history entries", count),
        stderr: String::new(),
    }
}
