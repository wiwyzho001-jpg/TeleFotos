import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Share2,
  Info,
  Loader2,
  RotateCcw,
  Star,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  downloadFileToBuffer,
} from "@/lib/telegram/downloader";
import { usePhotoActions } from "@/hooks/usePhotoActions";
import { localAssetUrl, mediaCommand } from "@/lib/photos/device";
import { toast } from "sonner";
import type { TeleFile } from "@/lib/types";
import { photoDate } from "@/lib/photos/library";
import { downloadPhotos, usePhotoDownloads } from "@/lib/photos/downloads";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { mediaErrorMessage } from "@/lib/telegram/mediaConnection";
import { createPhotoThumbnail } from "@/lib/photos/thumbnail";
import { originalCacheKey, readOriginal, readThumbnail, saveOriginal, saveThumbnail, thumbnailCacheKey } from "@/lib/photos/thumbnailCache";
import { useAuthStore } from "@/stores/authStore";

export default function PhotoViewer({
  files,
  id,
  onClose,
  onNavigate,
}: {
  files: TeleFile[];
  id: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const index = files.findIndex((file) => file.id === id);
  const file = files[index];
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [info, setInfo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retry, setRetry] = useState(0);
  const touch = useRef({ x: 0, y: 0, active: false });
  const downloads = usePhotoDownloads();
  useAndroidBack(() => { if (confirmDelete) { setConfirmDelete(false); return true; } if (info) { setInfo(false); return true; } return false; }, 10);
  const closeRef = useRef<HTMLButtonElement>(null);
  const actions = usePhotoActions();
  function step(delta: number) {
    const next = files[index + delta];
    if (next) onNavigate(next.id);
  }
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => focused?.focus();
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "Tab") {
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".tf-viewer button:not(:disabled), .tf-viewer video",
          ),
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    if (!file) {
      onClose();
      return;
    }
    let alive = true;
    let objectUrl = "";
    let localPath = "";
    setUrl("");
    setError("");
    setProgress(0);
    setZoom(1);
    void (async () => {
      try {
        if (file.localUri) {
          const prepared = await mediaCommand<{ path: string }>("prepare", {
            uri: file.localUri,
            preview: true,
          });
          localPath = prepared.path;
          if (!alive) {
            await mediaCommand("release", { path: localPath });
            return;
          }
          setUrl(localAssetUrl(localPath));
          return;
        }
        const account = useAuthStore.getState().phoneNumber;
        const cachedOriginal = account
          ? await readOriginal(originalCacheKey(file, account))
          : undefined;
        let blob = cachedOriginal;
        if (!blob) {
          const bytes = await downloadFileToBuffer(
            file.channelId,
            file.messageId,
            (p) => {
              if (alive) setProgress(p);
            },
          );
          blob = new Blob([new Uint8Array(bytes)], { type: file.mime });
          if (account) void saveOriginal(originalCacheKey(file, account), blob);
        } else if (alive) {
          setProgress(100);
        }
        if (/hei[cf]/i.test(file.mime) || /\.hei[cf]$/i.test(file.name)) {
          const { default: convert } = await import("heic2any");
          const result = await convert({
            blob,
            toType: "image/jpeg",
            quality: 0.9,
          });
          blob = Array.isArray(result) ? result[0] : result;
        }
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        if (account) {
          const key = thumbnailCacheKey(file, account);
          void readThumbnail(key).then(async (cached) => {
            if (cached) return;
            const cover = await createPhotoThumbnail(new File([blob], file.name, { type: blob.type }));
            if (cover && useAuthStore.getState().phoneNumber === account)
              await saveThumbnail(key, new Blob([new Uint8Array(cover)], { type: "image/jpeg" }));
          }).catch(() => {});
        }
      } catch (error) {
        console.warn("No se pudo abrir el original de Telegram:", error);
        if (alive) setError(mediaErrorMessage(error));
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (localPath)
        void mediaCommand("release", { path: localPath }).catch(() => {});
    };
  }, [id, retry, file?.localUri]);
  if (!file) return null;
  return (
    <div
      className="tf-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
    >
      <header>
        <button ref={closeRef} aria-label="Cerrar foto" onClick={onClose}>
          <ArrowLeft size={29} />
        </button>
        <span>
          {new Date(photoDate(file)).toLocaleDateString("es", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
        <button aria-label="Información" onClick={() => setInfo(!info)}>
          <Info />
        </button>
      </header>
      <div
        className="tf-viewer-stage"
        onTouchStart={(e) => {
          const target = e.target as HTMLElement;
          const video = target.closest("video");
          const controls = video && e.touches[0].clientY > video.getBoundingClientRect().bottom - 50;
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: e.touches.length === 1 && !controls };
        }}
        onTouchCancel={() => { touch.current.active = false; }}
        onTouchEnd={(e) => {
          if (!touch.current.active || zoom !== 1 || e.changedTouches.length !== 1) return;
          touch.current.active = false;
          const dx = e.changedTouches[0].clientX - touch.current.x,
            dy = e.changedTouches[0].clientY - touch.current.y;
          if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy))
            step(dx > 0 ? -1 : 1);
        }}
      >
        {!url && !error && (
            <div className="tf-viewer-loading" role="status">
              <Loader2 className="animate-spin" />
              <p>Abriendo original · {progress}%</p>
            </div>
        )}
        {error && (
          <div className="tf-viewer-loading" role="alert">
            <p>{error}</p>
            <button onClick={() => setRetry(retry + 1)}>Reintentar</button>
          </div>
        )}
        {url &&
          (file.mime.startsWith("video/") ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              onError={() =>
                setError(
                  "Este dispositivo no puede reproducir el formato. Descarga el original para abrirlo en otra aplicación.",
                )
              }
            />
          ) : (
            <div className="tf-zoom-area">
              <img
                src={url}
                alt={file.name}
                onError={()=>setError("No se puede mostrar este formato. Usa Compartir para abrir el original en otra aplicación.")}
                style={{ transform: `scale(${zoom})` }}
                onDoubleClick={() => setZoom(zoom === 1 ? 2 : 1)}
              />
            </div>
          ))}
      </div>
      {info && (
        <aside className="tf-photo-info">
          <strong>{file.name}</strong>
          <p>
            {file.mime} · {(file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <p>{file.folderPath}</p>
          <p>{file.albumNames?.join(" · ")}</p>
          <small>
            Fecha del archivo; si no está disponible, fecha de subida.
          </small>
        </aside>
      )}
      <footer>
        <button
          aria-label={file.localUri ? "Compartir" : "Descargar original"}
          disabled={downloads.running}
          onClick={() =>
            file.localUri
              ? void mediaCommand("share", { uri: file.localUri }).catch(
                  (error) => toast.error(String(error)),
                )
              : void downloadPhotos([file])
          }
        >
          {file.localUri ? <Share2 /> : <Download />}
          <span>{file.localUri ? "Compartir" : downloads.running ? "Descargando…" : "Descargar"}</span>
        </button>
        <button
          aria-pressed={Boolean(file.starred)}
          onClick={() => void actions.toggleStar(file)}
        >
          <Star fill={file.starred ? "#fbbc04" : "none"} />
          <span>Favorito</span>
        </button>
        {!file.mime.startsWith("video/") && (
          <button onClick={() => setZoom(zoom === 1 ? 2 : 1)}>
            {zoom === 1 ? <ZoomIn /> : <ZoomOut />}
            <span>{zoom === 1 ? "Ampliar" : "Reducir"}</span>
          </button>
        )}
        <button
          onClick={() => {
            void actions.trash([file], Boolean(file.trashed)).then(onClose);
          }}
        >
          {file.trashed ? <RotateCcw /> : <Trash2 />}
          <span>{file.trashed ? "Restaurar" : "Papelera"}</span>
        </button>
        {file.trashed && <button onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          <span>Eliminar definitivamente</span>
        </button>}
      </footer>
      {confirmDelete && <div className="tf-scrim" onClick={() => setConfirmDelete(false)}>
        <section className="tf-sheet tf-confirm-sheet" role="alertdialog" aria-modal="true" aria-label="Eliminar archivo definitivamente" onClick={(event) => event.stopPropagation()}>
          <h2>¿Eliminar definitivamente?</h2>
          <p>«{file.name}» se borrará de Telegram y no podrás recuperarlo.</p>
          <div className="tf-dialog-actions">
            <button onClick={() => setConfirmDelete(false)}>Cancelar</button>
            <button onClick={() => { setConfirmDelete(false); void actions.deletePermanently(file.id).then(onClose); }}>Eliminar</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
