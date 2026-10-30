import type { TeleFile } from "../types";

export function removeAlbum(files: TeleFile[], name: string): TeleFile[] {
  return files.map(file => ({
    ...file,
    albumNames: file.albumNames?.filter(album => album !== name),
    albumCoverFor: file.albumCoverFor?.filter(album => album !== name),
  }));
}

export function setAlbumCover(files: TeleFile[], name: string, fileId: string): TeleFile[] {
  if (!files.some(file => file.id === fileId && file.albumNames?.includes(name) && !file.trashed))
    throw new Error("Elige una foto o video de este álbum.");
  return files.map(file => ({
    ...file,
    albumCoverFor: [
      ...(file.albumCoverFor ?? []).filter(album => album !== name),
      ...(file.id === fileId ? [name] : []),
    ],
  }));
}

export function albumCover(files: TeleFile[], name: string): TeleFile | undefined {
  const items = files.filter(file => file.albumNames?.includes(name) && !file.trashed);
  return items.find(file => file.albumCoverFor?.includes(name)) ?? items[0];
}
