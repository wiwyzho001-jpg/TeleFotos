package com.telefotos.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.BackoffPolicy
import java.util.concurrent.TimeUnit

internal object PhotoBackupScheduler {
    private const val PREFS = "telefotos-photo-backup"
    private const val PERIODIC_WORK = "telefotos-photo-backup-periodic"
    private const val IMMEDIATE_WORK = "telefotos-photo-backup-immediate"

    fun configure(context: Context, phone: String, enabled: Boolean, wifiOnly: Boolean, runNow: Boolean,
                  storageChannelId: String, metadataChannelId: String, folders: List<String>, allFolders: Boolean) {
        require(phone.length <= 40 && Regex("^\\+?[0-9]*$").matches(phone)) { "Cuenta de Telegram no válida" }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("phone", phone)
            .putBoolean("enabled", enabled)
            .putBoolean("wifiOnly", wifiOnly)
            .putString("storageChannelId", storageChannelId)
            .putString("metadataChannelId", metadataChannelId)
            .putStringSet("folders", folders.toSet())
            .putBoolean("allFolders", allFolders)
            .apply()

        val manager = WorkManager.getInstance(context)
        if (!enabled) {
            manager.cancelUniqueWork(PERIODIC_WORK)
            manager.cancelUniqueWork(IMMEDIATE_WORK)
            return
        }

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .build()
        val periodic = PeriodicWorkRequestBuilder<PhotoBackupWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, periodic)

        if (runNow) {
            val immediate = OneTimeWorkRequestBuilder<PhotoBackupWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            manager.enqueueUniqueWork(IMMEDIATE_WORK, ExistingWorkPolicy.KEEP, immediate)
        }
    }

    fun preferences(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
