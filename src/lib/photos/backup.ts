import { create } from "zustand";
import {
  androidMedia,
  mediaCommand,
  type MediaPage,
  useDeviceStore,
} from "./device";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { processQueue } from "@/lib/upload/uploadManager";
import type { TeleFile } from "@/lib/types";

export interface BackupPreferences {
  enabled: boolean;
  wifiOnly: boolean;
  folders: string[];
}
const defaults: BackupPreferences = {
  enabled: false,
  wifiOnly: true,
  folders: ["Camera", "Cámara"],
};
function key(phone: string) {
  return `telefotos_backup_${phone}`;
}
export function readBackupPreferences(phone: string): BackupPreferences {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(key(phone)) ?? "{}"),
    };
  } catch {
    return { ...defaults };
  }
}
interface BackupState {
  running: boolean;
  completed: number;
  skipped: number;
  error: string;
  status: string;
  cancel: boolean;
  stop: () => void;
}
export const usePhotoBackup = create<BackupState>((set) => ({
  running: false,
  completed: 0,
  skipped: 0,
  error: "",
  status: "",
  cancel: false,
  stop: () =>
    set({ cancel: true, status: "Deteniendo después del archivo actual…" }),
}));
export function saveBackupPreferences(
  phone: string,
  preferences: BackupPreferences,
  runNow = false,
) {
  localStorage.setItem(key(phone), JSON.stringify(preferences));
  if (!preferences.enabled) usePhotoBackup.getState().stop();
  if (androidMedia) {
    return mediaCommand("configurePhotoBackup", {
      phone,
      enabled: preferences.enabled,
      wifiOnly: preferences.wifiOnly,
      runNow,
    });
  }
  return Promise.resolve();
}

function waitForUpload(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const item = useFileStore
        .getState()
        .uploadQueue.find((item) => item.id === id);
      if (item?.status === "done") {
        unsubscribe();
        resolve();
      } else if (item?.status === "error") {
        unsubscribe();
        reject(new Error(item.error ?? "Falló la subida"));
      } else if (!item) {
        unsubscribe();
        reject(new Error("Se canceló la subida"));
      }
    };
    const unsubscribe = useFileStore.subscribe(check);
    check();
  });
}
function requireAccount(phone: string) {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.phoneNumber !== phone)
    throw new Error("La cuenta cambió. Vuelve a iniciar el respaldo.");
}
export async function backupLocalPhoto(
  photo: TeleFile,
  phone: string,
  wifiOnly = true,
): Promise<boolean> {
  requireAccount(phone);
  if (!photo.localUri) return false;
  if (
    useFileStore
      .getState()
      .files.some(
        (file) =>
          file.deviceSourceKey === photo.deviceSourceKey && !file.trashed,
      )
  )
    return false;
  const prepared = await mediaCommand<{
    path: string;
    contentHash: string;
    size: number;
  }>("prepare", { uri: photo.localUri });
  let uploadId: string | undefined;
  try {
    requireAccount(phone);
    useDeviceStore
      .getState()
      .edit([photo.deviceSourceKey!], { contentHash: prepared.contentHash });
    if (
      useFileStore
        .getState()
        .files.some(
          (file) => file.contentHash === prepared.contentHash && !file.trashed,
        )
    )
      return false;
    const thumbnail = await mediaCommand<{ url: string }>("thumbnail", {
      uri: photo.localUri,
    }).catch(() => null);
    requireAccount(phone);
    uploadId = crypto.randomUUID();
    useFileStore.getState().addToQueue({
      id: uploadId,
      name: photo.name,
      size: prepared.size,
      progress: 0,
      status: "pending",
      folderPath: "/TeleFotos",
      file: {
        name: photo.name,
        size: prepared.size,
        path: prepared.path,
        type: photo.mime,
        capturedAt: photo.capturedAt,
        contentHash: prepared.contentHash,
        deviceSourceKey: photo.deviceSourceKey,
        starred: photo.starred,
        albumNames: photo.albumNames,
        thumbnailData: thumbnail?.url.split(",")[1],
      },
      accountPhone: phone,
      wifiOnly,
    });
    const completion = waitForUpload(uploadId);
    void processQueue();
    await completion;
    return true;
  } finally {
    if (uploadId) useFileStore.getState().removeFromQueue(uploadId);
    await mediaCommand("release", { path: prepared.path }).catch(() => {});
  }
}
export async function runPhotoBackup(photos?: TeleFile[]): Promise<void> {
  if (!androidMedia || usePhotoBackup.getState().running) return;
  const phone = useAuthStore.getState().phoneNumber;
  if (!phone || !useAuthStore.getState().isAuthenticated)
    throw new Error("Conecta Telegram para respaldar tus fotos.");
  const preferences = readBackupPreferences(phone);
  usePhotoBackup.setState({
    running: true,
    cancel: false,
    completed: 0,
    skipped: 0,
    error: "",
    status: "Preparando respaldo…",
  });
  try {
    // Read all pages, not only the portion currently rendered in the gallery.
    const items: TeleFile[] = [];
    if (photos) items.push(...photos);
    else {
      let offset = 0;
      do {
        if (usePhotoBackup.getState().cancel) break;
        const page = await mediaCommand<MediaPage>("listMedia", {
          offset,
          limit: 500,
        });
        items.push(
          ...page.files.filter((file) =>
            preferences.folders.includes(file.deviceFolder ?? ""),
          ),
        );
        offset = page.hasMore ? page.nextOffset : -1;
      } while (offset >= 0);
    }
    for (const raw of items) {
      if (usePhotoBackup.getState().cancel) break;
      requireAccount(phone);
      if (
        !useFileStore.getState().bootstrapComplete ||
        useFileStore.getState().isSyncing
      )
        throw new Error("Espera a que termine la sincronización de Telegram.");
      const network = await mediaCommand<{
        online: boolean;
        unmetered: boolean;
      }>("networkStatus");
      if (!network.online)
        throw new Error(
          "Sin conexión. El respaldo continuará al volver a abrir la app.",
        );
      if (preferences.wifiOnly && !network.unmetered)
        throw new Error("En espera de una conexión Wi-Fi sin límite de datos.");
      const meta = useDeviceStore.getState().metadata[raw.deviceSourceKey!];
      const photo = { ...raw, ...meta };
      usePhotoBackup.setState({ status: `Respaldando ${photo.name}` });
      const uploaded = await backupLocalPhoto(
        photo,
        phone,
        preferences.wifiOnly,
      );
      usePhotoBackup.setState((state) =>
        uploaded
          ? { completed: state.completed + 1 }
          : { skipped: state.skipped + 1 },
      );
    }
    usePhotoBackup.setState({
      status: usePhotoBackup.getState().cancel
        ? "Respaldo detenido"
        : "Respaldo completado",
    });
  } catch (error) {
    usePhotoBackup.setState({
      error: String(error),
      status: "Respaldo en pausa",
    });
  } finally {
    usePhotoBackup.setState({ running: false });
  }
}
