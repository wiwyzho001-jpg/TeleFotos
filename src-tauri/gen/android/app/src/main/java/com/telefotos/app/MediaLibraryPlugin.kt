package com.telefotos.app

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.ImageDecoder
import android.graphics.Bitmap
import android.media.ThumbnailUtils
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Size
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.io.OutputStream

@InvokeArg
internal class MediaArgs {
    var uri: String = ""
    var uris: List<String> = emptyList()
    var path: String = ""
    var offset: Int = 0
    var limit: Int = 250
    var restore: Boolean = false
    var preview: Boolean = false
}

@InvokeArg
internal class BackupArgs {
    var phone: String = ""
    var enabled: Boolean = false
    var wifiOnly: Boolean = true
    var runNow: Boolean = false
    var requestId: String = ""
    var outcome: String = "retry"
    var storageChannelId: String = ""
    var metadataChannelId: String = ""
    var folders: List<String> = emptyList()
    var allFolders: Boolean = true
}

@InvokeArg
internal class NativeAuthArgs {
    var phone: String = ""
    var code: String = ""
    var password: String = ""
    var apiId: Int = 0
    var apiHash: String = ""
}

@InvokeArg
internal class DownloadArgs {
    var name: String = ""
    var mime: String = ""
    var token: String = ""
    var data: String = ""
    var size: Long = 0
}

@InvokeArg
internal class UpdateArgs {
    var url: String = ""
    var sha256: String = ""
}

@TauriPlugin(permissions = [
    Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "legacy"),
    Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO], alias = "media"),
    Permission(strings = [Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED], alias = "selected")
])
class MediaLibraryPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Download(val uri: Uri, val stream: OutputStream, val size: Long, var written: Long = 0)
    private val downloads = ConcurrentHashMap<String, Download>()
    private val executor = Executors.newFixedThreadPool(2)
    private val resolver get() = activity.contentResolver
    private val cacheDir get() = File(activity.cacheDir, "telefotos").apply { mkdirs() }
    @Volatile private var pendingUpdateApk: File? = null
    private val preferences = activity.getSharedPreferences("telefotos-media", 0)
    private val deviceId: String by lazy {
        preferences.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("deviceId", it).apply()
        }
    }
    override fun load(webView: WebView) {
        PhotoBackupRuntime.attach(webView)
    }
    init {
        // Originals staged by an interrupted process are disposable, not user files.
        executor.execute {
            val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
            cacheDir.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
        }
    }
    private fun granted(permission: String) = Build.VERSION.SDK_INT < 23 || activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun access(): JSObject {
        val images = if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.READ_MEDIA_IMAGES) else granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        val videos = if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.READ_MEDIA_VIDEO) else images
        val partial = Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        return JSObject().put("images", images).put("videos", videos).put("partial", partial).put("available", images || videos || partial)
    }
    // Restrict every incoming URI to the shared image/video MediaStore collections.
    private fun mediaUri(value: String): Uri {
        val uri = Uri.parse(value)
        require(uri.scheme == "content" && uri.authority == "media") { "URI de medios no válida" }
        require(Regex("^/(external|external_primary)/((images|video)/media|file)/[0-9]+$").matches(uri.path ?: "")) { "Colección no válida" }
        return uri
    }
    private fun io(invoke: Invoke, block: () -> JSObject) {
        executor.execute {
            try { invoke.resolve(block()) }
            catch (error: Exception) { invoke.reject(error.message ?: "No se pudo leer el archivo") }
        }
    }
    @Command fun accessStatus(invoke: Invoke) { invoke.resolve(access()) }
    @Command fun requestAccess(invoke: Invoke) {
        val aliases = when {
            Build.VERSION.SDK_INT >= 34 -> arrayOf("media", "selected")
            Build.VERSION.SDK_INT >= 33 -> arrayOf("media")
            else -> arrayOf("legacy")
        }
        requestPermissionForAliases(aliases, invoke, "accessResult")
    }
    @PermissionCallback fun accessResult(invoke: Invoke) { invoke.resolve(access()) }

    @Command fun configurePhotoBackup(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(BackupArgs::class.java)
            if (args.enabled) {
                require(args.storageChannelId.isNotBlank()) { "Primero conecta la cuenta de Telegram en los ajustes" }
                NativeTelegram.requireAuthorized(activity.applicationContext, args.phone)
            }
            PhotoBackupScheduler.configure(activity, args.phone, args.enabled, args.wifiOnly, args.runNow,
                args.storageChannelId, args.metadataChannelId, args.folders, args.allFolders)
            invoke.resolve(JSObject().put("scheduled", args.enabled))
        } catch (error: Exception) {
            invoke.reject(error.message ?: "No se pudo programar el respaldo")
        }
    }

    @Command fun completeBackgroundBackup(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(BackupArgs::class.java)
            val outcome = when (args.outcome) {
                "success" -> PhotoBackupRuntime.Outcome.SUCCESS
                "disabled" -> PhotoBackupRuntime.Outcome.DISABLED
                else -> PhotoBackupRuntime.Outcome.RETRY
            }
            invoke.resolve(JSObject().put("accepted", PhotoBackupRuntime.complete(args.requestId, outcome)))
        } catch (error: Exception) {
            invoke.reject(error.message ?: "No se pudo actualizar el respaldo")
        }
    }

    @Command fun nativeTelegramStatus(invoke: Invoke) {
        val args = invoke.parseArgs(NativeAuthArgs::class.java)
        executor.execute {
            try {
                val status = NativeTelegram.status(activity.applicationContext, args.phone)
                invoke.resolve(JSObject().put("state", status.state).put("error", status.error))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo consultar Telegram")
            }
        }
    }

    @Command fun beginNativeTelegramLogin(invoke: Invoke) {
        val args = invoke.parseArgs(NativeAuthArgs::class.java)
        executor.execute {
            try {
                val status = NativeTelegram.beginLogin(activity.applicationContext, args.phone, args.apiId, args.apiHash)
                invoke.resolve(JSObject().put("state", status.state).put("error", status.error))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo iniciar la conexión en segundo plano")
            }
        }
    }

    @Command fun submitNativeTelegramCode(invoke: Invoke) {
        val args = invoke.parseArgs(NativeAuthArgs::class.java)
        executor.execute {
            try {
                val status = NativeTelegram.submitCode(activity.applicationContext, args.code)
                invoke.resolve(JSObject().put("state", status.state).put("error", status.error))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo verificar el código")
            }
        }
    }

    @Command fun submitNativeTelegramPassword(invoke: Invoke) {
        val args = invoke.parseArgs(NativeAuthArgs::class.java)
        executor.execute {
            try {
                val status = NativeTelegram.submitPassword(activity.applicationContext, args.password)
                invoke.resolve(JSObject().put("state", status.state).put("error", status.error))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo verificar la contraseña")
            }
        }
    }

    @Command fun listMedia(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        io(invoke) {
            check(access().getBoolean("available")) { "Permite el acceso a fotos y videos" }
            val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.MIME_TYPE, MediaStore.Files.FileColumns.SIZE,
                MediaStore.Images.Media.DATE_TAKEN, MediaStore.Files.FileColumns.DATE_MODIFIED,
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME, MediaStore.Files.FileColumns.MEDIA_TYPE)
            val selection = "(${MediaStore.Files.FileColumns.MEDIA_TYPE}=? OR ${MediaStore.Files.FileColumns.MEDIA_TYPE}=?) AND ${MediaStore.Files.FileColumns.SIZE}>0" +
                if (Build.VERSION.SDK_INT >= 29) " AND ${MediaStore.MediaColumns.IS_PENDING}=0" else ""
            val sort = "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Files.FileColumns._ID} DESC"
            val result = JSONArray()
            val offset = args.offset.coerceAtLeast(0)
            val limit = args.limit.coerceIn(1, 500)
            var more = false
            resolver.query(MediaStore.Files.getContentUri("external"), projection, selection, arrayOf("1", "3"), sort)?.use { cursor ->
                if (cursor.moveToPosition(offset)) do {
                    if (result.length() >= limit) { more = true; break }
                    val id = cursor.getLong(0)
                    val video = cursor.getInt(7) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                    val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    val uri = ContentUris.withAppendedId(base, id).toString()
                    val modified = cursor.getLong(5) * 1000
                    val taken = cursor.getLong(4).takeIf { it > 0 } ?: modified
                    val sourceKey = "$deviceId:$id:$modified:${cursor.getLong(3)}"
                    result.put(JSObject().put("id", "local:$id").put("name", cursor.getString(1) ?: "Foto-$id")
                        .put("mime", cursor.getString(2) ?: if(video) "video/mp4" else "image/jpeg")
                        .put("size", cursor.getLong(3)).put("capturedAt", taken).put("uploadedAt", modified)
                        .put("localUri", uri).put("deviceSourceKey", sourceKey)
                        .put("deviceFolder", cursor.getString(6) ?: "Sin carpeta")
                        .put("folderPath", "/").put("messageId", 0).put("channelId", ""))
                } while (cursor.moveToNext())
            }
            JSObject().put("files", result).put("hasMore", more).put("nextOffset", offset + result.length())
        }
    }
    @Command fun thumbnail(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        io(invoke) {
            val uri = mediaUri(args.uri)
            val bitmap = if(Build.VERSION.SDK_INT >= 29) resolver.loadThumbnail(uri, Size(256, 256), null) else {
                val id = ContentUris.parseId(uri)
                if(uri.path?.contains("/video/") == true) MediaStore.Video.Thumbnails.getThumbnail(resolver,id,MediaStore.Video.Thumbnails.MINI_KIND,null)
                else MediaStore.Images.Thumbnails.getThumbnail(resolver,id,MediaStore.Images.Thumbnails.MINI_KIND,null)
            } ?: error("Sin miniatura")
            val scaled = ThumbnailUtils.extractThumbnail(bitmap, 256, 256)
            val bytes = ByteArrayOutputStream().use { stream -> scaled.compress(Bitmap.CompressFormat.JPEG, 70, stream); stream.toByteArray() }
            if(scaled !== bitmap) scaled.recycle()
            bitmap.recycle()
            JSObject().put("url", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }
    @Command fun prepare(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        io(invoke) {
            val uri = mediaUri(args.uri)
            // Internal, random cache paths only. No arbitrary filesystem path accepted.
            val output = File(cacheDir, UUID.randomUUID().toString())
            val digest = MessageDigest.getInstance("SHA-256")
            try {
                val heicPreview = args.preview && Build.VERSION.SDK_INT >= 28 && (resolver.getType(uri)?.contains("hei") == true)
                if (heicPreview) {
                    val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                        val scale = minOf(1.0, 2048.0 / maxOf(info.size.width, info.size.height))
                        decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                    try {output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }} finally {bitmap.recycle()}
                    output.inputStream().use { input -> val buffer=ByteArray(512*1024); while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)} }
                } else {
                    resolver.openInputStream(uri)?.use { input -> output.outputStream().use { out ->
                        val buffer = ByteArray(512 * 1024)
                        while(true) { val n=input.read(buffer); if(n < 0) break; digest.update(buffer,0,n); out.write(buffer,0,n) }
                    } } ?: error("El archivo ya no está disponible")
                }
                JSObject().put("path", output.absolutePath).put("contentHash", digest.digest().joinToString("") { "%02x".format(it) }).put("size", output.length())
            } catch(error: Exception) { output.delete(); throw error }
        }
    }
    @Command fun release(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        io(invoke) {
            val file = File(args.path).canonicalFile
            require(file.parentFile == cacheDir.canonicalFile) { "Ruta no válida" }
            file.delete()
            JSObject()
        }
    }
    @Command fun networkStatus(invoke: Invoke) {
        val manager = activity.getSystemService(ConnectivityManager::class.java)
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
        invoke.resolve(JSObject().put("online", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            .put("unmetered", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true))
    }

    @Command fun createDownload(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        io(invoke) {
            check(Build.VERSION.SDK_INT >= 29) { "Guardar en la galería requiere Android 10 o posterior" }
            require(args.mime.startsWith("image/") || args.mime.startsWith("video/")) { "Elige fotos o videos" }
            require(args.size > 0) { "El archivo está vacío" }
            val video = args.mime.startsWith("video/")
            val name = args.name.map { if (it == '/' || it == '\\' || it.code < 32) '_' else it }.joinToString("").take(180).ifBlank { "TeleFotos" }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, args.mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/TeleFotos")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val collection = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val uri = resolver.insert(collection, values) ?: error("No se pudo crear la descarga")
            try {
                val stream = resolver.openOutputStream(uri, "w") ?: error("No se pudo guardar el archivo")
                val token = UUID.randomUUID().toString()
                downloads[token] = Download(uri, stream, args.size)
                JSObject().put("token", token)
            } catch (error: Exception) { resolver.delete(uri, null, null); throw error }
        }
    }

    @Command fun appendDownload(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        io(invoke) {
            val download = downloads[args.token] ?: error("La descarga ya no está disponible")
            require(args.data.length <= 720_000) { "Fragmento demasiado grande" }
            val bytes = Base64.decode(args.data, Base64.NO_WRAP)
            synchronized(download) {
                require(download.written + bytes.size <= download.size) { "Tamaño de descarga incorrecto" }
                download.stream.write(bytes)
                download.written += bytes.size
            }
            JSObject()
        }
    }

    @Command fun finishDownload(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        io(invoke) {
            val download = downloads.remove(args.token) ?: error("La descarga ya no está disponible")
            try {
                download.stream.close()
                check(download.written == download.size) { "La descarga está incompleta" }
                resolver.update(download.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                JSObject().put("uri", download.uri.toString())
            } catch (error: Exception) { resolver.delete(download.uri, null, null); throw error }
        }
    }

    @Command fun abortDownload(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadArgs::class.java)
        io(invoke) {
            downloads.remove(args.token)?.let { download ->
                try { download.stream.close() } finally { resolver.delete(download.uri, null, null) }
            }
            JSObject()
        }
    }

    @Command fun installUpdate(invoke: Invoke) {
        val args = try { invoke.parseArgs(UpdateArgs::class.java) }
        catch (error: Exception) { invoke.reject(error.message ?: "Solicitud de actualización no válida"); return }
        executor.execute {
            try {
                val source = URL(args.url)
                require(source.protocol == "https" && source.host == "github.com" &&
                    source.path.startsWith("/wiwyzho001-jpg/TeleFotos/releases/download/")) {
                    "La descarga no pertenece al repositorio oficial de TeleFotos"
                }
                val connection = (source.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20_000
                    readTimeout = 45_000
                    instanceFollowRedirects = true
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/octet-stream")
                    setRequestProperty("User-Agent", "TeleFotos-Android")
                }
                try {
                    check(connection.responseCode == HttpURLConnection.HTTP_OK) { "GitHub no pudo entregar el APK (${connection.responseCode})" }
                    val declaredSize = connection.contentLengthLong
                    require(declaredSize <= 300L * 1024 * 1024) { "El APK supera el tamaño permitido" }
                    val apk = File(cacheDir, "TeleFotos-update.apk")
                    val digest = MessageDigest.getInstance("SHA-256")
                    var total = 0L
                    connection.inputStream.use { input -> FileOutputStream(apk).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 300L * 1024 * 1024) { "El APK supera el tamaño permitido" }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                    } }
                    require(total > 0 && (declaredSize < 0 || total == declaredSize)) { "La descarga del APK está incompleta" }
                    val expectedDigest = args.sha256.removePrefix("sha256:").trim().lowercase()
                    if (expectedDigest.isNotEmpty()) {
                        val actualDigest = digest.digest().joinToString("") { "%02x".format(it) }
                        require(actualDigest == expectedDigest) { "La huella del APK no coincide con GitHub" }
                    }
                    pendingUpdateApk = apk
                } finally { connection.disconnect() }

                activity.runOnUiThread {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                        val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                        startActivityForResult(invoke, settingsIntent, "updateSourcePermissionResult")
                    } else launchUpdateInstaller(invoke)
                }
            } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo descargar la actualización")
            }
        }
    }

    @ActivityCallback
    fun updateSourcePermissionResult(invoke: Invoke, result: ActivityResult) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            invoke.reject("Activa el permiso para instalar TeleFotos desde esta fuente y vuelve a intentarlo")
            return
        }
        launchUpdateInstaller(invoke)
    }

    private fun launchUpdateInstaller(invoke: Invoke) {
        try {
            val apk = pendingUpdateApk ?: error("No se encontró el APK descargado")
            val uri = androidx.core.content.FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(intent)
            invoke.resolve(JSObject().put("opened", true))
        } catch (error: Exception) {
            invoke.reject(error.message ?: "No se pudo abrir el instalador de Android")
        }
    }

    @Command fun trash(invoke: Invoke) {
        if(Build.VERSION.SDK_INT < 30) {invoke.reject("La papelera del dispositivo requiere Android 11 o posterior"); return}
        val args = invoke.parseArgs(MediaArgs::class.java)
        try {
            val uris = (if(args.uris.isEmpty()) listOf(args.uri) else args.uris).map { mediaUri(it) }
            require(uris.size <= 2000) { "Selecciona menos archivos" }
            val request = MediaStore.createTrashRequest(resolver, uris, !args.restore)
            startIntentSenderForResult(invoke, IntentSenderRequest.Builder(request.intentSender).build(), "trashResult")
        } catch(error: Exception) {invoke.reject(error.message ?: "No se pudo abrir la papelera")}
    }
    @ActivityCallback fun trashResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve(JSObject().put("changed", result.resultCode == Activity.RESULT_OK))
    }
    @Command fun share(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        val uri = try { mediaUri(args.uri) } catch(error: Exception) { invoke.reject(error.message ?: "URI no válida"); return }
        val intent = Intent(Intent.ACTION_SEND).setType(resolver.getType(uri) ?: "image/*")
            .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(Intent.createChooser(intent, "Compartir"))
        invoke.resolve(JSObject())
    }
}
