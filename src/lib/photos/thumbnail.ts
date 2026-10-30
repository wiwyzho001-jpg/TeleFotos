/** Favor visible, detailed frames over a video's black opening/fade. */
export function frameVisibilityScore(pixels: Uint8ClampedArray): number {
  let sum = 0, squares = 0, visible = 0;
  const count = pixels.length / 4;
  if (!count) return 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += light;
    squares += light * light;
    if (light > 20) visible++;
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, squares / count - mean * mean)) + 50 * visible / count + mean * 0.1;
}

/** Generate a JPEG cover for images and videos without changing the original. */
export async function createPhotoThumbnail(
  file: File,
): Promise<Uint8Array | undefined> {
  const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
  if (!isVideo && !file.type.startsWith("image/")) return;
  let bitmap: ImageBitmap | undefined;
  let video: HTMLVideoElement | undefined;
  let url: string | undefined;
  try {
    let source: CanvasImageSource;
    let width: number;
    let height: number;
    if (isVideo) {
      video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error("No se pudo leer la portada del video")), 12_000);
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          video!.onerror = null;
          video!.onloadeddata = null;
          video!.onseeked = null;
          if (error) reject(error);
          else resolve();
        };
        video!.onerror = () => finish(new Error("Formato de video no compatible"));
        video!.onloadeddata = () => finish();
        video!.src = url!;
        video!.load();
      });
      source = video;
      width = video.videoWidth;
      height = video.videoHeight;
    } else {
      let image: Blob = file;
      if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
        const { default: convert } = await import("heic2any");
        const result = await convert({ blob: file, toType: "image/jpeg" });
        image = Array.isArray(result) ? result[0] : result;
      }
      bitmap = await createImageBitmap(image);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    }
    if (!width || !height) return;
    const scale = Math.min(1, 256 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      let best: ImageData | undefined;
      let bestScore = -1;
      for (const fraction of [0.12, 0.35, 0.55, 0.8]) {
        const time = Math.min(video.duration * fraction, Math.max(0, video.duration - 0.05));
        if (Math.abs(video.currentTime - time) > 0.001) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error("No se pudo leer el fotograma")), 4000);
            const finish = (error?: Error) => {
              clearTimeout(timeout);
              video!.onseeked = null;
              video!.onerror = null;
              if (error) reject(error); else resolve();
            };
            video!.onseeked = () => finish();
            video!.onerror = () => finish(new Error("No se pudo decodificar el video"));
            video!.currentTime = time;
          });
        }
        // Android can fire seeked before its decoded frame reaches the canvas.
        await new Promise(resolve => setTimeout(resolve, 150));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const score = frameVisibilityScore(frame.data);
        if (score > bestScore) { best = frame; bestScore = score; }
      }
      if (best) context.putImageData(best, 0, 0);
    } else {
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    for (const quality of [0.7, 0.5, 0.3]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= 20_000)
        return new Uint8Array(await blob.arrayBuffer());
    }
    return;
  } catch {
    // Unsupported codecs (e.g. HEIC) must not prevent uploading the original.
    return;
  } finally {
    bitmap?.close();
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    if (url) URL.revokeObjectURL(url);
  }
}
