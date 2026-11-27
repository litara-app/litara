package com.litara.core.di

import android.content.Context
import coil.ImageLoader
import com.litara.BuildConfig
import com.litara.core.network.UserCaTrust
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /** Lenient JSON: ignore server fields we don't model, omit nulls on the wire. */
    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): HttpLoggingInterceptor =
        HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

    /** Covers reach Coil as local `content:` addresses; authenticated fetching is done by the artwork provider. */
    @Provides
    @Singleton
    fun provideImageLoader(
        @ApplicationContext context: Context,
        userCaTrust: UserCaTrust,
    ): ImageLoader = ImageLoader.Builder(context)
        .okHttpClient { userCaTrust.applyTo(OkHttpClient.Builder()).build() }
        .crossfade(true)
        .build()
}
