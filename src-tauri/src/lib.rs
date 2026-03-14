mod types;
mod shell;
mod commands;

pub use types::CmdResult;

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
            commands::kubectl::apply_yaml,
            commands::kubectl::save_and_apply_files,
            commands::kubectl::get_kubectl_contexts,
            commands::kubectl::switch_context,
            commands::kubectl::get_current_context,
            commands::kubectl::run_kubectl,
            commands::files::save_yaml_to_dir,
            commands::files::save_file,
            commands::files::get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
