package com.litara.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.litara.R

/** Litara brand mark (design/brand/logo.svg): a blue bookmark with an open-book cutout. */
@Composable
fun BrandLogo(modifier: Modifier = Modifier, size: Int = 72) {
    Image(
        painter = painterResource(R.drawable.ic_litara_logo),
        contentDescription = stringResource(R.string.litara),
        modifier = modifier.size(size.dp),
    )
}
