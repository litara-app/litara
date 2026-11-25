// Shared reader engine (ADR-0093, option 3b). The web reader engine in apps/web/public/reader (bridge.js,
// frame.html, pristine foliate-js and PDF.js) is the single source. app/src/main/assets/reader-shared/ is a
// build output copied from it and checked in; never edit it by hand.
//
//   ./gradlew syncSharedReader    copy the web engine into the assets and record its engine profiles
//   ./gradlew checkSharedReader   fail when the copy differs from the web source, or when the engine profile the
//                                 copy was built for differs from the web app's or the server's
//
// checkSharedReader runs before every build (preBuild). The legacy AGPL-modified reader in assets/reader is
// untouched and stays the default until the shared engine passes the locator fixtures (see ADR-0093).
import java.security.MessageDigest

val repoRoot = rootProject.projectDir.resolve("../..").canonicalFile
val webReader = repoRoot.resolve("apps/web/public/reader")
val sharedAssets = rootProject.projectDir.resolve("app/src/main/assets/reader-shared")
val profileTs = repoRoot.resolve("apps/web/src/reader/profile.ts")
val serverEditions = repoRoot.resolve("apps/server/internal/catalog/editions.go")
val profileFile = "ENGINE_PROFILE"

fun webProfiles(): Map<String, String> {
    val body = profileTs.readText()
    val m = Regex("""(foliate|pdfjs):\s*"([^"]+)"""").findAll(body).associate { it.groupValues[1] to it.groupValues[2] }
    check(m.keys == setOf("foliate", "pdfjs")) { "Could not read BUNDLED_PROFILE from $profileTs" }
    return m
}

fun serverProfiles(): Map<String, String> {
    val body = serverEditions.readText()
    val f = Regex("""ProfileFoliate\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
    val p = Regex("""ProfilePDFJS\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
    check(f != null && p != null) { "Could not read ProfileFoliate/ProfilePDFJS from $serverEditions" }
    return mapOf("foliate" to f, "pdfjs" to p)
}

fun profileText(p: Map<String, String>) = "foliate=${p.getValue("foliate")}\npdfjs=${p.getValue("pdfjs")}\n"

fun sha256(f: File): String =
    MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }

fun relFiles(dir: File): Map<String, File> =
    dir.walkTopDown().filter { it.isFile && it.name != profileFile }.associateBy { it.relativeTo(dir).invariantSeparatorsPath }

tasks.register("syncSharedReader") {
    group = "litara"
    notCompatibleWithConfigurationCache("uses project file helpers; a developer tool run on demand")
    description = "Copies apps/web/public/reader into app/src/main/assets/reader-shared (a build output; never hand-edit)."
    doLast {
        check(webReader.isDirectory) { "Web reader source not found: $webReader" }
        val web = webProfiles()
        check(web == serverProfiles()) { "The web app's engine profiles ${web} differ from the server's ${serverProfiles()}." }
        sharedAssets.deleteRecursively()
        copy {
            from(webReader)
            into(sharedAssets)
        }
        sharedAssets.resolve(profileFile).writeText(profileText(web))
        logger.lifecycle("Synced ${relFiles(sharedAssets).size} files into ${sharedAssets.relativeTo(rootProject.projectDir)}")
    }
}

val checkSharedReader = tasks.register("checkSharedReader") {
    group = "litara"
    notCompatibleWithConfigurationCache("reads files outside the project through script helpers")
    description = "Fails when the bundled shared reader engine differs from the web source or its engine profile differs from the server's."
    inputs.dir(webReader)
    inputs.files(profileTs, serverEditions)
    inputs.dir(sharedAssets)
    doLast {
        val problems = mutableListOf<String>()
        val fix = "Run ./gradlew syncSharedReader (from apps/android) and commit the result."
        if (!sharedAssets.isDirectory) problems += "app/src/main/assets/reader-shared is missing."
        else {
            val src = relFiles(webReader)
            val dst = relFiles(sharedAssets)
            (src.keys - dst.keys).sorted().forEach { problems += "missing in the bundled copy: $it" }
            (dst.keys - src.keys).sorted().forEach { problems += "not in the web source: $it" }
            src.keys.intersect(dst.keys).sorted().filter { sha256(src.getValue(it)) != sha256(dst.getValue(it)) }
                .forEach { problems += "differs from the web source: $it" }
            val recorded = sharedAssets.resolve(profileFile).takeIf { it.isFile }?.readText()
            val web = webProfiles()
            val server = serverProfiles()
            if (web != server) problems += "engine profile: web app $web differs from the server $server"
            if (recorded != profileText(web)) problems += "engine profile: the bundled copy was built for ${recorded?.trim()?.replace('\n', ' ')}, the web app now uses ${profileText(web).trim().replace('\n', ' ')}"
        }
        if (problems.isNotEmpty())
            throw GradleException("The shared reader engine is out of step (ADR-0093):\n  " + problems.joinToString("\n  ") + "\n$fix")
    }
}
