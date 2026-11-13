package com.litara.core.di

import android.content.Context
import androidx.room.Room
import com.litara.core.db.AudioProgressDao
import com.litara.core.db.LitaraDatabase
import com.litara.core.db.DownloadDao
import com.litara.core.db.AnnotationCacheDao
import com.litara.core.db.MIGRATION_5_6
import com.litara.core.db.MIGRATION_6_7
import com.litara.core.db.MIGRATION_7_8
import com.litara.core.db.PendingAnnotationOpDao
import com.litara.core.db.PendingRatingDao
import com.litara.core.db.PendingReadStatusDao
import com.litara.core.db.PendingReadingSessionDao
import com.litara.core.auth.SessionManager
import com.litara.core.db.ReaderProgressDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context, session: SessionManager): LitaraDatabase {
        // One database per server: book and file ids mean different books on different servers.
        val scope = session.dataScope
        session.activeDataScope = scope
        val name = if (scope.isEmpty()) "litara.db" else "litara-$scope.db"
        return Room.databaseBuilder(context, LitaraDatabase::class.java, name)
            .addMigrations(MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideReaderProgressDao(db: LitaraDatabase): ReaderProgressDao = db.readerProgressDao()

    @Provides
    fun provideAudioProgressDao(db: LitaraDatabase): AudioProgressDao = db.audioProgressDao()

    @Provides
    fun provideDownloadDao(db: LitaraDatabase): DownloadDao = db.downloadDao()

    @Provides
    fun providePendingRatingDao(db: LitaraDatabase): PendingRatingDao = db.pendingRatingDao()

    @Provides
    fun providePendingAnnotationOpDao(db: LitaraDatabase): PendingAnnotationOpDao = db.pendingAnnotationOpDao()

    @Provides
    fun provideAnnotationCacheDao(db: LitaraDatabase): AnnotationCacheDao = db.annotationCacheDao()

    @Provides
    fun providePendingReadingSessionDao(db: LitaraDatabase): PendingReadingSessionDao = db.pendingReadingSessionDao()

    @Provides
    fun providePendingReadStatusDao(db: LitaraDatabase): PendingReadStatusDao = db.pendingReadStatusDao()
}
