import type { TeleFile } from "../types";

export type PhotoFilter = "all" | "favorites" | "videos" | "archive" | "trash";
export function isMedia(file: TeleFile): boolean {
  return (
    file.mime.startsWith("image/") ||
    file.mime.startsWith("video/") ||
    /\.(heic|heif)$/i.test(file.name)
  );
}
export function photoDate(file: TeleFile): number {
  return file.capturedAt &&
    Number.isFinite(file.capturedAt) &&
    file.capturedAt > 0
    ? file.capturedAt
    : file.uploadedAt;
}
export function selectPhotos(
  files: TeleFile[],
  filter: PhotoFilter = "all",
  query = "",
  album?: string,
): TeleFile[] {
  const terms = query
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return files
    .filter((file) => {
      if (!isMedia(file)) return false;
      if (filter === "trash" ? !file.trashed : file.trashed) return false;
      if (
        filter === "archive"
          ? !file.archived
          : filter !== "trash" && file.archived
      )
        return false;
      if (filter === "favorites" && !file.starred) return false;
      if (filter === "videos" && !file.mime.startsWith("video/")) return false;
      if (album && !file.albumNames?.includes(album)) return false;
      const text =
        `${file.name} ${file.deviceFolder ?? ""} ${file.folderPath} ${file.albumNames?.join(" ") ?? ""} ${new Date(photoDate(file)).toLocaleDateString("es", { year: "numeric", month: "long", day: "numeric" })}`
          .toLocaleLowerCase("es")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => photoDate(b) - photoDate(a) || a.id.localeCompare(b.id));
}
export function groupPhotos(
  files: TeleFile[],
): { key: string; label: string; files: TeleFile[] }[] {
  const groups = new Map<
    string,
    { key: string; label: string; files: TeleFile[] }
  >();
  for (const file of files) {
    const date = new Date(photoDate(file));
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        label: date.toLocaleDateString("es", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        files: [],
      });
    groups.get(key)!.files.push(file);
  }
  return [...groups.values()];
}
