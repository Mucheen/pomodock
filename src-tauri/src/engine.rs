use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub fn now() -> i64 {
    Local::now().timestamp_millis()
}

pub fn day(timestamp: i64) -> String {
    Local.timestamp_millis_opt(timestamp).single().unwrap().format("%Y-%m-%d").to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub focus_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub rounds_before_long_break: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 25, rounds_before_long_break: 4 }
    }
}

impl Config {
    pub fn from_value(value: &Value) -> Self {
        fn number(v: &Value, key: &str, default: u32, max: u32, min: u32) -> u32 {
            let parsed = v[key].as_f64().or_else(|| v[key].as_str().and_then(|s| s.parse().ok()));
            parsed.filter(|n| n.is_finite()).map(|n| n.round().clamp(min as f64, max as f64) as u32).unwrap_or(default)
        }
        Self {
            focus_minutes: number(value, "focusMinutes", 25, 180, 1),
            short_break_minutes: number(value, "shortBreakMinutes", 5, 60, 1),
            long_break_minutes: number(value, "longBreakMinutes", 25, 120, 1),
            rounds_before_long_break: number(value, "roundsBeforeLongBreak", 4, 12, 2),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub focus_rounds: u64,
    pub focus_minutes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExpandedSize {
    pub width: f64,
    pub height: f64,
}

impl Default for ExpandedSize {
    fn default() -> Self { Self { width: 392.0, height: 620.0 } }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EdgePosition {
    pub monitor_name: Option<String>,
    pub ratio: f64,
}

impl Default for EdgePosition {
    fn default() -> Self { Self { monitor_name: None, ratio: 0.5 } }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub config: Config,
    pub phase: String,
    pub status: String,
    pub remaining_ms: i64,
    pub target_end_at: Option<i64>,
    pub statistics_version: u32,
    pub statistics_date: String,
    pub daily_records: BTreeMap<String, Record>,
    pub legacy_focus_rounds: u64,
    pub completed_focus_rounds: u64,
    pub cycle_version: u32,
    pub cycle_focus_rounds: u32,
    pub alarm: bool,
    pub next_phase: Option<String>,
    pub edge_position: EdgePosition,
    pub expanded_size: ExpandedSize,
    #[serde(skip)]
    pub collapsed: bool,
}

#[derive(Debug, PartialEq)]
pub enum Tick { Unchanged, DateChanged, Running, Completed }

impl Timer {
    pub fn load(value: &Value, now: i64) -> Self {
        let config = Config::from_value(&value["config"]);
        let mut records = BTreeMap::new();
        if let Some(items) = value["dailyRecords"].as_object() {
            for (date, item) in items {
                let valid = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok().is_some_and(|d| d.format("%Y-%m-%d").to_string() == *date);
                let count = item["focusRounds"].as_u64().unwrap_or(0);
                if valid && count > 0 {
                    records.insert(date.clone(), Record { focus_rounds: count, focus_minutes: item["focusMinutes"].as_u64().unwrap_or(0) });
                }
            }
        }
        let dated: u64 = records.values().map(|r| r.focus_rounds).sum();
        let previous = value["completedFocusRounds"].as_u64().unwrap_or(0);
        let legacy = if value["statisticsVersion"] == 1 { value["legacyFocusRounds"].as_u64().unwrap_or(0) } else { previous.saturating_sub(dated) };
        let phase = value["phase"].as_str().filter(|p| ["focus", "shortBreak", "longBreak"].contains(p)).unwrap_or("focus").to_string();
        let mut status = value["status"].as_str().filter(|s| ["idle", "running", "paused"].contains(s)).unwrap_or("idle").to_string();
        let target = value["targetEndAt"].as_i64().filter(|t| Local.timestamp_millis_opt(*t).single().is_some());
        if status == "running" && target.is_none() { status = "paused".into(); }
        let cycle = if value["cycleVersion"] == 1 { value["cycleFocusRounds"].as_u64().unwrap_or(0).min(config.rounds_before_long_break as u64) as u32 } else { 0 };
        let mut size: ExpandedSize = serde_json::from_value(value["expandedSize"].clone()).unwrap_or_default();
        size.width = size.width.clamp(320.0, 2000.0);
        size.height = size.height.clamp(500.0, 2000.0);
        let mut position: EdgePosition = serde_json::from_value(value["edgePosition"].clone()).unwrap_or_default();
        position.ratio = position.ratio.clamp(0.0, 1.0);
        let duration = Self::duration_of(&config, &phase);
        Self {
            config, phase, status, remaining_ms: value["remainingMs"].as_i64().unwrap_or(duration).max(0), target_end_at: target,
            statistics_version: 1, statistics_date: day(now), daily_records: records,
            completed_focus_rounds: previous.max(dated + legacy), legacy_focus_rounds: legacy,
            cycle_version: 1, cycle_focus_rounds: cycle,
            alarm: value["alarm"].as_bool().unwrap_or(false),
            next_phase: value["nextPhase"].as_str().filter(|p| ["focus", "shortBreak", "longBreak"].contains(p)).map(String::from),
            edge_position: position, expanded_size: size, collapsed: false,
        }
    }

    fn duration_of(config: &Config, phase: &str) -> i64 {
        let minutes = match phase { "shortBreak" => config.short_break_minutes, "longBreak" => config.long_break_minutes, _ => config.focus_minutes };
        minutes as i64 * 60_000
    }

    pub fn remaining(&self, now: i64) -> i64 {
        if self.status == "running" { (self.target_end_at.unwrap_or(now) - now).max(0) } else { self.remaining_ms.max(0) }
    }

    pub fn public(&self, now: i64) -> Value {
        let mut value = serde_json::to_value(self).unwrap();
        value.as_object_mut().unwrap().remove("dailyRecords");
        value["remainingMs"] = json!(self.remaining(now));
        value["collapsed"] = json!(self.collapsed);
        value["statisticsDate"] = json!(day(now));
        let record = self.daily_records.get(&day(now));
        value["todayFocusRounds"] = json!(record.map_or(0, |r| r.focus_rounds));
        value["todayFocusMinutes"] = json!(record.map_or(0, |r| r.focus_minutes));
        value
    }

    pub fn history(&self) -> Value {
        json!({ "dailyRecords": self.daily_records, "legacyFocusRounds": self.legacy_focus_rounds })
    }

    pub fn tick(&mut self, now: i64) -> Tick {
        let changed = self.statistics_date != day(now);
        self.statistics_date = day(now);
        if self.status != "running" { return if changed { Tick::DateChanged } else { Tick::Unchanged }; }
        self.remaining_ms = self.remaining(now);
        if self.remaining_ms > 0 { return Tick::Running; }
        let completed_at = self.target_end_at.unwrap_or(now);
        self.target_end_at = None;
        self.status = "idle".into();
        self.alarm = true;
        self.next_phase = Some(if self.phase == "focus" {
            if self.cycle_focus_rounds + 1 >= self.config.rounds_before_long_break { "longBreak" } else { "shortBreak" }
        } else { "focus" }.into());
        if self.phase == "focus" {
            let record = self.daily_records.entry(day(completed_at)).or_default();
            record.focus_rounds += 1;
            record.focus_minutes += self.config.focus_minutes as u64;
            self.completed_focus_rounds += 1;
            self.cycle_focus_rounds = (self.cycle_focus_rounds + 1).min(self.config.rounds_before_long_break);
        } else if self.phase == "longBreak" { self.cycle_focus_rounds = 0; }
        self.collapsed = false;
        Tick::Completed
    }

    fn switch(&mut self, phase: String) {
        self.phase = phase;
        self.remaining_ms = Self::duration_of(&self.config, &self.phase);
        self.status = "idle".into();
        self.alarm = false;
        self.next_phase = None;
        self.target_end_at = None;
    }

    fn finish(&mut self, start: bool, now: i64) {
        if !self.alarm { return; }
        self.switch(self.next_phase.clone().unwrap_or_else(|| "focus".into()));
        if start { self.status = "running".into(); self.target_end_at = Some(now + self.remaining_ms); }
    }

    pub fn action(&mut self, action: &str, payload: &Value, now: i64) -> Result<(), String> {
        match action {
            "start" if !self.alarm && self.status != "running" => {
                if self.remaining_ms <= 0 { self.remaining_ms = Self::duration_of(&self.config, &self.phase); }
                self.target_end_at = Some(now + self.remaining_ms); self.status = "running".into();
            }
            "pause" if self.status == "running" => { self.remaining_ms = self.remaining(now); self.target_end_at = None; self.status = "paused".into(); }
            "reset" => {
                if self.alarm { self.finish(false, now); } else { self.switch(self.phase.clone()); }
            }
            "skip" => {
                if self.alarm { self.finish(false, now); } else {
                    if self.phase == "longBreak" { self.cycle_focus_rounds = 0; }
                    self.switch(if self.phase == "focus" { "shortBreak" } else { "focus" }.into());
                }
            }
            "finish-alarm" => self.finish(payload.as_bool().unwrap_or(false), now),
            "configure" => { self.config = Config::from_value(payload); self.cycle_focus_rounds = 0; self.switch("focus".into()); }
            "collapse" => self.collapsed = payload.as_bool().unwrap_or(false),
            "start" | "pause" => {},
            _ => return Err(format!("Unknown timer action: {action}")),
        }
        self.statistics_date = day(now);
        Ok(())
    }

    pub fn delay(&self, now: i64) -> u64 {
        // Check at least once per second to catch resume and system clock changes,
        // but only send a state update when the displayed second/minute changes.
        if self.status == "running" { self.remaining(now).clamp(1, 1000) as u64 } else { 1000 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(day: u32, hour: u32, minute: u32) -> i64 { Local.with_ymd_and_hms(2026, 10, day, hour, minute, 0).single().unwrap().timestamp_millis() }
    #[test]
    fn two_cycles_follow_25_5_25_and_daily_totals() {
        let mut time = at(22, 8, 0);
        let mut timer = Timer::load(&json!({}), time);
        timer.action("start", &Value::Null, time).unwrap();
        for group in 0..2 {
            for round in 1..=4 {
                assert_eq!(timer.phase, "focus");
                time = timer.target_end_at.unwrap();
                assert_eq!(timer.tick(time), Tick::Completed);
                assert_eq!(timer.cycle_focus_rounds, round);
                assert_eq!(timer.public(time)["todayFocusRounds"], group * 4 + round);
                assert_eq!(timer.next_phase.as_deref(), Some(if round == 4 { "longBreak" } else { "shortBreak" }));
                timer.action("finish-alarm", &json!(true), time).unwrap();
                assert_eq!(timer.remaining_ms, if round == 4 { 25 } else { 5 } * 60_000);
                time = timer.target_end_at.unwrap(); timer.tick(time);
                timer.action("finish-alarm", &json!(true), time).unwrap();
            }
        }
        assert_eq!(timer.cycle_focus_rounds, 0);
        assert_eq!(timer.completed_focus_rounds, 8);
        assert_eq!(timer.public(time)["todayFocusMinutes"], 200);
    }
    #[test]
    fn reopen_and_overdue_completion_use_original_date_once() {
        let old = at(20, 23, 58); let today = at(22, 9, 0);
        let mut timer = Timer::load(&json!({"status":"running", "phase":"focus", "targetEndAt":old, "cycleVersion":1, "cycleFocusRounds":2}), today);
        assert_eq!(timer.tick(today), Tick::Completed);
        assert_eq!(timer.public(today)["todayFocusRounds"], 0);
        assert_eq!(timer.daily_records["2026-10-20"].focus_rounds, 1);
        assert_eq!(timer.tick(today), Tick::Unchanged);
        assert_eq!(timer.completed_focus_rounds, 1);
        assert_eq!(timer.cycle_focus_rounds, 3);
    }
    #[test]
    fn midnight_preserves_deadline_and_group() {
        let mut timer = Timer::load(&json!({"cycleVersion":1,"cycleFocusRounds":3}), at(21,23,50));
        timer.action("start", &Value::Null, at(21,23,50)).unwrap();
        let deadline = timer.target_end_at;
        timer.tick(at(22,0,0));
        assert_eq!(timer.target_end_at, deadline);
        assert_eq!(timer.public(at(22,0,0))["todayFocusRounds"], 0);
        timer.tick(deadline.unwrap());
        assert_eq!(timer.next_phase.as_deref(), Some("longBreak"));
    }
    #[test]
    fn migration_keeps_undated_totals_and_dated_records() {
        let value = json!({"completedFocusRounds":5,"phase":"shortBreak","statisticsVersion":1,"legacyFocusRounds":3,"cycleVersion":1,"cycleFocusRounds":2,"dailyRecords":{"2026-10-20":{"focusRounds":2,"focusMinutes":50},"2026-02-29":{"focusRounds":5}}});
        let mut timer = Timer::load(&value, at(22,9,0));
        assert_eq!(timer.public(at(22,9,0))["todayFocusRounds"],0);
        assert_eq!(timer.completed_focus_rounds,5);
        assert_eq!(timer.legacy_focus_rounds,3);
        assert_eq!(timer.daily_records.len(),1);
        timer.action("skip",&Value::Null,at(22,9,0)).unwrap();
        timer.action("reset",&Value::Null,at(22,9,0)).unwrap();
        assert_eq!(timer.completed_focus_rounds,5);
        let reloaded=Timer::load(&serde_json::to_value(timer).unwrap(),at(22,9,0));
        assert_eq!(reloaded.legacy_focus_rounds,3);
        let legacy=Timer::load(&json!({"completedFocusRounds":3}),at(22,9,0));
        assert_eq!(legacy.legacy_focus_rounds,3);
        assert_eq!(legacy.cycle_focus_rounds,0);
    }
    #[test]
    fn reset_and_skip_at_fourth_alarm_keep_long_break() {
        for action in ["reset","skip"] {
            let mut timer=Timer::load(&json!({"phase":"focus","alarm":true,"nextPhase":"longBreak","cycleVersion":1,"cycleFocusRounds":4}),at(22,9,0));
            timer.action(action,&Value::Null,at(22,9,0)).unwrap();
            assert_eq!(timer.phase,"longBreak"); assert_eq!(timer.cycle_focus_rounds,4);
        }
    }
    #[test]
    fn config_save_resets_group_but_preserves_history_and_resizing() {
        let mut timer=Timer::load(&json!({"completedFocusRounds":2,"expandedSize":{"width":450,"height":700}}),at(22,9,0));
        timer.action("configure",&json!({"focusMinutes":"30","shortBreakMinutes":999,"longBreakMinutes":25,"roundsBeforeLongBreak":4}),at(22,9,0)).unwrap();
        assert_eq!(timer.remaining_ms,30*60_000); assert_eq!(timer.config.short_break_minutes,60);
        assert_eq!(timer.completed_focus_rounds,2); assert_eq!(timer.expanded_size.width,450.0);
        assert!(timer.public(at(22,9,0)).get("dailyRecords").is_none());
    }
    #[test]
    fn pause_and_restart_keep_remaining_time() {
        let time=at(22,9,0); let mut timer=Timer::load(&json!({}),time);
        timer.action("start",&Value::Null,time).unwrap();
        timer.action("pause",&Value::Null,time+10_000).unwrap();
        assert_eq!(timer.remaining_ms,25*60_000-10_000);
        let mut reloaded=Timer::load(&serde_json::to_value(&timer).unwrap(),time+60_000);
        reloaded.action("start",&Value::Null,time+60_000).unwrap();
        assert_eq!(reloaded.target_end_at,Some(time+60_000+timer.remaining_ms));
    }
}
