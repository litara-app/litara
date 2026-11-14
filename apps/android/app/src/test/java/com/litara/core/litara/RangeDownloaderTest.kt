package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** Offline snapshot/download semantics of ADR-0036/0043: resume, validators, no silent remap. */
class RangeDownloaderTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var downloader: RangeDownloader
    private lateinit var store: InMemoryCredentialStore
    private val bytes = ByteArray(10_000) { (it * 31 % 251).toByte() }
    private val etag = "\"v1\""

    private fun file(size: Long? = bytes.size.toLong()) =
        LFile("f1", "v1", 0, "a.mp3", "audio/mpeg", size, 1000, true, "/api/v1/files/f1/versions/v1/content")

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        store = InMemoryCredentialStore().also { it.save(StoredCredentials("tok", "ref")) }
        downloader = RangeDownloader(LitaraClient(server.url("/api/v1").toString(), OkHttpClient(), store))
    }

    @After
    fun tearDown() = server.shutdown()

    private fun serve(handler: (RecordedRequest) -> MockResponse) {
        server.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest) = handler(request) }
    }

    private fun ok(range: IntRange? = null): MockResponse {
        val body = Buffer().write(if (range == null) bytes else bytes.copyOfRange(range.first, range.last + 1))
        return MockResponse().setResponseCode(if (range == null) 200 else 206).setHeader("ETag", etag).setHeader("Accept-Ranges", "bytes")
            .apply { if (range != null) setHeader("Content-Range", "bytes ${range.first}-${range.last}/${bytes.size}") }.setBody(body)
    }

    @Test
    fun `downloads the exact original bytes`() = runBlocking {
        serve { ok() }
        val dest = File(tmp.root, "a.mp3")
        downloader.download(file(), dest)
        assertArrayEquals(bytes, dest.readBytes())
        assertFalse(File(dest.path + ".part").exists())
    }

    @Test
    fun `an interrupted download resumes with Range and If-Range and appends only the 206 tail`() = runBlocking {
        val dest = File(tmp.root, "a.mp3")
        val part = File(dest.path + ".part").also { it.writeBytes(bytes.copyOfRange(0, 4000)) }
        File(part.path + ".etag").writeText(etag)
        val seen = mutableListOf<Pair<String?, String?>>()
        serve { r -> seen += r.getHeader("Range") to r.getHeader("If-Range"); ok(4000 until bytes.size) }
        downloader.download(file(), dest)
        assertEquals("bytes=4000-" to etag, seen.single())
        assertArrayEquals(bytes, dest.readBytes())
    }

    @Test
    fun `a 200 answer to a range request restarts from zero and is never appended`() = runBlocking {
        val dest = File(tmp.root, "a.mp3")
        val part = File(dest.path + ".part").also { it.writeBytes(bytes.copyOfRange(0, 4000)) }
        File(part.path + ".etag").writeText(etag)
        serve { ok() } // validator mismatch / range ignored -> full 200
        downloader.download(file(), dest)
        assertEquals("a full body appended to partial content would be 14000 bytes", bytes.size.toLong(), dest.length())
        assertArrayEquals(bytes, dest.readBytes())
    }

    @Test
    fun `changed content leaves the previous complete download untouched and signals an update`() = runBlocking {
        val dest = File(tmp.root, "a.mp3").also { it.writeBytes(bytes) } // complete old copy
        // A different file instance (new size) is being downloaded for the update; the old copy is a different path.
        val update = File(tmp.root, "a-update.mp3")
        serve { MockResponse().setResponseCode(412).setBody("""{"code":"content_changed","status":412,"detail":"x","requestId":"r"}""") }
        try { downloader.download(file(), update); fail() } catch (e: ContentChangedException) { assertEquals("f1", e.fileId) }
        assertFalse(update.exists())
        assertArrayEquals("old bytes must be unchanged", bytes, dest.readBytes())
    }

    @Test
    fun `a stream cut mid-body keeps the partial for resume and is transient`() = runBlocking {
        val calls = AtomicInteger()
        serve { r ->
            if (calls.getAndIncrement() == 0) ok().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
            else ok(r.getHeader("Range")!!.removePrefix("bytes=").removeSuffix("-").toInt() until bytes.size)
        }
        val dest = File(tmp.root, "a.mp3")
        try { downloader.download(file(), dest); fail() } catch (e: TransientException) { /* expected */ }
        val part = File(dest.path + ".part")
        assertTrue("partial bytes survive for resume", part.exists() && part.length() < bytes.size)
        downloader.download(file(), dest)
        assertArrayEquals(bytes, dest.readBytes())
    }

    @Test
    fun `a size mismatch with the snapshot is rejected and not published`() = runBlocking {
        serve { ok() }
        val dest = File(tmp.root, "a.mp3")
        try { downloader.download(file(size = 123), dest); fail() } catch (e: IntegrityException) { /* expected */ }
        assertFalse(dest.exists())
    }

    @Test
    fun `expired bearer mid-download refreshes and continues the range`() = runBlocking {
        val dest = File(tmp.root, "a.mp3")
        val part = File(dest.path + ".part").also { it.writeBytes(bytes.copyOfRange(0, 1000)) }
        File(part.path + ".etag").writeText(etag)
        serve { r ->
            when {
                r.path!!.endsWith("/auth/native/refresh") -> MockResponse().setBody(
                    """{"accessToken":"fresh-access-token-value-0123456789abcd","tokenType":"Bearer","expiresIn":900,"refreshToken":"fresh-refresh-token-value-0123456789abc","session":{"id":"s","deviceName":"d","client":"native","createdAt":"t","lastUsedAt":"t","idleExpiresAt":"t","absoluteExpiresAt":"t"},"user":{"id":"u","username":"a","displayName":"A","isAdmin":false,"active":true}}""")
                r.getHeader("Authorization") == "Bearer tok" -> MockResponse().setResponseCode(401).setBody("""{"code":"token_expired","status":401,"detail":"x","requestId":"r"}""")
                else -> ok(1000 until bytes.size)
            }
        }
        downloader.download(file(), dest)
        assertArrayEquals(bytes, dest.readBytes())
    }
}
