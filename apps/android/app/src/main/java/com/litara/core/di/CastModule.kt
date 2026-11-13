package com.litara.core.di

import com.litara.core.network.AuthInterceptor
import com.litara.core.network.CastUpstreamClient
import com.litara.core.network.TokenAuthenticator
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
        authInterceptor: AuthInterceptor,
        authenticator: TokenAuthenticator,
        logging: HttpLoggingInterceptor,
        userCaTrust: UserCaTrust,
    ): OkHttpClient = userCaTrust.applyTo(OkHttpClient.Builder())
        .addInterceptor(authInterceptor)
        .addInterceptor(logging)
        .authenticator(authenticator)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
}
