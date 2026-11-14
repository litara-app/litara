package com.litara.core.data

import android.content.Context
import android.content.Intent
import android.os.Process

/** Relaunches the app in a fresh process, so singletons (like the database) are rebuilt. */
object ProcessRestarter {
    fun restart(context: Context, screen: Class<*>? = null) {
        val launch = (if (screen != null) Intent(context, screen) else context.packageManager.getLaunchIntentForPackage(context.packageName)) ?: return
        context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        Process.killProcess(Process.myPid())
    }
}
