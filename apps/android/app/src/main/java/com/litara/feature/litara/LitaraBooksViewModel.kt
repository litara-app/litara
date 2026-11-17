package com.litara.feature.litara

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.litara.core.litara.LEdition
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.TransientException
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BooksUi(val loading: Boolean = true, val editions: List<LEdition> = emptyList(), val error: String? = null)

/** Whether this app can open [e] today, and if not why. Capability states from the server are never upgraded. */
sealed interface BookOpen {
    data object Yes : BookOpen
    data class No(val reason: String) : BookOpen
}

fun openability(e: LEdition): BookOpen = when {
    e.file.format !in FOLIATE_FORMATS -> BookOpen.No(e.file.format.uppercase())
    !e.capabilities.read.supported -> BookOpen.No(e.capabilities.read.issues.joinToString { it.code }.ifEmpty { e.capabilities.read.state })
    e.file.contentPath == null -> BookOpen.No(e.file.availability)
    else -> BookOpen.Yes
}

/** Every ebook and comic edition the signed-in account may see, paged to completion (T005 /editions). */
@HiltViewModel
class LitaraBooksViewModel @Inject constructor(private val repo: LitaraRepository) : ViewModel() {
    private val _ui = MutableStateFlow(BooksUi())
    val ui: StateFlow<BooksUi> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val all = repo.editions().sortedBy { it.label.lowercase() }
                _ui.value = BooksUi(loading = false, editions = all)
            } catch (e: SessionEndedException) {
                repo.refreshSignedIn()
                _ui.update { it.copy(loading = false, error = e.code) }
            } catch (e: TransientException) {
                _ui.update { it.copy(loading = false, error = "offline") }
            } catch (e: LitaraHttpException) {
                _ui.update { it.copy(loading = false, error = e.problem.code.ifEmpty { "HTTP ${e.status}" }) }
            }
        }
    }
}
