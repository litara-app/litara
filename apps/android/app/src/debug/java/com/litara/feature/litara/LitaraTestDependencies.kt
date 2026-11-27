package com.litara.feature.litara

import com.litara.core.auth.AccountDataScope
import com.litara.core.network.CastUpstreamClient
import com.litara.feature.cast.CastProxyServer
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient

/** Debug-only entry point so instrumentation can reach the real singletons. */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface LitaraTestDependencies {
    fun repository(): LitaraRepository
    fun backend(): LitaraBackend
    fun player(): com.litara.feature.player.PlayerManager
    fun audioBookmarks(): com.litara.feature.player.AudiobookBookmarkRepository
    fun dataScope(): AccountDataScope
    fun appSettings(): com.litara.core.settings.AppSettingsStore
    fun castProxy(): CastProxyServer
    @CastUpstreamClient fun castUpstream(): OkHttpClient
}
