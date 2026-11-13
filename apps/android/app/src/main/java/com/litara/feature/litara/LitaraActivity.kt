package com.litara.feature.litara

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import com.litara.ui.theme.LitaraTheme
import dagger.hilt.android.AndroidEntryPoint

/** Entry to the Litara-server flow (sign in, library, download, play). Not exported; opened from the app. */
@AndroidEntryPoint
class LitaraActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { LitaraTheme { Surface { LitaraScreen() } } }
    }
}
