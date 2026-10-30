package com.telefotos.app

import android.os.Bundle
import android.os.SystemClock
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var lastExitPress = 0L
  private var handlingBack = false
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (handlingBack) return
        handlingBack = true
        PhotoBackupRuntime.handleBack { handled ->
          handlingBack = false
          if (handled) {
            lastExitPress = 0L
          } else {
            val now = SystemClock.elapsedRealtime()
            if (lastExitPress != 0L && now - lastExitPress < 2000L) {
              lastExitPress = 0L
              moveTaskToBack(true)
            } else {
              lastExitPress = now
              Toast.makeText(this@MainActivity, "Pulsa Atrás otra vez para salir", Toast.LENGTH_SHORT).show()
            }
          }
        }
      }
    })
  }
}
