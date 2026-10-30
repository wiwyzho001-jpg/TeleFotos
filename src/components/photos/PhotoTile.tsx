import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImageOff, Play, Star } from "lucide-react";
import { Api } from "telegram";
import { mediaCommand } from "@/lib/photos/device";
import { withMediaConnection } from "@/lib/telegram/mediaConnection";
import { downloadFileToBuffer } from "@/lib/telegram/downloader";
import { createPhotoThumbnail } from "@/lib/photos/thumbnail";
import { readThumbnail, saveThumbnail, thumbnailCacheKey } from "@/lib/photos/thumbnailCache";
import type { TeleFile } from "@/lib/types";

// Prefer Telegram covers and persist them. Legacy uploads without a cover can
// generate one from a small original; large originals are covered when opened.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let active = 0;
const waiting: (() => void)[] = [];
let originalCoverQueue = Promise.resolve();
async function generateLegacyCover(file: TeleFile): Promise<Uint8Array | undefined> {
  if (file.size > 64 * 1024 * 1024) return;
  const previous = originalCoverQueue;
  let release!: () => void;
  originalCoverQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const bytes = await downloadFileToBuffer(file.channelId, file.messageId);
    return await createPhotoThumbnail(new File([new Uint8Array(bytes)], file.name, { type: file.mime }));
  } finally { release(); }
}
async function thumbnail(file: TeleFile, account: string): Promise<string> {
  const key = file.localUri
    ? `local:${file.deviceSourceKey}`
    : thumbnailCacheKey(file, account);
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    if (active >= 3)
      await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      if (file.localUri) {
        const { url } = await mediaCommand<{ url: string }>("thumbnail", {
          uri: file.localUri,
        });
        cache.set(key, url);
        while (cache.size > 240) {
          const oldest = cache.keys().next().value!;
          URL.revokeObjectURL(cache.get(oldest)!);
          cache.delete(oldest);
        }
        return url;
      }
      let blob = await readThumbnail(key);
      if (!blob) {
        // Legacy Telegram video covers may be a completely black first frame.
        // Generate a representative cover instead of persisting that frame.
        const videoCover = file.mime.startsWith("video/") ? await generateLegacyCover(file) : undefined;
        const bytes = videoCover ?? await withMediaConnection(async (client) => {
          const peer = await client.getInputEntity(file.channelId);
          const messages = await client.getMessages(peer, { ids: [file.messageId] });
          const media = messages[0]?.media;
          const sizes = media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document
            ? media.document.thumbs
            : media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo
              ? media.photo.sizes : undefined;
          const size = sizes?.find((size) => size instanceof Api.PhotoSize || size instanceof Api.PhotoCachedSize)
            ?? sizes?.find((size) => size instanceof Api.PhotoStrippedSize);
          // A missing thumb silently downloads the entire document in GramJS.
          if (!size || !("type" in size)) return undefined;
          const result = await client.downloadMedia(media!, { thumb: size });
          return result && typeof result !== "string" && result.length ? new Uint8Array(result) : undefined;
        }) ?? await generateLegacyCover(file);
        if (!bytes) throw new Error("Abre el original para generar su miniatura");
        blob = new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
        await saveThumbnail(key, blob);
      }
      const url = URL.createObjectURL(blob);
      cache.set(key, url);
      while (cache.size > 240) {
        const oldest = cache.keys().next().value!;
        URL.revokeObjectURL(cache.get(oldest)!);
        cache.delete(oldest);
      }
      return url;
    } finally {
      active--;
      waiting.shift()?.();
    }
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

/** Return a cover already in memory, in IndexedDB, or currently loading for a visible tile. */
export async function getPhotoThumbnailIfReady(file: TeleFile, account: string): Promise<string | undefined> {
  if (file.localUri) return undefined;
  const key = thumbnailCacheKey(file, account);
  const memory = cache.get(key);
  if (memory) return memory;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const blob = await readThumbnail(key);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  while (cache.size > 240) {
    const oldest = cache.keys().next().value!;
    URL.revokeObjectURL(cache.get(oldest)!);
    cache.delete(oldest);
  }
  return url;
}
export function PhotoCover({ file, account }: { file?: TeleFile; account: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    if (!file || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void thumbnail(file, account).then(url => { if (alive) setSrc(url); }).catch(() => {});
    }, { rootMargin: "150px" });
    observer.observe(ref.current);
    return () => { alive = false; observer.disconnect(); };
  }, [file?.id, file?.messageId, account]);
  return <span className="tf-cover-preview" ref={ref}>
    {src ? <img src={src} alt="" loading="lazy" /> : <ImageOff size={30} />}
  </span>;
}

export function PhotoTile({
  file,
  account,
  selected = false,
  selecting = false,
  onOpen,
  onSelect,
}: {
  file: TeleFile;
  account: string;
  selected?: boolean;
  selecting?: boolean;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState(file.thumbnailUrl);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPress = useRef(false);
  const pressStart = useRef({ x: 0, y: 0 });
  useEffect(() => {
    let alive = true;
    setSrc(file.thumbnailUrl);
    setFailed(false);
    if (file.thumbnailUrl || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        thumbnail(file, account)
          .then((url) => {
            if (alive) setSrc(url);
          })
          .catch(() => {
            if (alive) setFailed(true);
          });
      },
      { rootMargin: "250px" },
    );
    observer.observe(ref.current);
    const refresh = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== thumbnailCacheKey(file, account)) return;
      thumbnail(file, account).then((url) => {
        if (alive) { setSrc(url); setFailed(false); }
      }).catch(() => {});
    };
    window.addEventListener("telefotos-thumbnail", refresh);
    window.addEventListener("online", refresh);
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener("telefotos-thumbnail", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [
    file.channelId,
    file.messageId,
    file.thumbnailUrl,
    file.localUri,
    account,
  ]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div ref={ref} className={`tf-tile ${selected ? "is-selected" : ""}`}>
      <button
        className="tf-tile-open"
        aria-label={`Abrir ${file.name}`}
        onClick={() => {
          if (longPress.current) {
            longPress.current = false;
            return;
          }
          if (selecting) onSelect();
          else onOpen();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pressStart.current = { x: event.clientX, y: event.clientY };
          longPress.current = false;
          timer.current = setTimeout(() => {
            longPress.current = true;
            onSelect();
          }, 500);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 10)
            clearTimeout(timer.current);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={file.name}
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="tf-thumb-empty">
            <ImageOff size={26} />
            <small>{failed ? file.name : "Cargando…"}</small>
          </span>
        )}
        {file.mime.startsWith("video/") && (
          <Play className="tf-video-badge" size={18} fill="white" />
        )}
        {file.starred && (
          <Star className="tf-star-badge" size={16} fill="white" />
        )}
      </button>
      <button
        className={`tf-select ${selecting ? "visible" : ""}`}
        aria-label={`${selected ? "Deseleccionar" : "Seleccionar"} ${file.name}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <CheckCircle2 size={23} />
      </button>
    </div>
  );
}
