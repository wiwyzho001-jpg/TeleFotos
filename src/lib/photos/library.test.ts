import { describe, expect, it } from "vitest";
import { groupPhotos, photoDate, selectPhotos } from "./library";
import type { TeleFile } from "../types";
const file = (id: string, patch: Partial<TeleFile> = {}): TeleFile => ({
  id,
  name: `${id}.jpg`,
  mime: "image/jpeg",
  size: 100,
  folderPath: "/",
  channelId: "1",
  messageId: 1,
  uploadedAt: 1000,
  ...patch,
});
describe("photo library", () => {
  it("excludes documents, trash and archive from the main timeline", () => {
    expect(
      selectPhotos([
        file("photo"),
        file("doc", { mime: "application/pdf" }),
        file("trash", { trashed: true }),
        file("archive", { archived: true }),
      ]).map((f) => f.id),
    ).toEqual(["photo"]);
  });
  it("uses source file dates before upload dates and sorts newest first", () => {
    const old = file("old", { uploadedAt: 9999, capturedAt: 100 });
    const recent = file("recent", { uploadedAt: 1000, capturedAt: 200 });
    expect(selectPhotos([old, recent]).map((f) => f.id)).toEqual([
      "recent",
      "old",
    ]);
    expect(photoDate(file("bad", { capturedAt: NaN }))).toBe(1000);
  });
  it("matches accents, album names and dates without duplicating media", () => {
    const source = [
      file("one", { name: "México.jpg", albumNames: ["Vacaciones"] }),
    ];
    expect(selectPhotos(source, "all", "mexico vacaciones")).toHaveLength(1);
    expect(selectPhotos(source, "all", "", "Vacaciones")).toHaveLength(1);
    expect(selectPhotos(source, "all", "", "Other")).toHaveLength(0);
  });
  it("keeps archived and trashed media out of favorites and video search", () => {
    const source = [
      file("favorite", { starred: true }),
      file("archived", { starred: true, archived: true }),
      file("video", { mime: "video/mp4" }),
      file("trash", { mime: "video/mp4", trashed: true }),
    ];
    expect(selectPhotos(source, "favorites").map((f) => f.id)).toEqual([
      "favorite",
    ]);
    expect(selectPhotos(source, "videos").map((f) => f.id)).toEqual(["video"]);
    expect(selectPhotos(source, "trash").map((f) => f.id)).toEqual(["trash"]);
    expect(selectPhotos(source, "archive").map((f) => f.id)).toEqual([
      "archived",
    ]);
  });
  it("groups by local calendar day across midnight", () => {
    const first = file("first", {
      capturedAt: new Date(2026, 9, 29, 23, 59).getTime(),
    });
    const second = file("second", {
      capturedAt: new Date(2026, 9, 30, 0, 1).getTime(),
    });
    expect(groupPhotos(selectPhotos([first, second]))).toHaveLength(2);
    expect(groupPhotos(selectPhotos([first, second]))[0].files[0].id).toBe(
      "second",
    );
  });
});
