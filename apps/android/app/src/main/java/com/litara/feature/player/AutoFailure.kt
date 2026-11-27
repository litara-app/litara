package com.litara.feature.player

import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.TransientException
import kotlinx.coroutines.TimeoutCancellationException
import java.io.IOException

enum class AutoFailure { SIGN_IN, NETWORK, UNAVAILABLE, NO_RESULTS, NO_HISTORY, INVALID_REQUEST;
    companion object {
        fun from(error: Throwable): AutoFailure = when (error) {
            is AutoRequestException -> error.failure
            is SessionEndedException -> SIGN_IN
            is LitaraHttpException -> when (error.status) {
                401, 403 -> SIGN_IN
                404 -> UNAVAILABLE
                else -> NETWORK
            }
            is IOException, is TimeoutCancellationException, is TransientException -> NETWORK
            is IllegalArgumentException -> INVALID_REQUEST
            else -> UNAVAILABLE
        }
    }
}

class AutoRequestException(val failure: AutoFailure) : Exception(failure.name)
