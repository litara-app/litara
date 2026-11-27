package com.litara.feature.litara

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.litara.R
import com.litara.core.network.UserCaSettings

/** Test tags used by the instrumentation flows. */
object LitaraTags {
    const val URL = "litara-url"
    const val INSECURE = "litara-insecure"
    const val USER = "litara-user"
    const val PASSWORD = "litara-password"
    const val SIGN_IN = "litara-sign-in"
    const val TRUST_USER_CAS = "litara-trust-user-cas"
    const val FINISHED = "litara-finished"
    const val ERROR = "litara-error"
    fun chapter(label: String) = "litara-chapter-$label"
}

/** Signing in to a Litara server; success replaces this screen with the app. */
@Composable
fun LitaraSignInRoute(vm: LitaraSignInViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.litara_title), style = MaterialTheme.typography.titleLarge)
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(LitaraTags.ERROR).clickable { vm.clearError() }) }
        if (ui.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        SignIn(vm)
    }
}

@Composable
private fun SignIn(vm: LitaraSignInViewModel) {
    var url by rememberSaveable { mutableStateOf("") }
    var insecure by rememberSaveable { mutableStateOf(false) }
    var user by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val certificateHost = UserCaSettings.httpsHost(url)
    // Consent is per host, so the switch returns to the saved choice whenever the host changes.
    var trustUserCas by rememberSaveable(certificateHost) { mutableStateOf(vm.trustsUserCas(url)) }
    OutlinedTextField(url, { url = it }, label = { Text(stringResource(R.string.litara_url_label)) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(LitaraTags.URL))
    Row {
        Checkbox(insecure, { insecure = it }, modifier = Modifier.testTag(LitaraTags.INSECURE))
        Text(stringResource(R.string.litara_insecure), modifier = Modifier.padding(top = 12.dp))
    }
    if (certificateHost != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.settings_trust_user_cas))
                Text(stringResource(R.string.settings_trust_user_cas_desc, certificateHost), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(trustUserCas, { trustUserCas = it }, Modifier.testTag(LitaraTags.TRUST_USER_CAS))
        }
    }
    OutlinedTextField(user, { user = it }, label = { Text(stringResource(R.string.litara_username)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag(LitaraTags.USER))
    OutlinedTextField(password, { password = it }, label = { Text(stringResource(R.string.litara_password)) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag(LitaraTags.PASSWORD))
    Button({ vm.signIn(url, insecure, user, password, trustUserCas) }, Modifier.testTag(LitaraTags.SIGN_IN)) { Text(stringResource(R.string.litara_sign_in)) }
}
