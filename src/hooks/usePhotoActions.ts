import { useFileActions } from "./useFileActions";
import { mediaCommand, useDeviceStore } from "@/lib/photos/device";
import type { TeleFile } from "@/lib/types";
import { toast } from "sonner";

export function usePhotoActions() {
  const remote = useFileActions();
  const editLocal = (
    files: TeleFile[],
    patch: { starred?: boolean; albumNames?: string[] },
  ) =>
    useDeviceStore.getState().edit(
      files
        .filter((file) => file.localUri)
        .map((file) => file.deviceSourceKey!),
      patch,
    );
  return {
    removeAlbum: remote.removeAlbum,
    setAlbumCover: remote.setAlbumCover,
    emptyTrash: remote.emptyTrash,
    deleteMultiplePermanently: remote.deleteMultiplePermanently,
    deletePermanently: remote.deletePermanently,
    toggleStar: async (file: TeleFile) => {
      if (file.localUri) editLocal([file], { starred: !file.starred });
      if (file.messageId) await remote.toggleStar(file);
    },
    star: async (files: TeleFile[]) => {
      editLocal(files, { starred: true });
      const ids = files.filter((file) => file.messageId).map((file) => file.id);
      if (ids.length) await remote.starMultiple(ids);
    },
    album: async (files: TeleFile[], name: string) => {
      editLocal(files, { albumNames: [name.trim()] });
      const ids = files.filter((file) => file.messageId).map((file) => file.id);
      if (ids.length) await remote.addToAlbum(ids, name);
    },
    trash: async (files: TeleFile[], restore = false) => {
      try {
        const local = files.filter((file) => file.localUri);
        if (local.length) {
          const { changed } = await mediaCommand<{ changed: boolean }>(
            "trash",
            { uris: local.map((file) => file.localUri), restore },
          );
          if (!changed) return;
          await useDeviceStore.getState().load(true);
        }
        const ids = files
          .filter((file) => file.messageId)
          .map((file) => file.id);
        if (ids.length) {
          if (restore) await remote.restoreMultipleFromTrash(ids);
          else await remote.moveMultipleToTrash(ids);
        }
      } catch (error) {
        toast.error(String(error));
      }
    },
  };
}
