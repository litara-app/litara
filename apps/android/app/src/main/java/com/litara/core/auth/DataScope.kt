package com.litara.core.auth

import java.security.MessageDigest

/** The stable 12-hex name of one account's on-device data (audit L6). */
object DataScope {
    fun scopeFor(key: String): String =
        MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }.take(12)
}
