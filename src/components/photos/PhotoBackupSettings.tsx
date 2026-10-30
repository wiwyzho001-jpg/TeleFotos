import { useState } from "react";
import { CloudUpload, X } from "lucide-react";
import {
  readBackupPreferences,
  runPhotoBackup,
  saveBackupPreferences,
  usePhotoBackup,
} from "@/lib/photos/backup";
import { useDeviceStore } from "@/lib/photos/device";
import { toast } from "sonner";

export default function PhotoBackupSettings({
  phone,
  onClose,
  embedded = false,
}: {
  phone: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [preferences, setPreferences] = useState(() =>
    readBackupPreferences(phone),
  );
  const device = useDeviceStore();
  const backup = usePhotoBackup();
  const folders = [
    ...new Set([
      ...preferences.folders,
      ...device.files.map((file) => file.deviceFolder ?? "Sin carpeta"),
    ]),
  ].sort();
  async function save(next: typeof preferences) {
    const runNow = next.enabled && !preferences.enabled;
    setPreferences(next);
    try {
      await saveBackupPreferences(phone, next, runNow);
      if (runNow) toast.success("Respaldo automático activado");
    } catch (error) {
      toast.error(`No se pudo programar el respaldo: ${String(error)}`);
    }
  }
  return (
    <div className={embedded ? "tf-backup-settings" : "tf-scrim"}>
      <section
        className={embedded ? "tf-sheet tf-sheet-embedded" : "tf-sheet"}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label="Respaldo de fotos"
      >
        {!embedded && <button
          className="tf-sheet-close"
          aria-label="Cerrar respaldo"
          onClick={onClose}
        >
          <X />
        </button>}
        <h2>Respaldo de fotos</h2>
        <p>Guarda los originales en tu canal privado de Telegram.</p>
        <label className="tf-setting">
          <span>Respaldo automático (también en segundo plano)</span>
          <input
            type="checkbox"
            checked={preferences.enabled}
            onChange={(event) =>
              void save({ ...preferences, enabled: event.target.checked })
            }
          />
        </label>
        <label className="tf-setting">
          <span>Solo Wi-Fi sin límite de datos</span>
          <input
            type="checkbox"
            checked={preferences.wifiOnly}
            onChange={(event) =>
              void save({ ...preferences, wifiOnly: event.target.checked })
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
                checked={preferences.folders.includes(folder)}
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
          <button
            className="tf-sheet-row"
            disabled={device.loading}
            onClick={() => void device.load()}
          >
            Mostrar más carpetas
          </button>
        )}
        <p className="tf-notice">
          Android programa revisiones en segundo plano y puede demorarlas para
          ahorrar batería. Si el sistema detiene TeleFotos, el respaldo continúa
          cuando vuelvas a abrirla. Las subidas usan una notificación y respetan
          tu cuenta, las carpetas elegidas y el límite de Wi-Fi. No se borran
          los originales.
        </p>
        {backup.status && (
          <p role="status">
            {backup.status} · {backup.completed} subidas · {backup.skipped} ya
            respaldadas
          </p>
        )}
        {backup.error && (
          <p className="tf-notice" role="alert">
            {backup.error}
          </p>
        )}
        <button
          className="tf-primary"
          disabled={!device.access?.available}
          onClick={() => {
            if (backup.running) backup.stop();
            else
              void runPhotoBackup().catch((error) =>
                toast.error(String(error)),
              );
          }}
        >
          <CloudUpload />
          {backup.running ? "Detener" : "Respaldar ahora"}
        </button>
      </section>
    </div>
  );
}
