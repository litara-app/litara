// Top-level build file. Plugins are declared here with `apply false` and applied per-module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.play.publisher) apply false
}

// Applied from here: Android lint crashes reading a script that the app module applies itself.
project(":app") {
    apply(from = rootProject.file("shared-reader.gradle.kts"))
    tasks.configureEach { if (name == "preBuild") dependsOn("checkSharedReader") }
}
