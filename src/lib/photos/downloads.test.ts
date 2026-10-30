import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeleFile } from "../types";
const mock = vi.hoisted(() => ({ command: vi.fn(), download: vi.fn() }));
vi.mock("./device", () => ({ androidMedia: true, mediaCommand: mock.command }));
vi.mock("../telegram/downloader", () => ({ downloadFileToBuffer: mock.download, downloadFileFromTelegram: vi.fn() }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: { getState: () => ({ phoneNumber: "account" }) } }));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(() => "download"), success: vi.fn(), error: vi.fn() } }));
import { downloadPhotos, saveAndroidOriginal, usePhotoDownloads } from "./downloads";
const file: TeleFile = { id: "1", name: "original.jpg", mime: "image/jpeg", size: 800000, channelId: "1", messageId: 1, uploadedAt: 1, folderPath: "/" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.command.mockImplementation(async (command: string) => command === "createDownload" ? { token: "private-token" } : {});
  usePhotoDownloads.setState({ running: false, completed: 0, total: 0, progress: 0 });
});
describe("saving selected originals", () => {
  it("writes the original bytes in bounded chunks and publishes only after completion", async () => {
    const bytes = Uint8Array.from({ length: 800000 }, (_, i) => i % 256);
    await saveAndroidOriginal(file, bytes);
    const parts = mock.command.mock.calls.filter(([command]) => command === "appendDownload");
    expect(parts.length).toBe(3);
    const restored = parts.flatMap(([, args]) => [...atob(args.data)].map(char => char.charCodeAt(0)));
    expect(new Uint8Array(restored)).toEqual(bytes);
    expect(mock.command.mock.calls[mock.command.mock.calls.length - 1]?.[0]).toBe("finishDownload");
    expect(parts.every(([, args]) => args.data.length < 720000)).toBe(true);
  });
  it("removes an incomplete copy if writing fails", async () => {
    mock.command.mockImplementation(async (command: string) => {
      if (command === "createDownload") return { token: "private-token" };
      if (command === "appendDownload") throw new Error("Storage full");
      return {};
    });
    await expect(saveAndroidOriginal(file, new Uint8Array([1, 2]))).rejects.toThrow("Storage full");
    expect(mock.command).toHaveBeenCalledWith("abortDownload", { token: "private-token" });
    expect(mock.command.mock.calls.some(([command]) => command === "finishDownload")).toBe(false);
  });
  it("continues a multiple selection and retains failed items for retry", async () => {
    mock.download.mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(new Uint8Array([3]));
    const result = await downloadPhotos([file, { ...file, id: "2", messageId: 2 }, { ...file, id: "3", messageId: 3 }]);
    expect(result).toEqual(["1", "3"]);
    expect(usePhotoDownloads.getState()).toMatchObject({ running: false, completed: 2, total: 3 });
  });
});
