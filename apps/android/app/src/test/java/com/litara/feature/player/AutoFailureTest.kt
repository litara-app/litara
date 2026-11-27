package com.litara.feature.player

import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.Problem
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.TransientException
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

class AutoFailureTest {
    @Test fun `authentication failures ask for sign in while missing books report unavailable`() {
        fun http(code: Int) = LitaraHttpException(code, Problem())
        assertEquals(AutoFailure.SIGN_IN, AutoFailure.from(http(401)))
        assertEquals(AutoFailure.SIGN_IN, AutoFailure.from(http(403)))
        assertEquals(AutoFailure.SIGN_IN, AutoFailure.from(SessionEndedException("revoked")))
        assertEquals(AutoFailure.UNAVAILABLE, AutoFailure.from(http(404)))
        assertEquals(AutoFailure.NETWORK, AutoFailure.from(http(503)))
    }
    @Test fun `offline and invalid selections have distinct recovery paths`() {
        assertEquals(AutoFailure.NETWORK, AutoFailure.from(IOException("offline")))
        assertEquals(AutoFailure.NETWORK, AutoFailure.from(TransientException(null, "busy")))
        assertEquals(AutoFailure.INVALID_REQUEST, AutoFailure.from(IllegalArgumentException()))
        assertEquals(AutoFailure.NO_RESULTS, AutoFailure.from(AutoRequestException(AutoFailure.NO_RESULTS)))
    }
}
