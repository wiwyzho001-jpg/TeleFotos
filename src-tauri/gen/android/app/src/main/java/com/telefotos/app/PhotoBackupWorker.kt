package com.telefotos.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentUris
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Periodic Android worker: scans MediaStore and uploads originals through TDLib. */
class PhotoBackupWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    private data class Media(val uri: Uri, val name: String, val mime: String, val size: Long,
                             val sourceKey: String, val folder: String, val capturedAt: Long)

    override fun doWork(): Result {
        val preferences = PhotoBackupScheduler.preferences(applicationContext)
        if (!preferences.getBoolean("enabled", false)) return Result.success()
        if (!hasFullMediaPermission()) return Result.success()
        if (!networkAllowed(preferences.getBoolean("wifiOnly", true))) return Result.retry()
        val rawChannelId = preferences.getString("storageChannelId", null)?.toLongOrNull()
            ?: return Result.failure()
        val chatId = toTdChatId(rawChannelId)
        val rawMetadataId = preferences.getString("metadataChannelId", null)?.toLongOrNull()
            ?: return Result.failure()
        val metadataChatId = toTdChatId(rawMetadataId)
        val folders = preferences.getStringSet("folders", emptySet()) ?: emptySet()
        val allFolders = preferences.getBoolean("allFolders", true)

        try {
            // Android 12+ can reject WorkManager's foreground-service promotion
            // when a periodic job starts after the app has left the foreground.
            // The scheduled JobService may still run the bounded upload itself.
            try {
                setForegroundAsync(foregroundInfo()).get()
            } catch (error: Exception) {
                val foregroundStartBlocked = generateSequence(error as Throwable?) { it.cause }
                    .any { it.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException" }
                if (!foregroundStartBlocked) throw error
                android.util.Log.i("PhoGramBackup", "Android blocked foreground promotion; continuing in WorkManager job")
            }
            // While the WebView is still alive, let the existing GramJS pipeline
            // perform the backup so its normal queue and index handling are used.
            val phone = preferences.getString("phone", "") ?: ""
            val webRequest = PhotoBackupRuntime.dispatch(phone)
            if (webRequest != null) {
                return when (PhotoBackupRuntime.await(webRequest, 4, TimeUnit.HOURS)) {
                    PhotoBackupRuntime.Outcome.SUCCESS, PhotoBackupRuntime.Outcome.DISABLED -> Result.success()
                    PhotoBackupRuntime.Outcome.RETRY, null -> Result.retry()
                }
            }

            val client = NativeTelegram.requireAuthorized(applicationContext, phone)
            val ledger = PhotoBackupLedger(applicationContext)
            flushPendingIndex(client, metadataChatId, rawChannelId.toString(), ledger)
            val knownSourceKeys = readCurrentIndex(client, metadataChatId)
                .mapNotNull { file -> file.optString("deviceSourceKey").takeIf { it.isNotBlank() } }
                .toHashSet()
            var offset = 0
            while (!isStopped) {
                val page = listMedia(applicationContext, offset, 100)
                if (page.isEmpty()) break
                for (item in page) {
                    if (isStopped) return Result.retry()
                    if (!allFolders && item.folder !in folders) continue
                    if (item.sourceKey in knownSourceKeys) {
                        ledger.markKnown(item.sourceKey)
                        continue
                    }
                    if (ledger.contains(item.sourceKey)) continue
                    if (!networkAllowed(preferences.getBoolean("wifiOnly", true))) return Result.retry()
                    val indexedFile = upload(client, chatId, rawChannelId.toString(), item)
                    ledger.markUploaded(item.sourceKey, indexedFile.toString())
                    knownSourceKeys += item.sourceKey
                }
                offset += page.size
                if (page.size < 100) break
            }
            flushPendingIndex(client, metadataChatId, rawChannelId.toString(), ledger)
            return Result.success()
        } catch (_: InterruptedException) {
            return Result.retry()
        } catch (error: Exception) {
            android.util.Log.w("PhoGramBackup", "El respaldo se reintentará", error)
            return Result.retry()
        }
    }

    private fun upload(client: Client, chatId: Long, rawChannelId: String, item: Media): JSONObject {
        val staged = File(applicationContext.cacheDir, "phogram-${UUID.randomUUID()}-${safeName(item.name)}")
        try {
            applicationContext.contentResolver.openInputStream(item.uri)?.use { input ->
                FileOutputStream(staged).use { output -> input.copyTo(output, 128 * 1024) }
            } ?: throw IllegalStateException("No se pudo leer ${item.name}")
            if (staged.length() <= 0L || staged.length() != item.size)
                throw IllegalStateException("El archivo cambió durante la copia: ${item.name}")

            val content = TdApi.InputMessageDocument(
                TdApi.InputDocument(TdApi.InputFileLocal(staged.absolutePath), null, false),
                TdApi.FormattedText("", emptyArray()),
            )
            val sent = NativeTelegram.request(
                client,
                TdApi.SendMessage(chatId, null, null, null, null, content),
                4 * 60 * 60,
            )
            awaitUpload(client, sent)
            val digest = MessageDigest.getInstance("SHA-256")
            staged.inputStream().buffered().use { input ->
                val buffer = ByteArray(128 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            val hash = digest.digest().joinToString("") { "%02x".format(it) }
            return JSONObject()
                .put("id", "tdlib:$rawChannelId:${sent.id}")
                .put("name", item.name)
                .put("size", item.size)
                .put("mime", item.mime)
                .put("folderPath", "/")
                .put("messageId", sent.id)
                .put("channelId", rawChannelId)
                .put("uploadedAt", if (sent.date > 0) sent.date.toLong() * 1000 else System.currentTimeMillis())
                .put("capturedAt", item.capturedAt)
                .put("deviceSourceKey", item.sourceKey)
                .put("contentHash", hash)
                .put("starred", false)
                .put("trashed", false)
        } finally {
            staged.delete()
        }
    }

    private fun flushPendingIndex(client: Client, metadataChatId: Long, rawChannelId: String, ledger: PhotoBackupLedger) {
        val pending = ledger.pending()
        if (pending.isEmpty()) return
        val current = readCurrentIndex(client, metadataChatId)
        val byId = LinkedHashMap<String, JSONObject>()
        current.forEach { file -> byId.put(file.optString("id"), file) }
        pending.forEach { (_, json) ->
            val file = JSONObject(json)
            byId.put(file.optString("id"), file)
        }
        val files = byId.values.toList()
        val groups = ArrayList<List<JSONObject>>()
        var group = ArrayList<JSONObject>()
        for (file in files) {
            val candidate = ArrayList(group).apply { add(file) }
            val preview = indexChunkText(candidate, groups.size, 100000)
            if (group.isNotEmpty() && (preview.length > 3400 || group.size >= 25)) {
                groups += group
                group = arrayListOf(file)
            } else {
                group = candidate
            }
        }
        if (group.isNotEmpty() || groups.isEmpty()) groups += group
        val total = groups.size
        groups.forEachIndexed { index, chunk ->
            val text = indexChunkText(chunk, index, total)
            val sent = NativeTelegram.request(client, TdApi.SendMessage(
                metadataChatId, null, null, null, null,
                TdApi.InputMessageText(TdApi.FormattedText(text, emptyArray()), null, false),
            ))
            awaitUpload(client, sent)
        }
        ledger.markIndexed(pending.map { it.first })
    }

    private fun indexChunkText(files: List<JSONObject>, index: Int, total: Int): String = JSONObject()
        .put("teledrive_index", true)
        .put("version", 1)
        .put("chunkIndex", index)
        .put("totalChunks", total)
        .put("files", JSONArray(files))
        .toString()

    private fun readCurrentIndex(client: Client, chatId: Long): List<JSONObject> {
        // The metadata channel contains only index chunks. Read every page so an
        // older chunk is not silently dropped once an account has a large library.
        val messages = ArrayList<TdApi.Message>()
        var fromMessageId = 0L
        while (true) {
            val page = NativeTelegram.request(client, TdApi.GetChatHistory(chatId, fromMessageId, 0, 100, false))
                .messages.orEmpty()
            if (page.isEmpty()) break
            messages.addAll(page)
            val nextFrom = page.last().id
            if (nextFrom == fromMessageId || page.size < 100) break
            fromMessageId = nextFrom
        }
        data class Chunk(val id: Long, val index: Int, val total: Int, val files: List<JSONObject>)
        val chunks = messages.mapNotNull { message ->
            val content = message.content as? TdApi.MessageText ?: return@mapNotNull null
            val text = content.text.text
            if (!text.contains("teledrive_index")) return@mapNotNull null
            try {
                val json = JSONObject(text)
                val values = json.optJSONArray("files") ?: return@mapNotNull null
                val parsed = ArrayList<JSONObject>(values.length())
                for (i in 0 until values.length()) values.optJSONObject(i)?.let(parsed::add)
                Chunk(message.id, json.optInt("chunkIndex", -1), json.optInt("totalChunks", 0), parsed)
                    .takeIf { it.index >= 0 && it.total > 0 && it.index < it.total }
            } catch (_: Exception) { null }
        }
        val coherent = chunks.groupBy { it.total }.values.mapNotNull { sameTotal ->
            val sorted = sameTotal.sortedBy { it.id }
            val epochs = ArrayList<List<Chunk>>()
            var epoch = ArrayList<Chunk>()
            var maxIndex = -1
            for (chunk in sorted) {
                if (epoch.isNotEmpty() && chunk.index <= maxIndex) {
                    epochs += epoch
                    epoch = arrayListOf()
                    maxIndex = -1
                }
                epoch += chunk
                maxIndex = maxOf(maxIndex, chunk.index)
            }
            if (epoch.isNotEmpty()) epochs += epoch
            epochs.asReversed().firstOrNull { candidate ->
                val total = candidate.firstOrNull()?.total ?: return@firstOrNull false
                (0 until total).all { required -> candidate.any { it.index == required } }
            }
        }.maxByOrNull { epoch -> epoch.maxOfOrNull { it.id } ?: Long.MIN_VALUE }
            ?.sortedBy { it.index }
        return coherent?.flatMap { it.files }.orEmpty()
    }

    private fun toTdChatId(rawId: Long): Long = when {
        rawId <= 0L -> rawId
        else -> -1_000_000_000_000L - rawId
    }

    private fun awaitUpload(client: Client, sent: TdApi.Message) {
        val deadline = System.currentTimeMillis() + TimeUnit.HOURS.toMillis(4)
        while (!isStopped && System.currentTimeMillis() < deadline) {
            val message = NativeTelegram.request(client, TdApi.GetMessage(sent.chatId, sent.id), 30)
            when (val state = message.sendingState) {
                null -> return
                is TdApi.MessageSendingStateFailed -> throw IllegalStateException(state.error.message)
                is TdApi.MessageSendingStatePending -> Thread.sleep(1500)
                else -> Thread.sleep(1500)
            }
        }
        throw IllegalStateException("La subida se detuvo antes de terminar")
    }

    private fun listMedia(context: Context, offset: Int, limit: Int): List<Media> {
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.Images.Media.DATE_TAKEN,
        )
        val selection = "(${MediaStore.Files.FileColumns.MEDIA_TYPE}=? OR ${MediaStore.Files.FileColumns.MEDIA_TYPE}=?) AND ${MediaStore.Files.FileColumns.SIZE}>0" +
            if (Build.VERSION.SDK_INT >= 29) " AND ${MediaStore.MediaColumns.IS_PENDING}=0" else ""
        val sort = "${MediaStore.Files.FileColumns.DATE_MODIFIED} ASC, ${MediaStore.Files.FileColumns._ID} ASC"
        val cursor = queryPage(context.contentResolver, projection, selection, arrayOf("1", "3"), sort, offset, limit)
            ?: return emptyList()
        val result = ArrayList<Media>(limit)
        val deviceId = context.getSharedPreferences("telefotos-media", Context.MODE_PRIVATE)
            .getString("deviceId", null) ?: "phogram"
        cursor.use {
            while (it.moveToNext()) {
                val id = it.getLong(0)
                val name = it.getString(1) ?: "PhoGram-$id"
                val mime = it.getString(2) ?: "application/octet-stream"
                val size = it.getLong(3)
                val modified = it.getLong(4)
                val folder = it.getString(5) ?: "Sin carpeta"
                val video = it.getInt(6) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                val uri = ContentUris.withAppendedId(base, id)
                val taken = it.getLong(7).takeIf { value -> value > 0L } ?: modified * 1000L
                result += Media(uri, name, mime, size, "$deviceId:$id:${modified * 1000L}:$size", folder, taken)
            }
        }
        return result
    }

    private fun queryPage(
        resolver: ContentResolver,
        projection: Array<String>,
        selection: String,
        selectionArgs: Array<String>,
        sort: String,
        offset: Int,
        limit: Int,
    ): Cursor? {
        return if (Build.VERSION.SDK_INT >= 26) {
            val args = Bundle().apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, selectionArgs)
                putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sort)
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
                putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
            }
            resolver.query(MediaStore.Files.getContentUri("external"), projection, args, null)
        } else {
            resolver.query(MediaStore.Files.getContentUri("external"), projection, selection,
                selectionArgs, "$sort LIMIT $limit OFFSET $offset")
        }
    }

    private fun hasFullMediaPermission(): Boolean {
        val images = if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_IMAGES
            else android.Manifest.permission.READ_EXTERNAL_STORAGE
        val videos = if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_VIDEO else images
        return applicationContext.checkSelfPermission(images) == PackageManager.PERMISSION_GRANTED &&
            applicationContext.checkSelfPermission(videos) == PackageManager.PERMISSION_GRANTED
    }

    private fun networkAllowed(wifiOnly: Boolean): Boolean {
        val manager = applicationContext.getSystemService(ConnectivityManager::class.java)
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return false
        return !wifiOnly || capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun safeName(name: String): String = name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(100)

    private fun foregroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Respaldo de fotos", NotificationManager.IMPORTANCE_LOW)
        )
        val openApp = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(applicationContext.applicationInfo.icon)
            .setContentTitle("PhoGram está respaldando")
            .setContentText("Tus fotos y videos se guardan en tu canal privado de Telegram")
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(
            NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        ) else ForegroundInfo(NOTIFICATION_ID, notification)
    }

    companion object {
        private const val CHANNEL_ID = "phogram-photo-backup"
        private const val NOTIFICATION_ID = 7462
    }
}
