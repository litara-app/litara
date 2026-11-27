package com.litara.core.db

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.feature.player.LitaraSource
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** An existing database file upgrades in place: saved positions survive, and nothing else in it is read or changed. */
@RunWith(AndroidJUnit4::class)
class DatabaseUpgradeTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "upgrade-test-${System.nanoTime()}.db"

    @After fun cleanup() { context.deleteDatabase(name) }

    @Test fun everyEarlierVersionKeepsUnsentPositionsAndLeavesOtherTablesAlone() = runBlocking {
        for (version in 5..8) {
            context.deleteDatabase(name)
            val mine = LitaraSource.HANDLE_BASE + 7
            SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile!!.mkdirs() }, null).use { old ->
                old.execSQL("CREATE TABLE `audio_progress` (`bookId` INTEGER NOT NULL, `currentFileId` INTEGER NOT NULL, " +
                    "`positionSeconds` REAL NOT NULL, `percentage` REAL NOT NULL, `updatedAt` INTEGER NOT NULL, " +
                    "`dirty` INTEGER NOT NULL, PRIMARY KEY(`bookId`))")
                old.execSQL("INSERT INTO audio_progress VALUES ($mine, 3, 41.5, 12.0, 100, 1)")
                old.execSQL("INSERT INTO audio_progress VALUES (42, 9, 5.0, 1.0, 900, 1)")
                old.execSQL("CREATE TABLE `unrelated` (`value` TEXT NOT NULL)")
                old.execSQL("INSERT INTO unrelated VALUES ('kept')")
                old.version = version
            }
            val db = Room.databaseBuilder(context, LitaraDatabase::class.java, name).addMigrations(*MIGRATIONS_TO_9).build()
            try {
                val dao = db.audioProgressDao()
                assertEquals("from $version", listOf(mine), dao.recent().map { it.bookId })
                assertEquals(listOf(mine), dao.dirtyEntries().map { it.bookId })
                assertEquals(41.5, dao.get(mine)!!.positionSeconds, 0.0)
                assertNull(dao.get(mine + 1))
                db.openHelper.readableDatabase.query("SELECT value FROM unrelated").use { rows ->
                    rows.moveToFirst()
                    assertEquals("kept", rows.getString(0))
                }
            } finally {
                db.close()
            }
        }
    }
}
