import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Album,
  Archive,
  ArrowLeft,
  Check,
  Download,
  MoreVertical,
  CloudUpload,
  Smartphone,
  Grid2X2,
  Image,
  Images,
  Search,
  Star,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useFileStore } from "@/stores/fileStore";
import { useAuthStore } from "@/stores/authStore";
import { usePhotoActions } from "@/hooks/usePhotoActions";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import {
  mediaCommand,
  androidMedia,
  useDeviceStore,
} from "@/lib/photos/device";
import {
  readBackupPreferences,
  runPhotoBackup,
  usePhotoBackup,
} from "@/lib/photos/backup";
import { GooglePlusIcon } from "@/components/layout/NewActionButton";
import { toast } from "sonner";
import { addFilesToUploadQueue } from "@/lib/upload/uploadManager";
import { useTelegramProfile } from "@/hooks/useTelegramProfile";
import { albumCover } from "@/lib/photos/albums";
import { downloadPhotos, usePhotoDownloads } from "@/lib/photos/downloads";
import {
  groupPhotos,
  selectPhotos,
  type PhotoFilter,
} from "@/lib/photos/library";
import { PhotoTile, PhotoCover } from "./PhotoTile";
import PhotoViewer from "./PhotoViewer";
import { UploadProgressPanel } from "@/components/upload/UploadProgressPanel";
import "./photos.css";

type Tab = "photos" | "collections" | "search";
const labels: Record<PhotoFilter, string> = {
  all: "Fotos",
  favorites: "Favoritos",
  videos: "Videos",
  archive: "Archivo",
  trash: "Papelera",
};
export default function PhotosLayout() {
  const navigate = useNavigate();
  const remoteFiles = useFileStore((state) => state.files);
  const device = useDeviceStore();
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const bootstrapComplete = useFileStore((state) => state.bootstrapComplete);
  // The photo timeline is the Telegram library. Local media stays available
  // to the backup picker and is added here after Telegram confirms its upload.
  const files = useMemo(
    () => (authenticated ? remoteFiles : []),
    [remoteFiles, authenticated],
  );
  const backup = usePhotoBackup();
  useEffect(() => {
    void useDeviceStore.getState().checkAccess();
    const refresh = () => {
      if (document.visibilityState === "visible")
        void useDeviceStore.getState().checkAccess();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  useEffect(() => {
    if (!androidMedia || !authenticated || !bootstrapComplete) return;
    const phone = useAuthStore.getState().phoneNumber;
    if (!phone) return;
    const preferences = readBackupPreferences(phone);
    void mediaCommand("configurePhotoBackup", {
      phone,
      enabled: preferences.enabled,
      wifiOnly: preferences.wifiOnly,
    }).catch((error) =>
      console.warn("No se pudo restaurar la programación del respaldo:", error),
    );

    const scan = () => {
      const currentPhone = useAuthStore.getState().phoneNumber;
      if (
        currentPhone &&
        document.visibilityState === "visible" &&
        readBackupPreferences(currentPhone).enabled
      )
        void runPhotoBackup();
    };
    scan();
    const interval = setInterval(scan, 60_000);
    return () => {
      clearInterval(interval);
    };
  }, [authenticated, bootstrapComplete]);
  const loading = useFileStore((state) => state.isLoading);
  const phone = useAuthStore((state) => state.phoneNumber);
  const actions = usePhotoActions();
  const [tab, setTab] = useState<Tab>("photos");
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const [album, setAlbum] = useState<string>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string>();
  const [columns, setColumns] = useState(3);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [albumMenu, setAlbumMenu] = useState(false);
  const [coverPicker, setCoverPicker] = useState(false);
  const [removeAlbumOpen, setRemoveAlbumOpen] = useState(false);
  const [trashAction, setTrashAction] = useState<{ mode: "empty" | "selected"; fileIds: string[] } | null>(null);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const profile = useTelegramProfile(phone, authenticated && bootstrapComplete, false);
  const downloads = usePhotoDownloads();
  useAndroidBack(() => {
    if (preview) { setPreview(undefined); return true; }
    if (albumOpen) { setAlbumOpen(false); return true; }
    if (coverPicker) { setCoverPicker(false); return true; }
    if (removeAlbumOpen) { if (!savingAlbum) setRemoveAlbumOpen(false); return true; }
    if (trashAction) { setTrashAction(null); return true; }
    if (albumMenu) { setAlbumMenu(false); return true; }
    if (selected.size) { setSelected(new Set()); return true; }
    if (filter !== "all" || album) { collection("all"); return true; }
    if (tab !== "photos") { changeTab("photos"); return true; }
    return false;
  });
  const photos = useMemo(
    () =>
      selectPhotos(
        files,
        filter,
        tab === "search" ? query : "",
        album,
      ),
    [files, filter, query, tab, album],
  );
  const groups = useMemo(() => groupPhotos(photos), [photos]);
  const allMedia = useMemo(() => selectPhotos(files), [files]);
  const albums = useMemo(
    () =>
      [...new Set(allMedia.flatMap((file) => file.albumNames ?? []))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [allMedia],
  );
  async function downloadSelected() {
    const completed = await downloadPhotos(photos.filter(file => selected.has(file.id)));
    setSelected(current => new Set([...current].filter(id => !completed.includes(id))));
  }
  async function chooseCover(fileId: string) {
    if (!album || savingAlbum) return;
    setSavingAlbum(true);
    try { await actions.setAlbumCover(album, fileId); setCoverPicker(false); toast.success("Portada actualizada"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la portada"); }
    finally { setSavingAlbum(false); }
  }
  async function removeCurrentAlbum() {
    if (!album || savingAlbum) return;
    setSavingAlbum(true);
    try {
      await actions.removeAlbum(album);
      setRemoveAlbumOpen(false);
      collection("all");
      toast.success("Álbum eliminado. Tus fotos y videos se conservan.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo eliminar el álbum"); }
    finally { setSavingAlbum(false); }
  }
  function changeTab(next: Tab) {
    setTab(next);
    setFilter("all");
    setAlbum(undefined);
    setSelected(new Set());
  }
  function collection(next: PhotoFilter, name?: string) {
    setFilter(next);
    setAlbum(name);
    setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const showCollections =
    tab === "collections" && filter === "all" && !album;
  return (
    <div className="tf-app">
      <header className="tf-header">
        {selected.size > 0 ? (
          <>
            <button
              aria-label="Cancelar selección"
              onClick={() => setSelected(new Set())}
            >
              <X />
            </button>
            <strong>{selected.size} seleccionadas</strong>
            <button
              aria-label="Seleccionar todas"
              onClick={() =>
                setSelected(new Set(photos.map((file) => file.id)))
              }
            >
              <Check />
            </button>
          </>
        ) : (
          <>
            <button className="tf-brand" aria-label="TeleFotos, inicio" onClick={() => changeTab("photos")}>
              <img src="/telefotos-logo.png" alt="" />
              <span>TeleFotos</span>
            </button>
            <button
              className="tf-avatar"
              aria-label="Ajustes de TeleFotos"
              onClick={() => navigate(authenticated ? "/settings" : "/auth")}
            >
              {profile.photo ? <img src={profile.photo} alt="" /> : profile.name[0].toLocaleUpperCase("es")}
            </button>
          </>
        )}
      </header>
      <main className="tf-main">
        {androidMedia && !device.access?.available && (
          <section className="tf-access">
            <Smartphone />
            <h2>Tus fotos, aquí mismo</h2>
            <p>
              Permite el acceso para ver las fotos del dispositivo. Puedes
              elegir solo algunas.
            </p>
            <button
              className="tf-primary"
              onClick={() => void device.requestAccess()}
            >
              Elegir fotos del dispositivo
            </button>
          </section>
        )}
        {device.error && (
          <p className="tf-notice" role="alert">
            {device.error}{" "}
            <button onClick={() => void device.checkAccess()}>
              Reintentar
            </button>
          </p>
        )}
        {downloads.running && <p className="tf-notice" role="status">Descargando {downloads.completed + 1} de {downloads.total} · {downloads.progress}%</p>}
        {backup.running && (
          <p className="tf-notice" role="status">
            {backup.status}
          </p>
        )}
        {tab === "search" && (
          <div className="tf-search">
            <Search size={22} />
            <input
              autoFocus
              placeholder="Buscar por nombre, álbum o fecha"
              aria-label="Buscar fotos"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Borrar búsqueda" onClick={() => setQuery("")}>
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {showCollections ? (
          <section className="tf-collections">
            <h1>Colecciones</h1>
            <div className="tf-collection-links">
              {(
                [
                  { filter: "favorites", icon: Star },
                  { filter: "videos", icon: Video },
                  { filter: "archive", icon: Archive },
                  { filter: "trash", icon: Trash2 },
                ] as const
              ).map((item) => (
                <button
                  key={item.filter}
                  onClick={() => collection(item.filter)}
                >
                  <item.icon />
                  <span>{labels[item.filter]}</span>
                </button>
              ))}
            </div>
            <div className="tf-section-title">
              <h2>Álbumes</h2>
              <small>{albums.length}</small>
            </div>
            {albums.length === 0 ? (
              <div className="tf-empty">
                <Album size={42} />
                <h2>Tus fotos, a tu manera</h2>
                <p>
                  Selecciona fotos y toca «Añadir a álbum» para crear tu primera
                  colección.
                </p>
                <button onClick={() => changeTab("photos")}>
                  Elegir fotos
                </button>
              </div>
            ) : (
              <div className="tf-albums">
                {albums.map((name) => {
                  const items = allMedia.filter((file) =>
                    file.albumNames?.includes(name),
                  );
                  return (
                    <button
                      key={name}
                      className="tf-album"
                      onClick={() => collection("all", name)}
                    >
                      <span className="tf-album-cover">
                        <PhotoCover file={albumCover(items, name)} account={phone ?? ""} />
                      </span>
                      <strong>{name}</strong>
                      <small>{items.length} elementos</small>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <>
            {tab === "photos" &&
              allMedia.length > 0 &&
              filter === "all" &&
              !album && (
                <div className="tf-memories">
                  {albums.slice(0, 3).map((name) => (
                    <button
                      className="tf-memory"
                      key={name}
                      onClick={() => {
                        setTab("collections");
                        collection("all", name);
                      }}
                    >
                      <Album />
                      <strong>{name}</strong>
                    </button>
                  ))}
                  <button
                    className="tf-memory tf-memory-primary"
                    onClick={() => collection("favorites")}
                  >
                    <Star />
                    <strong>Favoritos</strong>
                    <span>Tus fotos y videos favoritos</span>
                  </button>
                  <button
                    className="tf-memory"
                    onClick={() => collection("videos")}
                  >
                    <Video />
                    <strong>Videos</strong>
                    <span>Todos tus videos</span>
                  </button>
                </div>
              )}
            <div className="tf-section-title">
              {filter !== "all" || album ? (
                <button className="tf-back" onClick={() => collection("all")}>
                  <ArrowLeft size={20} />
                  <h1>{album ?? labels[filter]}</h1>
                </button>
              ) : (
                <h1>{tab === "search" ? "Resultados" : "Fotos"}</h1>
              )}
              {album && <button aria-label="Opciones del álbum" onClick={() => setAlbumMenu(true)}><MoreVertical /></button>}
              <button
                aria-label="Cambiar tamaño de cuadrícula"
                onClick={() =>
                  setColumns(columns === 3 ? 5 : columns === 5 ? 2 : 3)
                }
              >
                <Grid2X2 size={20} />
              </button>
            </div>
            {filter === "trash" && photos.length > 0 && (
              <div className="tf-trash-notice">
                <p>Al vaciar la papelera se eliminarán definitivamente los archivos de Telegram.</p>
                <button onClick={() => setTrashAction({ mode: "empty", fileIds: [] })}>Vaciar papelera</button>
              </div>
            )}
            {loading && (
              <p className="tf-notice" role="status">
                Cargando biblioteca…
              </p>
            )}
            {groups.map((group) => (
              <section key={group.key} className="tf-day">
                <div className="tf-day-heading">
                  <h2>{group.label}</h2>
                  <button
                    aria-label={`Seleccionar ${group.label}`}
                    onClick={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        const all = group.files.every((file) =>
                          next.has(file.id),
                        );
                        group.files.forEach((file) =>
                          all ? next.delete(file.id) : next.add(file.id),
                        );
                        return next;
                      })
                    }
                  >
                    <Check size={17} />
                  </button>
                </div>
                <div
                  className="tf-grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
                  }}
                >
                  {group.files.map((file) => (
                    <PhotoTile
                      key={file.id}
                      file={file}
                      account={phone ?? ""}
                      selected={selected.has(file.id)}
                      selecting={selected.size > 0}
                      onSelect={() => toggle(file.id)}
                      onOpen={() => setPreview(file.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {!loading && photos.length === 0 && (
              <div className="tf-empty">
                <Images size={48} />
                <h2>
                  {tab === "search"
                    ? "No encontramos fotos"
                    : filter === "all"
                      ? "Tu historia empieza aquí"
                      : `Sin elementos en ${labels[filter].toLowerCase()}`}
                </h2>
                <p>
                  {tab === "search"
                    ? "Prueba con otro nombre, álbum o fecha."
                    : "Añade tus fotos y videos con el botón +. Se guardarán en tu canal privado de Telegram."}
                </p>
              </div>
            )}
          </>
        )}
      </main>
      {selected.size > 0 ? (
        <div className="tf-selection-toolbar">
          <button disabled={downloads.running} onClick={() => void downloadSelected()}>
            <Download />
            <span>{downloads.running ? `${downloads.completed}/${downloads.total}` : "Descargar"}</span>
          </button>
          {photos.some(
            (file) => selected.has(file.id) && file.localUri && !file.messageId,
          ) && (
            <button
              onClick={() => {
                if (!authenticated) {
                  navigate("/auth");
                  return;
                }
                void runPhotoBackup(
                  photos.filter(
                    (file) => selected.has(file.id) && file.localUri,
                  ),
                ).catch((error) => toast.error(String(error)));
                setSelected(new Set());
              }}
            >
              <CloudUpload />
              <span>Respaldar</span>
            </button>
          )}
          <button onClick={() => setAlbumOpen(true)}>
            <Album />
            <span>Añadir a álbum</span>
          </button>
          <button
            onClick={() => {
              void actions.star(photos.filter((file) => selected.has(file.id)));
              setSelected(new Set());
            }}
          >
            <Star />
            <span>Favoritos</span>
          </button>
          <button
            onClick={() => {
              void actions.trash(
                photos.filter((file) => selected.has(file.id)),
                filter === "trash",
              );
              setSelected(new Set());
            }}
          >
            <Trash2 />
            <span>{filter === "trash" ? "Restaurar" : "Papelera"}</span>
          </button>
          {filter === "trash" && (
            <button className="tf-delete-action" onClick={() => setTrashAction({ mode: "selected", fileIds: [...selected] })}>
              <Trash2 />
              <span>Eliminar definitivamente</span>
            </button>
          )}
        </div>
      ) : (
        <nav className="tf-bottom" aria-label="Navegación principal">
          <div className="tf-nav-pill">
            <button
              className={tab === "photos" ? "active" : ""}
              aria-label="Fotos"
              aria-current={tab === "photos" ? "page" : undefined}
              onClick={() => changeTab("photos")}
            >
              <Image />
              {tab === "photos" && <span>Fotos</span>}
            </button>
            <button
              className={tab === "collections" ? "active" : ""}
              aria-label="Colecciones"
              aria-current={tab === "collections" ? "page" : undefined}
              onClick={() => changeTab("collections")}
            >
              <Album />
              {tab === "collections" && <span>Colecciones</span>}
            </button>
          </div>
          <button
            className={`tf-search-nav ${tab === "search" ? "active" : ""}`}
            aria-label="Buscar"
            aria-current={tab === "search" ? "page" : undefined}
            onClick={() => changeTab("search")}
          >
            <Search />
          </button>
            <label className="tf-upload tf-add-nav" title="Añadir fotos y videos">
              <GooglePlusIcon />
              <input
                aria-label="Añadir fotos y videos"
                type="file"
                accept="image/*,video/*,.heic,.heif"
                multiple
                onChange={(event) => {
                  if (!authenticated) {
                    navigate("/auth");
                    event.target.value = "";
                    return;
                  }
                  const items = Array.from(event.target.files ?? []).filter(
                    (file) =>
                      file.type.startsWith("image/") ||
                      file.type.startsWith("video/") ||
                      /\.hei[cf]$/i.test(file.name),
                  );
                  useFileStore.getState().setFolder("/");
                  addFilesToUploadQueue(items);
                  event.target.value = "";
                }}
              />
            </label>
        </nav>
      )}
      {trashAction && (
        <div className="tf-scrim" onClick={() => setTrashAction(null)}>
          <section className="tf-sheet tf-confirm-sheet" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación definitiva" onClick={(event) => event.stopPropagation()}>
            <h2>{trashAction.mode === "empty" ? "¿Vaciar papelera?" : "¿Eliminar definitivamente?"}</h2>
            <p>{trashAction.mode === "empty"
              ? "Se borrarán los archivos de la papelera de Telegram. No podrás recuperarlos."
              : `Se eliminarán ${trashAction.fileIds.length} elemento(s) de Telegram y no podrás recuperarlos.`}</p>
            <div className="tf-dialog-actions">
              <button onClick={() => setTrashAction(null)}>Cancelar</button>
              <button onClick={() => {
                const action = trashAction;
                setTrashAction(null);
                if (action.mode === "empty") void actions.emptyTrash();
                else void actions.deleteMultiplePermanently(action.fileIds);
                setSelected(new Set());
              }}>Eliminar definitivamente</button>
            </div>
          </section>
        </div>
      )}
      {albumMenu && album && (
        <div className="tf-scrim" onClick={() => setAlbumMenu(false)}>
          <section className="tf-sheet" role="dialog" aria-modal="true" aria-label="Opciones del álbum" onClick={event => event.stopPropagation()}>
            <button className="tf-sheet-close" aria-label="Cerrar opciones del álbum" onClick={() => setAlbumMenu(false)}><X /></button>
            <h2>{album}</h2>
            <button className="tf-sheet-row" onClick={() => { setAlbumMenu(false); setCoverPicker(true); }}><Image /> Elegir portada</button>
            <button className="tf-sheet-row" onClick={() => { setAlbumMenu(false); setRemoveAlbumOpen(true); }}><Trash2 /> Eliminar álbum</button>
          </section>
        </div>
      )}
      {coverPicker && album && (
        <div className="tf-scrim">
          <section className="tf-sheet" role="dialog" aria-modal="true" aria-label="Elegir portada del álbum">
            <button className="tf-sheet-close" aria-label="Cerrar portadas" onClick={() => setCoverPicker(false)}><X /></button>
            <h2>Elegir portada</h2>
            <p>Elige una imagen de {album} para identificarlo.</p>
            <div className="tf-cover-choices">
              {photos.map(file => <button key={file.id} disabled={savingAlbum} aria-label={`Usar ${file.name} como portada`} onClick={() => void chooseCover(file.id)}>
                <PhotoCover file={file} account={phone ?? ""} />
              </button>)}
            </div>
          </section>
        </div>
      )}
      {removeAlbumOpen && album && (
        <div className="tf-scrim">
          <section className="tf-sheet" role="dialog" aria-modal="true" aria-label="Eliminar álbum">
            <h2>¿Eliminar «{album}»?</h2>
            <p>Las fotos y videos seguirán en tu biblioteca. Solo se elimina el álbum.</p>
            <div className="tf-dialog-actions">
              <button disabled={savingAlbum} onClick={() => setRemoveAlbumOpen(false)}>Cancelar</button>
              <button disabled={savingAlbum} onClick={() => void removeCurrentAlbum()}>{savingAlbum ? "Eliminando…" : "Eliminar álbum"}</button>
            </div>
          </section>
        </div>
      )}
      {albumOpen && (
        <div className="tf-scrim">
          <form
            className="tf-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Añadir a álbum"
            onSubmit={(event) => {
              event.preventDefault();
              if (!albumName.trim()) return;
              void actions.album(
                photos.filter((file) => selected.has(file.id)),
                albumName,
              );
              setAlbumOpen(false);
              setSelected(new Set());
              setAlbumName("");
            }}
          >
            <h2>Añadir a álbum</h2>
            <input
              autoFocus
              placeholder="Nombre del álbum"
              aria-label="Nombre del álbum"
              maxLength={100}
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
            />
            <div className="tf-album-choices">
              {albums.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => setAlbumName(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="tf-dialog-actions">
              <button type="button" onClick={() => setAlbumOpen(false)}>
                Cancelar
              </button>
              <button disabled={!albumName.trim()} type="submit">
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
      {preview && (
        <PhotoViewer
          files={photos}
          id={preview}
          onNavigate={setPreview}
          onClose={() => setPreview(undefined)}
        />
      )}
      <UploadProgressPanel />
    </div>
  );
}
