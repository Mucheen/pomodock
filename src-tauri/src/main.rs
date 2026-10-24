#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod storage;
mod windows;
mod window_geometry;

fn main() {
    windows::run();
}
