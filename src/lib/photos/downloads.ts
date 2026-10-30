import { create } from "zustand";
import { toast } from "sonner";
import type { TeleFile } from "../types";
import { androidMedia, mediaCommand } from "./device";
import { downloadFileFromTelegram, downloadFileToBuffer } from "../telegram/downloader";
import { useAuthStore } from "@/stores/authStore";

export const usePhotoDownloads = create<{ running: boolean; completed: number; total: number; progress: number }>(() => ({
  running: false, completed: 0, total: 0, progress: 0,
}));

export async function saveAndroidOriginal(file: TeleFile, bytes: Uint8Array) {
  const { token } = await mediaCommand<{ token: string }>("createDownload", { name: file.name, mime: file.mime, size: bytes.length });
  try {
    for (let offset = 0; offset < bytes.length; offset += 384 * 1024) {
      const part = bytes.subarray(offset, Math.min(bytes.length, offset + 384 * 1024));
      let binary = "";
      for (let start = 0; start < part.length; start += 8192)
        binary += String.fromCharCode(...part.subarray(start, start + 8192));
      await mediaCommand("appendDownload", { token, data: btoa(binary) });
    }
    await mediaCommand("finishDownload", { token });
  } catch (error) {
    await mediaCommand("abortDownload", { token }).catch(() => {});
    throw error;
  }
}

export async function downloadPhotos(files: TeleFile[]): Promise<string[]> {
  if (!files.length || usePhotoDownloads.getState().running) return [];
  const account = useAuthStore.getState().phoneNumber;
  const completed: string[] = [];
  usePhotoDownloads.setState({ running: true, completed: 0, total: files.length, progress: 0 });
  const toastId = toast.loading(`Descargando 1 de ${files.length}…`);
  try {
    for (let index = 0; index < files.length; index++) {
      if (useAuthStore.getState().phoneNumber !== account) break;
      const file = files[index];
      try {
        toast.loading(`Descargando ${index + 1} de ${files.length}…`, { id: toastId });
        if (androidMedia) {
          const bytes = await downloadFileToBuffer(file.channelId, file.messageId, progress => usePhotoDownloads.setState({ progress }));
          if (useAuthStore.getState().phoneNumber !== account) throw new Error("La cuenta cambió");
          await saveAndroidOriginal(file, bytes);
        } else {
          const saved = await downloadFileFromTelegram(file.channelId, file.messageId, file.name);
          if (!saved) continue;
        }
        completed.push(file.id);
      } catch (error) {
        console.warn("No se pudo guardar un original:", error);
      }
      usePhotoDownloads.setState({ completed: completed.length, progress: 0 });
    }
    const failed = files.length - completed.length;
    if (failed) toast.error(`${completed.length} guardados; ${failed} no se pudieron descargar. Puedes reintentarlos.`, { id: toastId });
    else toast.success(androidMedia ? `${completed.length} originales guardados en la galería, carpeta PhoGram` : `${completed.length} originales descargados`, { id: toastId });
    return completed;
  } finally { usePhotoDownloads.setState({ running: false }); }
}
