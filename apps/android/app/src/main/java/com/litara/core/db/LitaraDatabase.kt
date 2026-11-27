package com.litara.core.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * App database. Add a hand-written migration for every schema bump: the destructive fallback in
 * DatabaseModule would discard saved positions that have not been sent.
 */
@Database(entities = [AudioProgressEntity::class], version = 9, exportSchema = false)
abstract class LitaraDatabase : RoomDatabase() {
    abstract fun audioProgressDao(): AudioProgressDao
}

/**
 * Versions 5 to 8 to 9: only the listening positions remain in the app's schema, and their table is
 * unchanged. Nothing else in an existing file is read or altered.
 */
val MIGRATIONS_TO_9: Array<Migration> = (5..8).map { from ->
    object : Migration(from, 9) {
        override fun migrate(db: SupportSQLiteDatabase) = Unit
    }
}.toTypedArray()
