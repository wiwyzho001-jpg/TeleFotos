package com.telefotos.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Small local idempotency ledger so a retry never re-uploads completed media. */
internal class PhotoBackupLedger(context: Context) : SQLiteOpenHelper(context, "phogram-photo-backup.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE uploaded (source_key TEXT PRIMARY KEY NOT NULL, uploaded_at INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE pending_index (source_key TEXT PRIMARY KEY NOT NULL, file_json TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized fun contains(key: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM uploaded WHERE source_key=? LIMIT 1", arrayOf(key)
    ).use { it.moveToFirst() }

    @Synchronized fun markUploaded(key: String, fileJson: String) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO uploaded(source_key, uploaded_at) VALUES(?, ?)",
            arrayOf(key, System.currentTimeMillis())
        )
        writableDatabase.execSQL(
            "INSERT OR REPLACE INTO pending_index(source_key, file_json) VALUES(?, ?)",
            arrayOf(key, fileJson)
        )
    }

    @Synchronized fun markKnown(key: String) {
        writableDatabase.execSQL(
            "INSERT OR IGNORE INTO uploaded(source_key, uploaded_at) VALUES(?, ?)",
            arrayOf(key, System.currentTimeMillis())
        )
    }

    @Synchronized fun pending(): List<Pair<String, String>> = readableDatabase.rawQuery(
        "SELECT source_key, file_json FROM pending_index ORDER BY rowid", null
    ).use { cursor ->
        buildList { while (cursor.moveToNext()) add(cursor.getString(0) to cursor.getString(1)) }
    }

    @Synchronized fun markIndexed(keys: Collection<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            keys.forEach { key -> db.delete("pending_index", "source_key=?", arrayOf(key)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
}
