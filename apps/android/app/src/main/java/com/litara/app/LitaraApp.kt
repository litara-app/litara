package com.litara.app

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.litara.feature.litara.LitaraShell
import com.litara.feature.litara.LitaraSignInRoute
import com.litara.ui.LocalImageUrls

/** Root composable: the app for a signed-in account, otherwise sign-in. */
@Composable
fun LitaraApp() {
    val rootVm: RootViewModel = hiltViewModel()
    val signedIn by rootVm.signedIn.collectAsStateWithLifecycle()
    CompositionLocalProvider(LocalImageUrls provides rootVm.imageUrls) {
        if (signedIn) LitaraShell() else Surface { LitaraSignInRoute() }
    }
}
