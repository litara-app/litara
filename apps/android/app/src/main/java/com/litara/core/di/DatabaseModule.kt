package com.litara.core.di

import android.content.Context
import androidx.room.Room
import com.litara.core.auth.AccountDataScope
import com.litara.core.db.AudioProgressDao
import com.litara.core.db.LitaraDatabase
import com.litara.core.db.MIGRATIONS_TO_9
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
    fun provideDatabase(@ApplicationContext context: Context, dataScope: AccountDataScope): LitaraDatabase {
        // One database per server and account: handles mean different recordings for different accounts.
        val scope = dataScope.current
        dataScope.active = scope
        val name = if (scope.isEmpty()) "litara.db" else "litara-$scope.db"
        return Room.databaseBuilder(context, LitaraDatabase::class.java, name)
            .addMigrations(*MIGRATIONS_TO_9)
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideAudioProgressDao(db: LitaraDatabase): AudioProgressDao = db.audioProgressDao()
}
