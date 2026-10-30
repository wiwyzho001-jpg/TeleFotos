import { describe, expect, it } from "vitest";
import { albumCover, removeAlbum, setAlbumCover } from "./albums";
import type { TeleFile } from "../types";

const media = (id: string, extra: Partial<TeleFile> = {}): TeleFile => ({
  id, name: `${id}.jpg`, mime: "image/jpeg", size: 100, folderPath: "/", channelId: "1", messageId: Number(id), uploadedAt: 1,
  albumNames: ["Viaje"], ...extra,
});
describe("album management", () => {
  it("removes only the album, keeping all original media and other albums", () => {
    const files = [media("1", { albumNames: ["Viaje", "Familia"], albumCoverFor: ["Viaje", "Familia"] }), media("2", { trashed: true })];
    const result = removeAlbum(files, "Viaje");
    expect(result.map(file => file.messageId)).toEqual([1, 2]);
    expect(result[0].albumNames).toEqual(["Familia"]);
    expect(result[0].albumCoverFor).toEqual(["Familia"]);
    expect(result[1].trashed).toBe(true);
    expect(result.every(file => !file.albumNames?.includes("Viaje"))).toBe(true);
    expect(files[0].albumNames).toContain("Viaje");
  });
  it("persists a single cover and preserves cover choices for other albums", () => {
    const result = setAlbumCover([media("1", { albumCoverFor: ["Viaje", "Familia"] }), media("2")], "Viaje", "2");
    expect(result[0].albumCoverFor).toEqual(["Familia"]);
    expect(albumCover(JSON.parse(JSON.stringify(result)), "Viaje")?.id).toBe("2");
  });
  it("rejects a cover outside the album or in the trash", () => {
    expect(() => setAlbumCover([media("1", { albumNames: ["Otro"] })], "Viaje", "1")).toThrow();
    expect(() => setAlbumCover([media("1", { trashed: true })], "Viaje", "1")).toThrow();
  });
  it("falls back to an available image when the chosen cover was removed", () => {
    expect(albumCover([media("1", { trashed: true, albumCoverFor: ["Viaje"] }), media("2")], "Viaje")?.id).toBe("2");
  });
});
