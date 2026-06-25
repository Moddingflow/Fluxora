#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fluxora_tauri_lib::run();
}
