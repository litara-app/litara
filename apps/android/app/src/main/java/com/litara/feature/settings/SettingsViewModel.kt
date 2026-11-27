package com.litara.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import com.litara.R
import com.litara.core.network.UserCaSettings
import com.litara.core.settings.AppSettingsStore
import com.litara.core.settings.ThemeMode
import com.litara.feature.player.AudioSettingsStore
import com.litara.feature.player.DEFAULT_SKIP_BACK
import com.litara.feature.player.DEFAULT_SKIP_FORWARD
import com.litara.feature.player.DEFAULT_SPEED
import com.litara.feature.player.PreviousTrackAction
import com.litara.feature.player.ProgressBarMode
import com.litara.ui.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val appSettings: AppSettingsStore,
    private val audioSettingsStore: AudioSettingsStore,
    private val imageLoader: ImageLoader,
    private val userCaSettings: UserCaSettings,
    private val litara: com.litara.feature.litara.LitaraRepository,
) : ViewModel() {
    val themeMode: StateFlow<ThemeMode> = appSettings.themeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThemeMode.SYSTEM)

    val dynamicColor: StateFlow<Boolean> = appSettings.dynamicColor
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val wifiOnlyDownloads: StateFlow<Boolean> = appSettings.wifiOnlyDownloads
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** The server certificate trust applies to. */
    private val certificateUrl: String?
        get() = litara.currentIdentity?.serverUrl?.takeIf { litara.signedIn }

    val certificateHost: String get() = UserCaSettings.httpsHost(certificateUrl).orEmpty()

    val trustUserCas: StateFlow<Boolean> = userCaSettings.hosts.map { userCaSettings.isEnabledForUrl(certificateUrl) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun setTrustUserCas(enabled: Boolean) {
        viewModelScope.launch(Dispatchers.IO) { userCaSettings.setEnabledForUrl(certificateUrl, enabled) }
    }

    private val _defaultSpeed = MutableStateFlow(DEFAULT_SPEED)
    val defaultSpeed: StateFlow<Float> = _defaultSpeed.asStateFlow()

    val progressBarMode: StateFlow<ProgressBarMode> = audioSettingsStore.settings
        .map { it.progressBarMode }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProgressBarMode.BOOK)

    val skipBackSeconds: StateFlow<Int> = audioSettingsStore.settings
        .map { it.skipBackSeconds }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DEFAULT_SKIP_BACK)

    val skipForwardSeconds: StateFlow<Int> = audioSettingsStore.settings
        .map { it.skipForwardSeconds }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DEFAULT_SKIP_FORWARD)

    val previousTrackAction: StateFlow<PreviousTrackAction> = audioSettingsStore.settings
        .map { it.previousTrackAction }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PreviousTrackAction.CHAPTER)

    private val _message = MutableStateFlow<UiText?>(null)
    val message: StateFlow<UiText?> = _message.asStateFlow()

    init {
        viewModelScope.launch { _defaultSpeed.value = audioSettingsStore.load().speed }
    }

    fun setDynamicColor(enabled: Boolean) {
        viewModelScope.launch { appSettings.setDynamicColor(enabled) }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { appSettings.setThemeMode(mode) }
    }

    fun setWifiOnlyDownloads(enabled: Boolean) {
        viewModelScope.launch { appSettings.setWifiOnlyDownloads(enabled) }
    }

    fun setDefaultSpeed(value: Float) {
        _defaultSpeed.value = value
        viewModelScope.launch { audioSettingsStore.saveSpeed(value) }
    }

    fun setProgressBarMode(mode: ProgressBarMode) {
        viewModelScope.launch { audioSettingsStore.saveProgressBarMode(mode) }
    }

    fun setSkipBack(seconds: Int) {
        viewModelScope.launch { audioSettingsStore.saveSkipBack(seconds) }
    }

    fun setSkipForward(seconds: Int) {
        viewModelScope.launch { audioSettingsStore.saveSkipForward(seconds) }
    }

    fun setPreviousTrackAction(action: PreviousTrackAction) {
        viewModelScope.launch { audioSettingsStore.savePreviousTrackAction(action) }
    }

    fun clearImageCache() {
        imageLoader.diskCache?.clear()
        imageLoader.memoryCache?.clear()
        _message.value = UiText.of(R.string.settings_msg_image_cache_cleared)
    }

    fun consumeMessage() {
        _message.value = null
    }
}
