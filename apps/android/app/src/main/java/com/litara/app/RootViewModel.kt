package com.litara.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.litara.core.auth.SessionManager
import com.litara.core.auth.SessionState
import com.litara.core.network.ImageUrls
import com.litara.feature.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Exposes top-level [SessionState] for navigation gating, the sign-out action, and [ImageUrls]. */
@HiltViewModel
class RootViewModel @Inject constructor(
    session: SessionManager,
    private val repo: AuthRepository,
    litara: com.litara.feature.litara.LitaraRepository,
    val imageUrls: ImageUrls,
) : ViewModel() {
    val state: StateFlow<SessionState> = session.state

    /** True while a Litara account is signed in: the app then shows the Litara shell instead of the BookOrbit flow. */
    val litaraSignedIn: StateFlow<Boolean> = litara.signedInFlow

    fun signOut() {
        viewModelScope.launch { repo.logout() }
    }
}
