package com.litara.core.litara

/**
 * Highlight colours (ADR-0094). Only the name is saved on the server; each client picks the shade it draws. These are
 * the shades of the Android colour picker.
 */
object HighlightColors {
    /** Name to shade, in the order the picker offers them. */
    val SHADES: List<Pair<String, String>> = listOf(
        "yellow" to "#FACC15",
        "green" to "#4ADE80",
        "blue" to "#38BDF8",
        "pink" to "#F472B6",
        "orange" to "#FB923C",
    )

    /** A second blue an earlier build drew with; it still means blue. */
    private const val OLD_BLUE = "#60A5FA"

    fun shade(name: String?): String? = SHADES.firstOrNull { it.first == name }?.second

    /** The name for a colour name or one of the picker's shades; null for anything else. */
    fun nameOf(value: String?): String? {
        val v = value ?: return null
        return SHADES.firstOrNull { it.first.equals(v, ignoreCase = true) || it.second.equals(v, ignoreCase = true) }?.first
            ?: "blue".takeIf { v.equals(OLD_BLUE, ignoreCase = true) }
    }
}
