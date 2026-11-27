package com.litara.core.network

import javax.inject.Qualifier

/** The client the Cast proxy uses to fetch media from the signed-in server. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class CastUpstreamClient
