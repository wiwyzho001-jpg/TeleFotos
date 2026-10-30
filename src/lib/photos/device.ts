import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { TeleFile } from "../types";
import { detectPlatform } from "../platform";

export const androidMedia = isTauri() && detectPlatform() === "android";
export interface MediaAccess {
  available: boolean;
  images: boolean;
  videos: boolean;
  partial: boolean;
}
export interface MediaPage {
  files: TeleFile[];
  hasMore: boolean;
  nextOffset: number;
}
export const mediaCommand = <T>(
  command: string,
  payload: Record<string, unknown> = {},
) => invoke<T>("media_library_command", { command, payload });
export const localAssetUrl = (path: string) => convertFileSrc(path);
export interface LocalMeta {
  starred?: boolean;
  albumNames?: string[];
  contentHash?: string;
}
function readMetadata(): Record<string, LocalMeta> {
  try {
    return JSON.parse(localStorage.getItem("telefotos_device_meta") ?? "{}");
  } catch {
    return {};
  }
}
interface DeviceState {
  files: TeleFile[];
  access: MediaAccess | null;
  loading: boolean;
  hasMore: boolean;
  offset: number;
  error: string;
  metadata: Record<string, LocalMeta>;
  checkAccess: () => Promise<void>;
  requestAccess: () => Promise<void>;
  load: (reset?: boolean) => Promise<void>;
  edit: (ids: string[], patch: LocalMeta) => void;
}
export const useDeviceStore = create<DeviceState>((set, get) => ({
  files: [],
  access: null,
  loading: false,
  hasMore: false,
  offset: 0,
  error: "",
  metadata: readMetadata(),
  checkAccess: async () => {
    if (!androidMedia) return;
    try {
      const access = await mediaCommand<MediaAccess>("accessStatus");
      set({ access });
      if (access.available) await get().load(true);
      else set({ files: [], hasMore: false });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  requestAccess: async () => {
    try {
      const access = await mediaCommand<MediaAccess>("requestAccess");
      set({ access });
      if (access.available) await get().load(true);
    } catch (error) {
      set({ error: String(error) });
    }
  },
  load: async (reset = false) => {
    if (get().loading) return;
    set({ loading: true, error: "" });
    try {
      const access = await mediaCommand<MediaAccess>("accessStatus");
      set({ access });
      if (!access.available) {
        set({ files: [], hasMore: false, offset: 0 });
        return;
      }
      const page = await mediaCommand<MediaPage>("listMedia", {
        offset: reset ? 0 : get().offset,
        limit: 250,
      });
      set((state) => ({
        files: reset ? page.files : [...state.files, ...page.files],
        hasMore: page.hasMore,
        offset: page.nextOffset,
      }));
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ loading: false });
    }
  },
  edit: (ids, patch) => {
    const keys = new Set(
      get()
        .files.filter(
          (file) =>
            ids.includes(file.id) || ids.includes(file.deviceSourceKey!),
        )
        .map((file) => file.deviceSourceKey!),
    );
    set((state) => {
      const metadata = { ...state.metadata };
      for (const key of keys)
        metadata[key] = {
          ...metadata[key],
          ...patch,
          albumNames: patch.albumNames
            ? [
                ...new Set([
                  ...(metadata[key]?.albumNames ?? []),
                  ...patch.albumNames,
                ]),
              ]
            : metadata[key]?.albumNames,
        };
      localStorage.setItem("telefotos_device_meta", JSON.stringify(metadata));
      return { metadata };
    });
  },
}));

/** Merge remote metadata with local bytes so backed-up photos appear once. */
export function mergeDevicePhotos(
  remote: TeleFile[],
  local: TeleFile[],
  metadata: Record<string, LocalMeta>,
): TeleFile[] {
  const bySource = new Map(
    remote
      .filter((file) => file.deviceSourceKey)
      .map((file) => [file.deviceSourceKey!, file]),
  );
  const byHash = new Map(
    remote
      .filter((file) => file.contentHash)
      .map((file) => [file.contentHash!, file]),
  );
  const linked = new Set<string>();
  const visibleLocal = local
    .map((file) => {
      const meta = metadata[file.deviceSourceKey!];
      const saved =
        bySource.get(file.deviceSourceKey!) ??
        (meta?.contentHash ? byHash.get(meta.contentHash) : undefined);
      if (saved && linked.has(saved.id)) return null;
      if (saved) linked.add(saved.id);
      return saved
        ? { ...saved, localUri: file.localUri, deviceFolder: file.deviceFolder }
        : { ...file, ...meta };
    })
    .filter((file): file is TeleFile => file !== null);
  const localKeys = new Set(local.map((file) => file.deviceSourceKey));
  return [
    ...remote.filter(
      (file) =>
        !linked.has(file.id) &&
        (!file.deviceSourceKey || !localKeys.has(file.deviceSourceKey)),
    ),
    ...visibleLocal,
  ];
}
