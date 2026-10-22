use crate::engine::Timer;
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}};

pub fn load(directory: &Path, legacy_root: Option<&Path>, now: i64) -> Result<Timer, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let path = directory.join("timer-state.json");
    if path.exists() { return read(&path, now); }
    if let Some(root) = legacy_root {
        for name in ["pomodock", "Pomodock"] {
            let original = root.join(name).join("timer-state.json");
            if original.exists() {
                let timer = read(&original, now)?;
                // Import once into a separate Lite directory. Keep Electron's file intact.
                let backup = directory.join("timer-state.imported-electron.json");
                if !backup.exists() { fs::copy(&original, &backup).map_err(|e| e.to_string())?; }
                save(directory, &timer)?;
                return Ok(timer);
            }
        }
    }
    let timer = Timer::load(&Value::Null, now);
    save(directory, &timer)?;
    Ok(timer)
}

fn read(path: &Path, now: i64) -> Result<Timer, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Cannot parse {}: {e}", path.display()))?;
    if !value.is_object() { return Err(format!("Invalid timer state: {}", path.display())); }
    Ok(Timer::load(&value, now))
}

pub fn save(directory: &Path, timer: &Timer) -> Result<(), String> {
    let path = directory.join("timer-state.json");
    let temporary = directory.join("timer-state.json.tmp");
    let bytes = serde_json::to_vec_pretty(timer).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())
}

pub fn override_directory() -> Option<PathBuf> { std::env::var_os("POMODOCK_LITE_DATA_DIR").map(PathBuf::from) }

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let root=std::env::temp_dir().join(format!("pomodock-import-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap(); root
    }
    #[test]
    fn imports_once_and_never_modifies_old_data() {
        let root=directory(); let old=root.join("old"); let lite=root.join("lite");
        fs::create_dir_all(old.join("pomodock")).unwrap();
        let raw=r#"{"completedFocusRounds":3,"cycleVersion":1,"cycleFocusRounds":2}"#;
        fs::write(old.join("pomodock/timer-state.json"),raw).unwrap();
        let timer=load(&lite,Some(&old),crate::engine::now()).unwrap();
        assert_eq!(timer.legacy_focus_rounds,3);
        assert_eq!(timer.cycle_focus_rounds,2);
        assert_eq!(fs::read_to_string(old.join("pomodock/timer-state.json")).unwrap(),raw);
        assert_eq!(fs::read_to_string(lite.join("timer-state.imported-electron.json")).unwrap(),raw);
        fs::write(old.join("pomodock/timer-state.json"),r#"{"completedFocusRounds":99}"#).unwrap();
        assert_eq!(load(&lite,Some(&old),crate::engine::now()).unwrap().completed_focus_rounds,3);
    }
    #[test]
    fn corrupt_legacy_file_is_reported_without_replacement() {
        let root=directory(); fs::create_dir_all(root.join("old/pomodock")).unwrap();
        fs::write(root.join("old/pomodock/timer-state.json"),"broken").unwrap();
        assert!(load(&root.join("lite"),Some(&root.join("old")),crate::engine::now()).is_err());
        assert!(!root.join("lite/timer-state.json").exists());
    }
}
