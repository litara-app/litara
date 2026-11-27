package com.litara.app

import androidx.lifecycle.ViewModel
import com.litara.core.network.ImageUrls
import com.litara.feature.litara.LitaraRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** Whether an account is signed in, for the root screen, and [ImageUrls]. */
@HiltViewModel
class RootViewModel @Inject constructor(
    litara: LitaraRepository,
    val imageUrls: ImageUrls,
) : ViewModel() {
    val signedIn: StateFlow<Boolean> = litara.signedInFlow
}
