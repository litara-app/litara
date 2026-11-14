package com.litara.core.litara

import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Crash-safe replacement of a small file: the new bytes are written to a sibling, flushed to storage, and
 * then swapped in with an atomic rename. A reader (or a restart after an interruption) sees either the
 * complete old file or the complete new one, never a truncated mix. A leftover `.tmp` is never read.
 */
object AtomicFile {
    fun write(target: File, text: String) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(text.toByteArray(Charsets.UTF_8))
            out.flush()
            out.fd.sync()
        }
        try {
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (e: AtomicMoveNotSupportedException) {
            // Same-directory renames are atomic on every Android filesystem we write to; if one is not, fail
            // loudly rather than fall back to a truncating copy.
            tmp.delete()
            throw e
        }
    }
}
