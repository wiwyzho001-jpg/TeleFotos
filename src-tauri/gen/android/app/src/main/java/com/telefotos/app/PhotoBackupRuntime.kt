package com.telefotos.app

import android.webkit.WebView
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

/** Bridges a persistent WorkManager request to TeleFotos' authenticated GramJS runtime. */
internal object PhotoBackupRuntime {
    enum class Outcome { SUCCESS, RETRY, DISABLED }

    private data class Request(
        val latch: CountDownLatch = CountDownLatch(1),
        val outcome: AtomicReference<Outcome?> = AtomicReference(null),
    )

    @Volatile private var webView = WeakReference<WebView>(null)
    private val requests = ConcurrentHashMap<String, Request>()

    fun attach(view: WebView) {
        webView = WeakReference(view)
    }

    fun detach(view: WebView) {
        if (webView.get() === view) webView.clear()
    }

    fun handleBack(callback: (Boolean) -> Unit) {
        val view = webView.get()
        if (view == null) { callback(false); return }
        view.evaluateJavascript("Boolean(window.__telefotosHandleBack && window.__telefotosHandleBack())") {
            callback(it == "true")
        }
    }

    fun dispatch(phone: String): String? {
        val view = webView.get() ?: return null
        val id = UUID.randomUUID().toString()
        val request = Request()
        requests[id] = request
        val event = "window.dispatchEvent(new CustomEvent('telefotos-background-backup',{detail:{requestId:" +
            JSONObject.quote(id) + ",phone:" + JSONObject.quote(phone) + "}}));"
        view.post {
            if (requests.containsKey(id)) {
                view.evaluateJavascript(event) { }
            }
        }
        return id
    }

    fun complete(id: String, outcome: Outcome): Boolean {
        val request = requests[id] ?: return false
        request.outcome.set(outcome)
        request.latch.countDown()
        return true
    }

    fun await(id: String, timeout: Long, unit: TimeUnit): Outcome? {
        val request = requests[id] ?: return null
        return try {
            if (request.latch.await(timeout, unit)) request.outcome.get() else null
        } finally {
            requests.remove(id, request)
        }
    }
}
