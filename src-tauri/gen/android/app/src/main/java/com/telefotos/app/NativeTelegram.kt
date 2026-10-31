package com.telefotos.app

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Persistent TDLib client shared by the settings login flow and WorkManager. */
internal object NativeTelegram {
    private const val PREFS = "phogram-tdlib"
    private val lock = Object()
    @Volatile private var client: Client? = null
    @Volatile private var activePhone = ""
    @Volatile private var authState = "disconnected"
    @Volatile private var lastError = ""
    @Volatile private var parametersReady = false

    data class Status(val state: String, val error: String = "")

    fun status(context: Context, expectedPhone: String = ""): Status {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val storedPhone = prefs.getString("phone", "") ?: ""
        if (expectedPhone.isNotBlank() && storedPhone != expectedPhone)
            return Status("account_mismatch", "Vuelve a conectar Telegram para esta cuenta.")
        if (client == null && prefs.contains("apiId") && prefs.contains("apiHash") && storedPhone.isNotBlank()) {
            try { initialize(context, storedPhone, prefs.getInt("apiId", 0), prefs.getString("apiHash", "") ?: "") }
            catch (error: Exception) { return Status("error", error.message ?: "No se pudo iniciar Telegram en segundo plano") }
        }
        return Status(authState, lastError)
    }

    fun beginLogin(context: Context, phone: String, apiId: Int, apiHash: String): Status {
        require(phone.matches(Regex("^\\+[1-9][0-9]{6,14}$"))) { "Escribe el teléfono con código de país, por ejemplo +52…" }
        require(apiId > 0 && apiHash.isNotBlank()) { "Faltan las credenciales de Telegram" }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putInt("apiId", apiId).putString("apiHash", apiHash).putString("phone", phone).apply()
        initialize(context, phone, apiId, apiHash)
        val current = awaitState(setOf("phone_required", "code_required", "password_required", "ready", "error"), 30)
        if (current.state == "phone_required") {
            send(TdApi.SetAuthenticationPhoneNumber(phone, TdApi.PhoneNumberAuthenticationSettings()))
            return awaitState(setOf("code_required", "password_required", "ready", "error"), 45)
        }
        return current
    }

    fun submitCode(context: Context, code: String): Status {
        require(code.isNotBlank()) { "Escribe el código que envió Telegram" }
        status(context)
        send(TdApi.CheckAuthenticationCode(code.trim()))
        return awaitState(setOf("password_required", "ready", "error"), 45)
    }

    fun submitPassword(context: Context, password: String): Status {
        require(password.isNotBlank()) { "Escribe la contraseña de verificación en dos pasos" }
        status(context)
        send(TdApi.CheckAuthenticationPassword(password))
        return awaitState(setOf("ready", "error"), 45)
    }

    fun requireAuthorized(context: Context, expectedPhone: String): Client {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val apiId = prefs.getInt("apiId", 0)
        val apiHash = prefs.getString("apiHash", "") ?: ""
        val phone = prefs.getString("phone", "") ?: ""
        if (apiId <= 0 || apiHash.isBlank()) throw IllegalStateException("Conecta Telegram para activar el respaldo en segundo plano")
        if (phone != expectedPhone) throw IllegalStateException("Conecta Telegram de nuevo para la cuenta actual")
        initialize(context, phone, apiId, apiHash)
        val current = awaitState(setOf("ready", "phone_required", "code_required", "password_required", "error"), 60)
        if (current.state != "ready") throw IllegalStateException(current.error.ifBlank { "Completa la conexión de Telegram en los ajustes de PhoGram" })
        return client ?: throw IllegalStateException("El cliente de Telegram no está disponible")
    }

    fun <T : TdApi.Object> request(client: Client, function: TdApi.Function<T>, timeoutSeconds: Long = 120): T {
        val result = CompletableFuture<TdApi.Object>()
        client.send(function, { result.complete(it) }, { result.completeExceptionally(it) })
        val response = result.get(timeoutSeconds, TimeUnit.SECONDS)
        if (response is TdApi.Error) throw IllegalStateException("Telegram: ${response.message}")
        @Suppress("UNCHECKED_CAST")
        return response as T
    }

    private fun initialize(context: Context, phone: String, apiId: Int, apiHash: String) {
        synchronized(lock) {
            if (client != null && activePhone == phone) return
            if (client != null) {
                try { request(client!!, TdApi.Close(), 15) } catch (_: Exception) { }
                client = null
            }
            activePhone = phone
            authState = "starting"
            lastError = ""
            parametersReady = false
            client = Client.create({ result -> handleUpdate(context.applicationContext, result, phone, apiId, apiHash) },
                { error -> if (activePhone == phone) setError(error.message ?: "Error de Telegram") },
                { error -> if (activePhone == phone) setError(error.message ?: "Error de Telegram") })
        }
    }

    private fun handleUpdate(context: Context, update: TdApi.Object, phone: String, apiId: Int, apiHash: String) {
        if (activePhone != phone) return
        if (update !is TdApi.UpdateAuthorizationState) return
        when (val state = update.authorizationState) {
            is TdApi.AuthorizationStateWaitTdlibParameters -> {
                if (parametersReady) return
                parametersReady = true
                val root = context.filesDir.resolve("phogram-telegram").resolve(accountId(phone)).apply { mkdirs() }
                val params = TdApi.SetTdlibParameters(
                    false, root.resolve("database").absolutePath, root.resolve("files").absolutePath,
                    databaseKey(context, phone), false, true, true, false, apiId, apiHash,
                    "es", "PhoGram Android", Build.VERSION.RELEASE, "0.1.7",
                )
                sendAsync(params, "No se pudo preparar Telegram")
            }
            is TdApi.AuthorizationStateWaitPhoneNumber -> setState("phone_required")
            is TdApi.AuthorizationStateWaitCode -> setState("code_required")
            is TdApi.AuthorizationStateWaitPassword -> setState("password_required")
            is TdApi.AuthorizationStateReady -> setState("ready")
            is TdApi.AuthorizationStateClosing, is TdApi.AuthorizationStateClosed -> setState("closed")
            else -> setState("starting")
        }
    }

    private fun databaseKey(context: Context, phone: String): ByteArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val account = accountId(phone)
        val preferenceKey = "dbKey_$account"
        val keyAlias = "phogram-tdlib-$account"
        val encrypted = prefs.getString(preferenceKey, null)
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val secretKey = (keyStore.getKey(keyAlias, null) as? javax.crypto.SecretKey) ?:
            javax.crypto.KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        if (encrypted != null) {
            val packed = Base64.decode(encrypted, Base64.NO_WRAP)
            val iv = packed.copyOfRange(0, 12)
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, secretKey, javax.crypto.spec.GCMParameterSpec(128, iv))
            return cipher.doFinal(packed.copyOfRange(12, packed.size))
        }
        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, secretKey)
        prefs.edit().putString(preferenceKey, Base64.encodeToString(cipher.iv + cipher.doFinal(raw), Base64.NO_WRAP)).apply()
        return raw
    }

    private fun accountId(phone: String): String = java.security.MessageDigest.getInstance("SHA-256")
        .digest(phone.toByteArray()).take(12).joinToString("") { "%02x".format(it) }

    private fun send(function: TdApi.Function<*>) {
        val active = client ?: throw IllegalStateException("Telegram no se ha inicializado")
        request(active, function)
    }

    private fun sendAsync(function: TdApi.Function<*>, errorMessage: String) {
        val active = client ?: return
        active.send(function, { result ->
            if (result is TdApi.Error) setError(result.message.ifBlank { errorMessage })
        }, { error -> setError(error.message ?: errorMessage) })
    }

    private fun awaitState(states: Set<String>, timeoutSeconds: Long): Status {
        val deadline = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(timeoutSeconds)
        synchronized(lock) {
            while (authState !in states && System.currentTimeMillis() < deadline) {
                TimeUnit.MILLISECONDS.timedWait(lock, (deadline - System.currentTimeMillis()).coerceAtLeast(1))
            }
        }
        val state = authState
        if (state !in states) return Status("error", "Telegram tardó demasiado en responder. Inténtalo de nuevo.")
        return Status(state, lastError)
    }

    private fun setState(value: String) { synchronized(lock) { authState = value; lastError = ""; lock.notifyAll() } }
    private fun setError(value: String) { synchronized(lock) { authState = "error"; lastError = value; lock.notifyAll() } }
}
