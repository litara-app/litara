package com.litara.feature.litara

import com.litara.feature.player.LitaraSource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Gives the imported player, Android Auto and Cast code access to Litara recordings through [LitaraSource]. */
@Module
@InstallIn(SingletonComponent::class)
abstract class LitaraBindings {
    @Binds
    @Singleton
    abstract fun litaraSource(backend: LitaraBackend): LitaraSource
}
