use crate::{engine::{self, Tick, Timer}, storage};
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

struct Runtime {
    timer: Timer,
    directory: PathBuf,
    gesture: Option<Gesture>,
}

#[derive(Clone)]
struct Gesture {
    kind: String,
    cursor: (f64, f64),
    bounds: (f64, f64, f64, f64),
    area: (f64, f64, f64, f64),
    scale: f64,
    moved: bool,
}

type Shared = Mutex<Runtime>;

fn error(e: impl std::fmt::Display) -> String { e.to_string() }

fn monitor(window: &WebviewWindow, timer: &Timer) -> Result<tauri::Monitor, String> {
    let monitors = window.available_monitors().map_err(error)?;
    monitors.iter().find(|m| timer.edge_position.monitor_name.is_some() && m.name() == timer.edge_position.monitor_name.as_ref()).cloned()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned()).ok_or_else(|| "No display available".into())
}

fn place(window: &WebviewWindow, timer: &Timer) -> Result<(), String> {
    let display = monitor(window, timer)?;
    let scale = display.scale_factor();
    let area = display.work_area();
    let width = if timer.collapsed { 36.0 } else { timer.expanded_size.width.min(area.size.width as f64 / scale) };
    let height = if timer.collapsed { 76.0 } else { timer.expanded_size.height.min(area.size.height as f64 / scale) };
    let tab_y = area.position.y as f64 + (area.size.height as f64 - 76.0 * scale).max(0.0) * timer.edge_position.ratio;
    let y = (tab_y + 38.0 * scale - height * scale / 2.0).clamp(area.position.y as f64, area.position.y as f64 + (area.size.height as f64 - height * scale).max(0.0));
    window.set_size(PhysicalSize::new((width * scale).round() as u32, (height * scale).round() as u32)).map_err(error)?;
    window.set_position(PhysicalPosition::new(area.position.x + area.size.width as i32 - (width * scale).round() as i32, y.round() as i32)).map_err(error)
}

fn publish(window: &WebviewWindow, timer: &Timer) -> Result<(), String> {
    window.emit("timer:state", timer.public(engine::now())).map_err(error)
}

#[tauri::command]
fn get_state(shared: tauri::State<Shared>) -> Result<Value, String> {
    Ok(shared.lock().map_err(error)?.timer.public(engine::now()))
}

#[tauri::command]
fn get_history(shared: tauri::State<Shared>) -> Result<Value, String> {
    Ok(shared.lock().map_err(error)?.timer.history())
}

#[tauri::command]
fn timer_action(window: WebviewWindow, shared: tauri::State<Shared>, action: String, payload: Value) -> Result<Value, String> {
    let mut runtime = shared.lock().map_err(error)?;
    let now=engine::now();
    runtime.timer.tick(now);
    runtime.timer.action(&action, &payload, now)?;
    if action == "collapse" { runtime.gesture = None; place(&window, &runtime.timer)?; }
    storage::save(&runtime.directory, &runtime.timer)?;
    publish(&window, &runtime.timer)?;
    Ok(runtime.timer.public(engine::now()))
}

#[tauri::command]
fn quit(app: tauri::AppHandle, shared: tauri::State<Shared>) -> Result<(), String> {
    let runtime = shared.lock().map_err(error)?;
    storage::save(&runtime.directory, &runtime.timer)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn gesture_start(window: WebviewWindow, shared: tauri::State<Shared>, kind: String) -> Result<(), String> {
    let mut runtime = shared.lock().map_err(error)?;
    if (runtime.timer.collapsed && kind != "drag") || (!runtime.timer.collapsed && !["n","s","e","w","ne","nw","se","sw"].contains(&kind.as_str())) { return Ok(()); }
    let display = monitor(&window, &runtime.timer)?;
    let cursor = window.cursor_position().map_err(error)?;
    let position = window.outer_position().map_err(error)?;
    let size = window.outer_size().map_err(error)?;
    let area = display.work_area();
    runtime.timer.edge_position.monitor_name = display.name().cloned();
    runtime.gesture = Some(Gesture { kind, cursor:(cursor.x,cursor.y), bounds:(position.x as f64,position.y as f64,size.width as f64,size.height as f64), area:(area.position.x as f64,area.position.y as f64,area.size.width as f64,area.size.height as f64), scale:display.scale_factor(), moved:false });
    Ok(())
}

#[tauri::command]
fn gesture_move(window: WebviewWindow, shared: tauri::State<Shared>) -> Result<(), String> {
    let mut runtime = shared.lock().map_err(error)?;
    let Some(mut gesture) = runtime.gesture.clone() else { return Ok(()); };
    let cursor = window.cursor_position().map_err(error)?;
    let dx = cursor.x - gesture.cursor.0; let dy = cursor.y - gesture.cursor.1;
    if gesture.kind == "drag" {
        if !gesture.moved && dy.abs() < 4.0 * gesture.scale { return Ok(()); }
        let travel = (gesture.area.3 - 76.0 * gesture.scale).max(0.0);
        runtime.timer.edge_position.ratio = if travel > 0.0 { ((gesture.bounds.1 + dy - gesture.area.1) / travel).clamp(0.0,1.0) } else { 0.0 };
        place(&window, &runtime.timer)?;
    } else {
        let (mut x,mut y,w,h)=gesture.bounds; let mut right=x+w; let mut bottom=y+h;
        let min_w=(320.0 * gesture.scale).min(gesture.area.2);
        let min_h=(500.0 * gesture.scale).min(gesture.area.3);
        if gesture.kind.contains('w') { x=(x+dx).clamp(gesture.area.0,right-min_w); }
        if gesture.kind.contains('e') { right=(right+dx).clamp(x+min_w,gesture.area.0+gesture.area.2); }
        if gesture.kind.contains('n') { y=(y+dy).clamp(gesture.area.1,bottom-min_h); }
        if gesture.kind.contains('s') { bottom=(bottom+dy).clamp(y+min_h,gesture.area.1+gesture.area.3); }
        runtime.timer.expanded_size.width=(right-x)/gesture.scale;
        runtime.timer.expanded_size.height=(bottom-y)/gesture.scale;
        window.set_size(PhysicalSize::new((right-x).round() as u32,(bottom-y).round() as u32)).map_err(error)?;
        window.set_position(PhysicalPosition::new(x.round() as i32,y.round() as i32)).map_err(error)?;
    }
    gesture.moved=true; runtime.gesture=Some(gesture);
    Ok(())
}

#[tauri::command]
fn gesture_end(shared: tauri::State<Shared>) -> Result<(), String> {
    let mut runtime=shared.lock().map_err(error)?;
    if runtime.gesture.take().is_some_and(|g|g.moved) { storage::save(&runtime.directory,&runtime.timer)?; }
    Ok(())
}

fn expand(app: &tauri::AppHandle) {
    if let (Some(window), Some(shared))=(app.get_webview_window("main"),app.try_state::<Shared>()) {
        let timer=if let Ok(mut runtime)=shared.lock() {
            runtime.timer.collapsed=false;
            runtime.gesture=None;
            Some(runtime.timer.clone())
        } else { None };
        // Never hold the timer mutex while a background thread waits on the UI.
        if let Some(timer)=timer {
            if let Err(e)=place(&window,&timer).and_then(|_|publish(&window,&timer)) { eprintln!("{e}"); }
        }
        let _=window.show(); let _=window.set_focus();
    }
}

pub fn run() {
    let builder=tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_|expand(app)))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let override_dir=storage::override_directory();
            let directory=override_dir.clone().unwrap_or(app.path().app_data_dir()?);
            let old_root=if override_dir.is_some() { None } else { Some(app.path().config_dir()?) };
            let timer=storage::load(&directory,old_root.as_deref(),engine::now()).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(Runtime { timer,directory,gesture:None }));
            let window=app.get_webview_window("main").unwrap();
            {
                let shared=app.state::<Shared>(); let runtime=shared.lock().unwrap();
                place(&window,&runtime.timer).map_err(std::io::Error::other)?;
            }
            let _=window.set_visible_on_all_workspaces(true);
            window.show()?;
            #[cfg(feature="smoke-test")]
            {
                let smoke_window=window.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(2));
                    let _=smoke_window.eval(include_str!("../../scripts/lite-smoke.js"));
                });
            }
            let handle=app.handle().clone();
            thread::spawn(move || {
                let mut last_view=String::new();
                loop {
                    let Some(window)=handle.get_webview_window("main") else { break; };
                    let (delay,completed,notification)={
                        let shared=handle.state::<Shared>();
                        let mut runtime=shared.lock().unwrap();
                        let now=engine::now();
                        let change=runtime.timer.tick(now);
                        if change==Tick::Completed || change==Tick::DateChanged {
                            if let Err(e)=storage::save(&runtime.directory,&runtime.timer) { eprintln!("Unable to save timer: {e}"); }
                        }
                        let view=runtime.timer.public(now);
                        let quantum=if runtime.timer.collapsed {60_000} else {1000};
                        let key=format!("{}:{}:{}:{}:{}:{}",runtime.timer.statistics_date,runtime.timer.status,runtime.timer.phase,(runtime.timer.remaining(now)+quantum-1)/quantum,runtime.timer.alarm,runtime.timer.collapsed);
                        if key!=last_view { let _=window.emit("timer:state",view); last_view=key; }
                        let notice=if runtime.timer.phase=="focus" { "专注完成，起来活动一下吧。" } else { "休息结束，准备好后开始专注。" };
                        (runtime.timer.delay(now),change==Tick::Completed,notice)
                    };
                    if completed {
                        expand(&handle);
                        if let Err(e)=handle.notification().builder().title("Pomodock Lite").body(notification).show() { eprintln!("Notification: {e}"); }
                    }
                    thread::sleep(Duration::from_millis(delay));
                }
            });
            Ok(())
        });
    #[cfg(not(feature="smoke-test"))]
    let builder=builder.invoke_handler(tauri::generate_handler![get_state,get_history,timer_action,quit,gesture_start,gesture_move,gesture_end]);
    #[cfg(feature="smoke-test")]
    let builder=builder.invoke_handler(tauri::generate_handler![get_state,get_history,timer_action,quit,gesture_start,gesture_move,gesture_end,smoke_step]);
    let app=builder.build(tauri::generate_context!()).expect("Unable to start Pomodock Lite");
    app.run(|handle,event| {
        if let tauri::RunEvent::ExitRequested{..}=event {
            let shared=handle.state::<Shared>();
            if let Ok(runtime)=shared.lock() { let _=storage::save(&runtime.directory,&runtime.timer); };
        }
    });
}

#[cfg(feature="smoke-test")]
#[tauri::command]
fn smoke_step(app: tauri::AppHandle, window: WebviewWindow, shared: tauri::State<Shared>, step: String, payload: Value) -> Result<Value,String> {
    use serde_json::json;
    // This command does not exist in distributable release builds.
    if storage::override_directory().is_none() { return Err("Smoke tests require an isolated data directory".into()); }
    match step.as_str() {
        "seed" => {
            let mut runtime=shared.lock().map_err(error)?;
            runtime.timer=Timer::load(&json!({"phase":"focus","remainingMs":1500,"cycleVersion":1,"cycleFocusRounds":0,"statisticsVersion":1,"dailyRecords":{ "2026-10-20":{"focusRounds":2,"focusMinutes":50} }}),engine::now());
            storage::save(&runtime.directory,&runtime.timer)?;
            publish(&window,&runtime.timer)?;
        }
        "resize" => {
            let mut runtime=shared.lock().map_err(error)?;
            runtime.timer.expanded_size=crate::engine::ExpandedSize { width:320.0,height:500.0 };
            runtime.timer.edge_position.ratio=0.2;
            place(&window,&runtime.timer)?;
            storage::save(&runtime.directory,&runtime.timer)?;
        }
        "bounds" => {
            return Ok(json!({"size":window.inner_size().map_err(error)?,"position":window.outer_position().map_err(error)?,"scale":window.scale_factor().map_err(error)?}));
        }
        "finish" => {
            let runtime=shared.lock().map_err(error)?;
            std::fs::write(runtime.directory.join("smoke-report.json"),serde_json::to_vec_pretty(&payload).unwrap()).map_err(error)?;
            app.exit(if payload["passed"]==true {0} else {1});
        }
        _=>return Err("Unknown smoke step".into()),
    }
    Ok(Value::Null)
}
