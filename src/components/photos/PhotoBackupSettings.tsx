import { useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { CloudUpload, X } from "lucide-react";
import { Api } from "telegram";
import {
  readBackupPreferences,
  runPhotoBackup,
  saveBackupPreferences,
  usePhotoBackup,
} from "@/lib/photos/backup";
import { androidMedia, mediaCommand, useDeviceStore } from "@/lib/photos/device";
import { DEFAULT_API_HASH, DEFAULT_API_ID } from "@/lib/telegram/config";
import { getClient } from "@/lib/telegram/client";
import { getSecret, VAULT_KEY_API_HASH, VAULT_KEY_API_ID } from "@/lib/secure/vault";
import { toast } from "sonner";

type NativeTelegramStatus = { state: string; error: string; link?: string };

function BackgroundTelegramAuth({
  phone,
  onReadyChange,
}: {
  phone: string;
  onReadyChange: (ready: boolean) => void;
}) {
  const [status, setStatus] = useState<NativeTelegramStatus>({ state: "disconnected", error: "" });
  const [busy, setBusy] = useState(false);
  const lastQrLink = useRef("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await mediaCommand<NativeTelegramStatus>("nativeTelegramStatus", { phone });
        if (active) setStatus(next);
      } catch (error) {
        if (active) setStatus({ state: "error", error: String(error) });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [phone]);

  useEffect(() => onReadyChange(status.state === "ready"), [status.state, onReadyChange]);

  useEffect(() => {
    const link = status.state === "qr_required" ? status.link : "";
    if (!link || link === lastQrLink.current) return;
    lastQrLink.current = link;
    let active = true;
    void (async () => {
      try {
        const client = getClient();
        if (!client.connected) await client.connect();
        const encoded = /[?&]token=([^&]+)/.exec(link)?.[1];
        if (!encoded) throw new Error("Telegram devolvió un enlace de autorización no válido.");
        const token = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        await client.invoke(new Api.auth.AcceptLoginToken({ token }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/AUTH_TOKEN_(EXPIRED|INVALID)|TOKEN_(EXPIRED|INVALID)/i.test(message) && active) {
          setStatus({ state: "error", error: `No se pudo autorizar con la sesión abierta de PhoGram: ${message}` });
        }
      }
    })();
    return () => { active = false; };
  }, [status.state, status.link]);

  async function connect() {
    setBusy(true);
    try {
      const [customId, customHash] = await Promise.all([
        getSecret(VAULT_KEY_API_ID),
        getSecret(VAULT_KEY_API_HASH),
      ]);
      const parsedId = customId ? Number.parseInt(customId, 10) : DEFAULT_API_ID;
      const next = await mediaCommand<NativeTelegramStatus>("beginNativeTelegramLogin", {
        phone,
        apiId: Number.isFinite(parsedId) ? parsedId : DEFAULT_API_ID,
        apiHash: customHash || DEFAULT_API_HASH,
      });
      setStatus(next);
    } catch (error) {
      setStatus({ state: "error", error: String(error) });
    } finally {
      setBusy(false);
    }
  }

  if (status.state === "ready") {
    return <p className="tf-notice">Telegram está conectado para respaldar aunque PhoGram esté cerrada.</p>;
  }

  return (
    <div className="tf-background-telegram">
      <strong>Conexión de Telegram para respaldo en segundo plano</strong>
      <button className="tf-sheet-row" disabled={busy || !androidMedia || status.state === "starting" || status.state === "qr_required"} onClick={() => void connect()}>
        {busy || status.state === "starting" || status.state === "qr_required"
          ? "Autorizando con tu sesión actual…"
          : "Autorizar con la sesión de PhoGram"}
      </button>
      {(status.state === "starting" || status.state === "qr_required") && <span>Telegram está vinculando el respaldo con la cuenta ya iniciada. No hace falta otro código.</span>}
      {(status.state === "error" || status.error) && <span role="alert">{status.error}</span>}
      <span>Al autorizar, Telegram guardará esta sesión de respaldo en tu dispositivo.</span>
    </div>
  );
}

export default function PhotoBackupSettings({
  phone,
  onClose,
  embedded = false,
}: {
  phone: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [preferences, setPreferences] = useState(() => readBackupPreferences(phone));
  const [nativeReady, setNativeReady] = useState(false);
  const device = useDeviceStore();
  const backup = usePhotoBackup();
  const folders = [
    ...new Set([
      ...preferences.folders,
      ...device.files.map((file) => file.deviceFolder ?? "Sin carpeta"),
    ]),
  ].sort();

  async function save(next: typeof preferences) {
    if (next.enabled && !nativeReady) {
      toast.error("Conecta Telegram para el respaldo automático en segundo plano.");
      return;
    }
    const runNow = next.enabled && !preferences.enabled;
    setPreferences(next);
    try {
      await saveBackupPreferences(phone, next, runNow);
      if (runNow) toast.success("Respaldo automático activado");
    } catch (error) {
      setPreferences(preferences);
      toast.error(`No se pudo programar el respaldo: ${String(error)}`);
    }
  }

  useEffect(() => {
    if (!nativeReady || !preferences.enabled) return;
    void saveBackupPreferences(phone, preferences).catch((error) =>
      toast.error(`No se pudo reactivar el respaldo: ${String(error)}`),
    );
  }, [nativeReady, phone, preferences]);

  return (
    <div className={embedded ? "tf-backup-settings" : "tf-scrim"}>
      <section
        className={embedded ? "tf-sheet tf-sheet-embedded" : "tf-sheet"}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label="Respaldo de fotos"
      >
        {!embedded && (
          <button className="tf-sheet-close" aria-label="Cerrar respaldo" onClick={onClose}>
            <X />
          </button>
        )}
        <h2>Respaldo de fotos</h2>
        <p>Guarda los originales en tu canal privado de Telegram.</p>
        {androidMedia && <BackgroundTelegramAuth phone={phone} onReadyChange={setNativeReady} />}
        <label className="tf-setting">
          <span>Respaldo automático, incluso con PhoGram cerrada</span>
          <input
            type="checkbox"
            checked={preferences.enabled}
            onChange={(event) => void save({ ...preferences, enabled: event.target.checked })}
          />
        </label>
        <label className="tf-setting">
          <span>Solo Wi-Fi sin límite de datos</span>
          <input
            type="checkbox"
            checked={preferences.wifiOnly}
            onChange={(event) => void save({ ...preferences, wifiOnly: event.target.checked })}
          />
        </label>
        <label className="tf-setting">
          <span>Todas las carpetas de fotos y videos</span>
          <input
            type="checkbox"
            checked={preferences.allFolders}
            onChange={(event) =>
              void save({
                ...preferences,
                allFolders: event.target.checked,
                folders: event.target.checked ? preferences.folders : folders,
              })
            }
          />
        </label>
        <h3>Carpetas del dispositivo</h3>
        <div className="tf-folder-options">
          {folders.map((folder) => (
            <label key={folder} className="tf-setting">
              <span>{folder}</span>
              <input
                type="checkbox"
                checked={preferences.allFolders || preferences.folders.includes(folder)}
                disabled={preferences.allFolders}
                onChange={(event) =>
                  void save({
                    ...preferences,
                    folders: event.target.checked
                      ? [...preferences.folders, folder]
                      : preferences.folders.filter((item) => item !== folder),
                  })
                }
              />
            </label>
          ))}
        </div>
        {device.hasMore && (
          <button className="tf-sheet-row" disabled={device.loading} onClick={() => void device.load()}>
            Mostrar más carpetas
          </button>
        )}
        <p className="tf-notice">
          Android revisa las fotos y videos cada 15 minutos como mínimo y puede demorar la tarea para ahorrar batería. La subida usa una notificación, requiere permiso para todas las fotos y videos, y respeta las carpetas y el límite de Wi-Fi. No se borran los originales.
        </p>
        {backup.status && (
          <p role="status">{backup.status} · {backup.completed} subidas · {backup.skipped} ya respaldadas</p>
        )}
        {backup.error && <p className="tf-notice" role="alert">{backup.error}</p>}
        <button
          className="tf-primary"
          disabled={!device.access?.available}
          onClick={() => {
            if (backup.running) backup.stop();
            else void runPhotoBackup().catch((error) => toast.error(String(error)));
          }}
        >
          <CloudUpload />
          {backup.running ? "Detener" : "Respaldar ahora"}
        </button>
      </section>
    </div>
  );
}
