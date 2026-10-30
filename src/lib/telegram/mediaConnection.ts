import type { TelegramClient } from "telegram";
import { getClient } from "./client";

// GramJS keeps separate connections for media DCs. The main connection can
// remain healthy while an idle media sender has already been disconnected.
async function removeClosedMediaSenders(client: TelegramClient) {
  // GramJS 2.26 keeps idle-release timers private; cancel the old timer before
  // removing its sender so it cannot race a replacement connection.
  const timers = (client as unknown as {
    _exportedSenderReleaseTimeouts: Map<number, ReturnType<typeof setTimeout>>;
  })._exportedSenderReleaseTimeouts;
  for (const [dc, pending] of [...client._exportedSenderPromises]) {
    const sender = await pending.catch(() => undefined);
    if (sender && sender.isConnected() && !sender.userDisconnected) continue;
    if (client._exportedSenderPromises.get(dc) !== pending) continue;
    const timer = timers.get(dc);
    if (timer) clearTimeout(timer);
    timers.delete(dc);
    client._exportedSenderPromises.delete(dc);
    await sender?.disconnect().catch(() => {});
  }
}

export function isRecoverableMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /disconnect|connection|network|timeout|file.?reference|fileref|RPC_CALL_FAIL|RPC_MCGET_FAIL/i.test(message);
}

export async function withMediaConnection<T>(
  operation: (client: TelegramClient) => Promise<T>,
): Promise<T> {
  const client = getClient();
  for (let attempt = 0; ; attempt++) {
    if (getClient() !== client) throw new Error("La cuenta de Telegram cambió.");
    try {
      if (!client.connected) await client.connect();
      await removeClosedMediaSenders(client);
      return await operation(client);
    } catch (error) {
      if (attempt >= 2 || !isRecoverableMediaError(error)) throw error;
      // The operation fetches a fresh message on every attempt, renewing expired
      // file references as well as replacing closed media connections.
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

export function mediaErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED/i.test(detail))
    return "La sesión de Telegram venció. Vuelve a iniciar sesión.";
  if (/mediaNotFound|not found|no está disponible|MESSAGE_ID_INVALID/i.test(detail))
    return "El archivo ya no está disponible en el canal de Telegram.";
  if (isRecoverableMediaError(error))
    return "Se interrumpió la descarga desde Telegram. Toca Reintentar para volver a conectarla.";
  return "No se pudo descargar el original desde Telegram. Inténtalo de nuevo.";
}
