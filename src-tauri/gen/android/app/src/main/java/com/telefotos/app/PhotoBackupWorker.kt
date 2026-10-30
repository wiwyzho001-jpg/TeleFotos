package com.telefotos.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** WorkManager keeps the periodic trigger across app restarts and device reboots. */
class PhotoBackupWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val preferences = PhotoBackupScheduler.preferences(applicationContext)
        if (!preferences.getBoolean("enabled", false)) return Result.success()
        val phone = preferences.getString("phone", null)?.takeIf { it.isNotBlank() }
            ?: return Result.failure()

        if (!hasMediaPermission()) return Result.retry()
        if (!networkAllowed(preferences.getBoolean("wifiOnly", true))) return Result.retry()

        try {
            setForegroundAsync(foregroundInfo()).get()
        } catch (_: Exception) {
            return Result.retry()
        }

        val requestId = PhotoBackupRuntime.dispatch(phone) ?: return Result.retry()
        return when (PhotoBackupRuntime.await(requestId, 4, TimeUnit.HOURS)) {
            PhotoBackupRuntime.Outcome.SUCCESS -> Result.success()
            PhotoBackupRuntime.Outcome.DISABLED -> Result.success()
            PhotoBackupRuntime.Outcome.RETRY, null -> Result.retry()
        }
    }

    private fun hasMediaPermission(): Boolean {
        val imagePermission = if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_IMAGES
            else android.Manifest.permission.READ_EXTERNAL_STORAGE
        val videoPermission = if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_VIDEO else imagePermission
        val images = applicationContext.checkSelfPermission(imagePermission) == PackageManager.PERMISSION_GRANTED
        val videos = applicationContext.checkSelfPermission(videoPermission) == PackageManager.PERMISSION_GRANTED
        val selected = Build.VERSION.SDK_INT >= 34 && applicationContext.checkSelfPermission(
            android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
        ) == PackageManager.PERMISSION_GRANTED
        return images || videos || selected
    }

    private fun networkAllowed(wifiOnly: Boolean): Boolean {
        val manager = applicationContext.getSystemService(ConnectivityManager::class.java)
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return false
        return !wifiOnly || capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun foregroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(
                CHANNEL_ID, "Respaldo de fotos", NotificationManager.IMPORTANCE_LOW
            ))
        }
        val openApp = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(applicationContext.applicationInfo.icon)
            .setContentTitle("TeleFotos está respaldando")
            .setContentText("Las fotos nuevas se guardan en tu canal privado de Telegram")
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "telefotos-photo-backup"
        private const val NOTIFICATION_ID = 7462
    }
}
