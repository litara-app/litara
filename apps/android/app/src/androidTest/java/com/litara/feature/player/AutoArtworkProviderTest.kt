package com.litara.feature.player

import android.content.ContentResolver
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.EntryPointAccessors
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileNotFoundException

@RunWith(AndroidJUnit4::class)
class AutoArtworkProviderTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val dependencies get() = EntryPointAccessors.fromApplication(context, AutoArtworkProvider.Dependencies::class.java)

    @Test fun cachedCoverIsReadableThroughContentResolver() {
        val id = 2_000_000_001
        val uri = dependencies.artwork().uri(id)
        val folder = File(context.cacheDir, "auto-artwork").apply { mkdirs() }
        val cached = File(folder, "${uri.pathSegments[0]}-$id.jpg")
        val bytes = byteArrayOf(1, 2, 3, 4)
        cached.writeBytes(bytes)
        try {
            assertEquals(ContentResolver.SCHEME_CONTENT, uri.scheme)
            assertArrayEquals(bytes, context.contentResolver.openInputStream(uri)!!.use { it.readBytes() })
        } finally {
            cached.delete()
        }
    }

    @Test fun providerRejectsWritesAndForeignScopes() {
        val uri = dependencies.artwork().uri(1)
        for ((request, mode) in listOf(uri to "rw", uri.buildUpon().path("/other-account/1").build() to "r")) {
            try {
                context.contentResolver.openFileDescriptor(request, mode)?.close()
                fail("Artwork request should have been rejected")
            } catch (_: FileNotFoundException) { }
        }
    }

    @Suppress("DEPRECATION")
    @Test fun providerRequiresExplicitReadGrants() {
        val provider = context.packageManager.resolveContentProvider("${context.packageName}.artwork", 0)!!
        assertFalse(provider.exported)
        assertTrue(provider.grantUriPermissions)
    }
}
