import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhotoThumbnail, frameVisibilityScore } from "./thumbnail";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function videoEnvironment(fails = false) {
  let src = "";
  let currentTime = 0;
  const drawImage = vi.fn();
  const video: any = {
    videoWidth: 1920, videoHeight: 1080, duration: 8,
    removeAttribute: vi.fn(() => { src = ""; }),
    load: vi.fn(() => {
      if (src) queueMicrotask(() => fails ? video.onerror?.() : video.onloadeddata?.());
    }),
    set src(value: string) { src = value; },
    get currentTime() { return currentTime; },
    set currentTime(value: number) { currentTime = value; queueMicrotask(() => video.onseeked?.()); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray([180, 120, 80, 255]) }),
      putImageData: vi.fn(),
    }),
    toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }))),
  };
  vi.stubGlobal("document", { createElement: (type: string) => type === "video" ? video : canvas });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { video, canvas, drawImage, revoke };
}

describe("video covers", () => {
  it("prefers a visible video frame over a black opening", () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255, 2, 2, 2, 255]);
    const content = new Uint8ClampedArray([200, 120, 60, 255, 20, 80, 150, 255]);
    expect(frameVisibilityScore(content)).toBeGreaterThan(frameVisibilityScore(black));
  });
  it("captures a decoded frame, sizes it for Telegram and releases the source", async () => {
    const { video, canvas, drawImage, revoke } = videoEnvironment();
    const cover = await createPhotoThumbnail(new File(["video"], "clip.mp4", { type: "video/mp4" }));
    expect(cover).toEqual(new Uint8Array([255, 216, 255]));
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(144);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 256, 144);
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(video.currentTime).toBe(6.4);
    expect(revoke).toHaveBeenCalledWith("blob:cover");
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
  });

  it("also recognizes videos picked without a MIME type", async () => {
    videoEnvironment();
    expect(await createPhotoThumbnail(new File(["video"], "clip.mp4"))).toBeDefined();
  });

  it("releases an unsupported video and allows uploading the original", async () => {
    const { revoke, drawImage } = videoEnvironment(true);
    expect(await createPhotoThumbnail(new File(["video"], "clip.mov", { type: "video/quicktime" }))).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:cover");
    expect(drawImage).not.toHaveBeenCalled();
  });
});
