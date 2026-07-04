// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    asyar_lib::apply_linux_webkit_dmabuf_workaround();
    asyar_lib::run()
}
