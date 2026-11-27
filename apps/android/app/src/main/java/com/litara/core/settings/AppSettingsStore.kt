package com.litara.core.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

enum class ThemeMode { SYSTEM, LIGHT, DARK }

private val Context.appSettingsDataStore by preferencesDataStore("app_settings")

/**
 * App-level preferences (as opposed to the per-feature stores like ReaderSettingsStore /
 * AudioSettingsStore): appearance and download behavior configured from the Settings screen.
 * Exposed as Flows (rather than one-shot load()) since the Settings screen and theme root need to
 * react live as the user changes them.
 */
@Singleton
class AppSettingsStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val themeModeKey = stringPreferencesKey("theme_mode")
    private val wifiOnlyDownloadsKey = booleanPreferencesKey("wifi_only_downloads")
    private val dynamicColorKey = booleanPreferencesKey("dynamic_color")
    private val comicRtlKey = booleanPreferencesKey("comic_rtl")

    val themeMode = context.appSettingsDataStore.data.map { prefs ->
        prefs[themeModeKey]?.let { raw -> runCatching { ThemeMode.valueOf(raw) }.getOrNull() } ?: ThemeMode.SYSTEM
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.appSettingsDataStore.edit { it[themeModeKey] = mode.name }
    }

    /** Comic reading direction: true pages right-to-left (manga). */
    val comicRtl = context.appSettingsDataStore.data.map { it[comicRtlKey] ?: false }

    suspend fun setComicRtl(enabled: Boolean) {
        context.appSettingsDataStore.edit { it[comicRtlKey] = enabled }
    }

    /** Use the wallpaper-derived Material You palette (Android 12+). Off by default: Litara blue. */
    val dynamicColor = context.appSettingsDataStore.data.map { it[dynamicColorKey] ?: false }

    suspend fun setDynamicColor(enabled: Boolean) {
        context.appSettingsDataStore.edit { it[dynamicColorKey] = enabled }
    }

    val wifiOnlyDownloads = context.appSettingsDataStore.data.map { it[wifiOnlyDownloadsKey] ?: false }

    suspend fun setWifiOnlyDownloads(enabled: Boolean) {
        context.appSettingsDataStore.edit { it[wifiOnlyDownloadsKey] = enabled }
    }
}
