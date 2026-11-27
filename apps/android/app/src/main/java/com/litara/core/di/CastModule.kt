package com.litara.core.di

import com.litara.core.network.CastUpstreamClient
import com.litara.core.network.UserCaTrust
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object CastModule {

    @Provides
    @Singleton
    @CastUpstreamClient
    fun provideCastUpstreamClient(
        logging: HttpLoggingInterceptor,
        userCaTrust: UserCaTrust,
        litara: com.litara.feature.litara.LitaraRepository,
    ): OkHttpClient = userCaTrust.applyTo(OkHttpClient.Builder())
        .addInterceptor(litara.bearerInterceptor()) // the signed-in server's host only
        .addInterceptor(logging)
        .authenticator(litara.refreshAuthenticator())
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
}
