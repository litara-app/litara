package com.litara.feature.litara.browse

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.HeatDay
import com.litara.core.litara.LReadingStats
import com.litara.core.litara.heatWeeks
import com.litara.feature.litara.LitaraRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject

data class StatsUi(val loading: Boolean = true, val error: String? = null, val stats: LReadingStats? = null)

@HiltViewModel
class StatsViewModel @Inject constructor(app: Application, repo: LitaraRepository) : BrowseViewModel(app, repo) {
    private val _ui = MutableStateFlow(StatsUi())
    val ui: StateFlow<StatsUi> = _ui.asStateFlow()

    /** The last 12 months, with days as this device's time zone has them (ADR-0098). */
    fun load() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val zone = ZoneId.systemDefault()
                val today = LocalDate.now(zone)
                val stats = client().readingStats(today.minusDays(364).toString(), today.toString(), zone.id)
                _ui.value = StatsUi(loading = false, stats = stats)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = message(e)) }
            }
        }
    }
}

@Composable
private fun duration(seconds: Long): String {
    val minutes = (seconds + 30) / 60
    return when {
        seconds in 1..59 -> stringResource(R.string.stats_under_minute)
        minutes >= 60 -> stringResource(R.string.stats_hours_minutes, (minutes / 60).toInt(), (minutes % 60).toInt())
        else -> stringResource(R.string.stats_minutes, minutes.toInt())
    }
}

@Composable
private fun Total(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun Square(day: HeatDay?) {
    if (day == null) {
        Box(Modifier.size(14.dp))
        return
    }
    val colors = MaterialTheme.colorScheme
    val color = if (day.level == 0) colors.surfaceVariant else colors.primary.copy(alpha = 0.25f * day.level)
    val date = day.date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    val spoken = day.day?.takeIf { it.seconds > 0 }?.let { stringResource(R.string.stats_day_cell, date, duration(it.seconds)) }
        ?: stringResource(R.string.stats_day_quiet, date)
    Box(Modifier.size(14.dp).clip(RoundedCornerShape(2.dp)).background(color).semantics { contentDescription = spoken })
}

@Composable
fun StatsScreen(onBack: () -> Unit, vm: StatsViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.load() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val stats = ui.stats
    BrowsePage(stringResource(R.string.stats_title), onBack) {
        if (ui.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        ui.error?.let { e -> item { ErrorLine(e, vm::load) } }
        if (stats == null) return@BrowsePage
        item { Text(stringResource(R.string.stats_period), style = MaterialTheme.typography.bodySmall) }
        item {
            Card(Modifier.fillMaxWidth().testTag(BrowseTags.STATS_TOTALS)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Total(stringResource(R.string.stats_reading), duration(stats.activeSeconds))
                    Total(stringResource(R.string.stats_listening), duration(stats.listeningSeconds))
                    Total(stringResource(R.string.stats_together), duration(stats.activeSeconds + stats.listeningSeconds))
                    Text(stringResource(R.string.stats_books_read, stats.books.toInt()))
                    Text(stringResource(R.string.stats_books_listened, stats.listenedBooks.toInt()))
                }
            }
        }
        item {
            Column {
                Text(stringResource(R.string.stats_reading_days, stats.readingDays.toInt()))
                Text(pluralStringResource(R.plurals.stats_current_streak, stats.currentStreak.toInt(), stats.currentStreak.toInt()))
                Text(pluralStringResource(R.plurals.stats_longest_streak, stats.longestStreak.toInt(), stats.longestStreak.toInt()))
                Text(stringResource(R.string.stats_day_rule, (stats.readingDaySeconds / 60).toInt()), style = MaterialTheme.typography.bodySmall)
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.stats_activity), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.stats_activity_scale), style = MaterialTheme.typography.bodySmall)
                val weeks = remember(stats) { heatWeeks(LocalDate.parse(stats.from), LocalDate.parse(stats.to), stats.activity, stats.readingDaySeconds) }
                // Opens at the newest week.
                val scroll = rememberScrollState(initial = Int.MAX_VALUE)
                Row(Modifier.horizontalScroll(scroll), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Top) {
                    weeks.forEach { week -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) { week.forEach { Square(it) } } }
                }
            }
        }
        val recent = stats.activity.filter { it.seconds > 0 }.sortedByDescending { it.date }.take(30)
        item { Text(stringResource(R.string.stats_recent_days), style = MaterialTheme.typography.titleMedium) }
        if (recent.isEmpty()) item { EmptyNote(stringResource(R.string.stats_no_activity)) }
        items(recent, key = { it.date }) { d ->
            val date = LocalDate.parse(d.date).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
            EntryRow(date, listOf(stringResource(R.string.stats_day_line, duration(d.readingSeconds), duration(d.listeningSeconds))), null)
        }
    }
}
