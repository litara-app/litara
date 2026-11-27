package com.litara.feature.litara

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.StaleScopeException
import com.litara.core.litara.TransientException
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class SignInUi(val busy: Boolean = false, val error: String? = null)

@HiltViewModel
class LitaraSignInViewModel @Inject constructor(
    private val app: Application,
    private val repo: LitaraRepository,
    private val userCaSettings: com.litara.core.network.UserCaSettings,
) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(SignInUi())
    val ui: StateFlow<SignInUi> = _ui.asStateFlow()

    fun trustsUserCas(url: String): Boolean = userCaSettings.isEnabledForUrl(url)

    /** Success flips [LitaraRepository.signedInFlow], which replaces this screen with the app. */
    fun signIn(url: String, insecure: Boolean, user: String, password: String, trustUserCas: Boolean) {
        viewModelScope.launch {
            _ui.value = SignInUi(busy = true)
            try {
                // Saved before the first request so sign-in itself can use a user-installed certificate.
                withContext(Dispatchers.IO) { userCaSettings.setEnabledForUrl(url.trim(), trustUserCas) }
                repo.signIn(url, insecure, user, password, "Android ${android.os.Build.MODEL}")
                _ui.value = SignInUi()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                android.util.Log.w("LitaraSignIn", "sign-in failed", e)
                _ui.value = SignInUi(error = describe(e))
            }
        }
    }

    private fun describe(e: Throwable): String = when (e) {
        is InsecureServerException -> app.getString(R.string.litara_err_insecure)
        is LitaraHttpException -> e.problem.code.ifEmpty { "HTTP ${e.status}" }
        is SessionEndedException -> app.getString(R.string.litara_err_signed_out, e.code)
        is StaleScopeException -> app.getString(R.string.litara_err_stale)
        is TransientException -> app.getString(R.string.litara_err_offline)
        else -> e.message ?: e.javaClass.simpleName
    }

    fun clearError() = _ui.update { it.copy(error = null) }
}
