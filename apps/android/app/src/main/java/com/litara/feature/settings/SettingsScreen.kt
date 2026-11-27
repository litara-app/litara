package com.litara.feature.settings

import androidx.compose.ui.res.stringResource
import com.litara.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.Slider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.litara.BuildConfig
import com.litara.core.settings.ThemeMode
import com.litara.feature.player.MAX_SKIP_SECONDS
import com.litara.feature.player.MIN_SKIP_SECONDS
import com.litara.feature.player.PreviousTrackAction
import com.litara.feature.player.ProgressBarMode
import com.litara.feature.player.SKIP_STEP_SECONDS
import com.litara.feature.player.SPEED_PRESETS
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val themeMode by vm.themeMode.collectAsStateWithLifecycle()
    val dynamicColor by vm.dynamicColor.collectAsStateWithLifecycle()
    val wifiOnly by vm.wifiOnlyDownloads.collectAsStateWithLifecycle()
    val trustUserCas by vm.trustUserCas.collectAsStateWithLifecycle()
    val defaultSpeed by vm.defaultSpeed.collectAsStateWithLifecycle()
    val progressBarMode by vm.progressBarMode.collectAsStateWithLifecycle()
    val skipBack by vm.skipBackSeconds.collectAsStateWithLifecycle()
    val skipForward by vm.skipForwardSeconds.collectAsStateWithLifecycle()
    val previousTrackAction by vm.previousTrackAction.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val appContext = androidx.compose.ui.platform.LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it.resolve(appContext))
            vm.consumeMessage()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        LazyColumn(modifier = Modifier.fillMaxWidth().padding(padding)) {
            item { SectionHeader(stringResource(R.string.appearance)) }
            item {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        ThemeMode.entries.forEachIndexed { index, mode ->
                            SegmentedButton(
                                selected = themeMode == mode,
                                onClick = { vm.setThemeMode(mode) },
                                shape = SegmentedButtonDefaults.itemShape(index = index, count = ThemeMode.entries.size),
                                label = { Text(mode.label()) },
                            )
                        }
                    }
                }
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                item {
                    SettingsRow(
                        title = stringResource(R.string.settings_material_you),
                        subtitle = stringResource(R.string.settings_material_you_desc),
                        trailing = { Switch(checked = dynamicColor, onCheckedChange = vm::setDynamicColor) },
                    )
                }
            }
            item { HorizontalDivider() }

            // Certificate trust is per HTTPS host, so a plain-HTTP server has nothing to offer.
            if (vm.certificateHost.isNotBlank()) {
                item { SectionHeader(stringResource(R.string.settings_security)) }
                item {
                    SettingsRow(
                        title = stringResource(R.string.settings_trust_user_cas),
                        subtitle = stringResource(R.string.settings_trust_user_cas_desc, vm.certificateHost),
                        trailing = { Switch(checked = trustUserCas, enabled = vm.certificateHost.isNotBlank(), onCheckedChange = vm::setTrustUserCas) },
                    )
                }
                item { HorizontalDivider() }
            }

            item { SectionHeader(stringResource(R.string.downloads)) }
            item {
                SettingsRow(
                    title = stringResource(R.string.settings_wifi_only),
                    subtitle = stringResource(R.string.settings_wifi_only_litara_desc),
                    trailing = { Switch(checked = wifiOnly, onCheckedChange = vm::setWifiOnlyDownloads) },
                )
            }
            item { HorizontalDivider() }

            item { SectionHeader(stringResource(R.string.storage)) }
            item {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    OutlinedButton(onClick = vm::clearImageCache) {
                        Text(stringResource(R.string.clear_image_cache))
                    }
                }
            }
            item { HorizontalDivider() }

            item { SectionHeader(stringResource(R.string.playback)) }
            item {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(
                        stringResource(R.string.default_speed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        SPEED_PRESETS.forEach { preset ->
                            FilterChip(
                                selected = abs(preset - defaultSpeed) < 0.001f,
                                onClick = { vm.setDefaultSpeed(preset) },
                                label = { Text(stringResource(R.string.x, preset)) },
                                modifier = Modifier.padding(horizontal = 4.dp),
                            )
                        }
                    }
                    SkipSlider(stringResource(R.string.skip_back), skipBack, vm::setSkipBack)
                    SkipSlider(stringResource(R.string.skip_forward), skipForward, vm::setSkipForward)
                    Text(
                        stringResource(R.string.settings_previous_button),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        listOf(PreviousTrackAction.CHAPTER to stringResource(R.string.previous_chapter), PreviousTrackAction.SKIP_BACK to stringResource(R.string.skip_back)).forEach { (action, label) ->
                            FilterChip(
                                selected = previousTrackAction == action,
                                onClick = { vm.setPreviousTrackAction(action) },
                                label = { Text(label) },
                                modifier = Modifier.padding(horizontal = 4.dp),
                            )
                        }
                    }
                    Text(
                        stringResource(R.string.progress_bar),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        listOf(ProgressBarMode.BOOK to stringResource(R.string.settings_progress_book), ProgressBarMode.CHAPTER to stringResource(R.string.settings_progress_chapter)).forEach { (mode, label) ->
                            FilterChip(
                                selected = progressBarMode == mode,
                                onClick = { vm.setProgressBarMode(mode) },
                                label = { Text(label) },
                                modifier = Modifier.padding(horizontal = 4.dp),
                            )
                        }
                    }
                }
            }

            item { HorizontalDivider() }
            item { SectionHeader(stringResource(R.string.about)) }
            item {
                SettingsRow(
                    title = stringResource(R.string.settings_app_version),
                    subtitle = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                    trailing = {},
                )
            }
        }
    }
}

/** Slider over [MIN_SKIP_SECONDS]..[MAX_SKIP_SECONDS] in [SKIP_STEP_SECONDS] steps. */
@Composable
private fun SkipSlider(label: String, seconds: Int, onChange: (Int) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    Text(
        stringResource(R.string.settings_skip_seconds, label, dragging?.toInt() ?: seconds),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 16.dp),
    )
    Slider(
        value = dragging ?: seconds.toFloat(),
        onValueChange = { dragging = it },
        onValueChangeFinished = {
            dragging?.let { onChange(it.toInt()) }
            dragging = null
        },
        valueRange = MIN_SKIP_SECONDS.toFloat()..MAX_SKIP_SECONDS.toFloat(),
        steps = (MAX_SKIP_SECONDS - MIN_SKIP_SECONDS) / SKIP_STEP_SECONDS - 1,
    )
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
internal fun SettingsRow(title: String, subtitle: String, trailing: @Composable () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing()
    }
}

@Composable
private fun ThemeMode.label() = stringResource(
    when (this) {
        ThemeMode.SYSTEM -> R.string.theme_system
        ThemeMode.LIGHT -> R.string.theme_light
        ThemeMode.DARK -> R.string.theme_dark
    },
)

