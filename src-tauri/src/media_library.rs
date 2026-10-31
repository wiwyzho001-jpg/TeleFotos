//! Android MediaStore bridge. Only these operations are exposed to the app WebView.
#[cfg(target_os = "android")]
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager};
#[cfg(target_os = "android")]
pub struct MediaLibrary(PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("media-library")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.telefotos.app", "MediaLibraryPlugin")?;
            app.manage(MediaLibrary(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn media_library_command(
    app: tauri::AppHandle,
    command: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !matches!(command.as_str(), "accessStatus" | "requestAccess" | "listMedia" | "thumbnail" | "prepare" | "release" | "networkStatus" | "share" | "trash" | "configurePhotoBackup" | "completeBackgroundBackup" | "nativeTelegramStatus" | "beginNativeTelegramLogin" | "submitNativeTelegramCode" | "submitNativeTelegramPassword" | "createDownload" | "appendDownload" | "finishDownload" | "abortDownload" | "installUpdate") {
        return Err("Unsupported media operation".into());
    }
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<MediaLibrary>().0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            handle.run_mobile_plugin::<serde_json::Value>(&command, payload.unwrap_or_else(|| serde_json::json!({})))
                .map_err(|error| error.to_string())
        }).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (app, payload); Err("MediaStore is available on Android".into()) }
}
