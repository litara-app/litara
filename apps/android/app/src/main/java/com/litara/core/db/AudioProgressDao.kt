package com.litara.core.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.litara.feature.player.LitaraSource
import kotlinx.coroutines.flow.Flow

/** Saved listening positions by local handle. Rows below [LitaraSource.HANDLE_BASE] are never read. */
@Dao
interface AudioProgressDao {
    @Query("SELECT * FROM audio_progress WHERE bookId = :bookId")
    suspend fun get(bookId: Int): AudioProgressEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: AudioProgressEntity)

    @Query("SELECT * FROM audio_progress WHERE dirty = 1 AND bookId >= ${LitaraSource.HANDLE_BASE}")
    suspend fun dirtyEntries(): List<AudioProgressEntity>

    /** Most recently played first — drives the Android Auto "Continue listening" shelf. */
    @Query("SELECT * FROM audio_progress WHERE bookId >= ${LitaraSource.HANDLE_BASE} ORDER BY updatedAt DESC")
    suspend fun recent(): List<AudioProgressEntity>

    @Query("SELECT * FROM audio_progress WHERE bookId >= ${LitaraSource.HANDLE_BASE} ORDER BY updatedAt DESC")
    fun observeRecent(): Flow<List<AudioProgressEntity>>

    /** Clears the flag only for the row that was sent: a newer position saved meanwhile is still waiting. */
    @Query("UPDATE audio_progress SET dirty = 0 WHERE bookId = :bookId AND updatedAt = :sentUpdatedAt")
    suspend fun markSynced(bookId: Int, sentUpdatedAt: Long)
}
