import { describe, expect, it } from "vitest";
import { mergeDevicePhotos } from "./device";
import type { TeleFile } from "../types";
const file = (id: string, patch: Partial<TeleFile> = {}): TeleFile => ({
  id,
  name: "a.jpg",
  mime: "image/jpeg",
  size: 12,
  folderPath: "/",
  channelId: "1",
  messageId: 3,
  uploadedAt: 1,
  ...patch,
});
describe("device and cloud library", () => {
  it("shows a backed-up photo once, retaining cloud metadata and local access", () => {
    const remote = file("remote", {
      deviceSourceKey: "device:a",
      starred: true,
      albumNames: ["Trip"],
    });
    const local = file("local", {
      deviceSourceKey: "device:a",
      localUri: "content://media/external/images/media/1",
      messageId: 0,
      deviceFolder: "Camera",
    });
    const merged = mergeDevicePhotos([remote], [local], {});
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "remote",
      starred: true,
      localUri: local.localUri,
      albumNames: ["Trip"],
    });
  });
  it("matches identical content across different device source keys", () => {
    const remote = file("remote", { contentHash: "hash" });
    const local = file("local", {
      deviceSourceKey: "new-device",
      localUri: "content://media/external/images/media/2",
      messageId: 0,
    });
    expect(
      mergeDevicePhotos([remote], [local], {
        "new-device": { contentHash: "hash" },
      }),
    ).toHaveLength(1);
  });
  it("collapses duplicate device copies of the same backed-up content", () => {
    const remote = file("remote", { contentHash: "hash" });
    const local = [
      file("one", { deviceSourceKey: "one", messageId: 0 }),
      file("two", { deviceSourceKey: "two", messageId: 0 }),
    ];
    expect(
      mergeDevicePhotos([remote], local, {
        one: { contentHash: "hash" },
        two: { contentHash: "hash" },
      }),
    ).toHaveLength(1);
  });
  it("never exposes another account from local references alone", () => {
    const local = file("local", { deviceSourceKey: "source", messageId: 0 });
    expect(
      mergeDevicePhotos([], [local], {
        source: { contentHash: "previous-account-hash" },
      })[0].messageId,
    ).toBe(0);
  });
  it("keeps cloud trash state when a local copy is still on the phone", () => {
    const remote = file("remote", { deviceSourceKey: "source", trashed: true });
    const local = file("local", {
      deviceSourceKey: "source",
      localUri: "content://media/external/images/media/1",
    });
    expect(mergeDevicePhotos([remote], [local], {})[0].trashed).toBe(true);
  });
  it("applies device favorites and albums without a Telegram account", () => {
    const local = file("local", { deviceSourceKey: "source", messageId: 0 });
    expect(
      mergeDevicePhotos([], [local], {
        source: { starred: true, albumNames: ["Family"] },
      })[0],
    ).toMatchObject({ starred: true, albumNames: ["Family"] });
  });
});
