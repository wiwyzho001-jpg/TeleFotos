import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { androidMedia, mediaCommand } from "@/lib/photos/device";
import { toast } from "sonner";

const RELEASES_API = "https://api.github.com/repos/wiwyzho001-jpg/TeleFotos/releases/latest";
const APK_ASSET = "TeleFotos.apk";

type Release = { tag_name: string; body?: string; assets?: Array<{ name: string; browser_download_url: string; digest?: string | null }> };
function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export default function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("—");
  const [release, setRelease] = useState<Release | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  async function checkForUpdates() {
    setChecking(true);
    setError("");
    try {
      const current = await getVersion();
      setCurrentVersion(current);
      const response = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (!response.ok) throw new Error(response.status === 404 ? "Todavía no hay una versión publicada." : `No se pudo consultar GitHub (${response.status}).`);
      const latest = await response.json() as Release;
      setRelease(latest);
      setChecked(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error(message);
    } finally {
      setChecking(false);
    }
  }

  async function installUpdate() {
    const asset = release?.assets?.find((item) => item.name === APK_ASSET);
    if (!asset) {
      toast.error(`La versión ${release?.tag_name ?? "nueva"} no incluye ${APK_ASSET}.`);
      return;
    }
    if (!androidMedia) {
      window.open(asset.browser_download_url, "_blank", "noopener,noreferrer");
      return;
    }
    setInstalling(true);
    try {
      await mediaCommand("installUpdate", { url: asset.browser_download_url, sha256: asset.digest ?? "" });
      toast.info("Abriendo el instalador de Android. Confirma la actualización para continuar.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  }

  const updateAvailable = release && compareVersions(release.tag_name, currentVersion) > 0;
  return (
    <div className="space-y-6 select-none max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">Actualizaciones</h2>
        <p className="mt-1 text-sm text-[#444746] dark:text-[#C4C7C5]">Busca e instala manualmente la versión más reciente de TeleFotos.</p>
      </div>
      <div className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs dark:border-white/[0.06] dark:bg-[#0c0d0f]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#747775] dark:text-[#9aa0a6]">Versión instalada</p>
            <p className="mt-1 text-lg font-semibold">{currentVersion}</p>
          </div>
          <Button variant="outline" onClick={() => void checkForUpdates()} disabled={checking || installing} className="gap-2 rounded-full">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Buscar actualizaciones
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {checked && release && (
          <div className="border-t border-slate-200 pt-4 dark:border-white/[0.06]">
            {updateAvailable ? (
              <>
                <p className="font-medium">Nueva versión disponible: {release.tag_name}</p>
                {release.body && <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-sm text-[#5f6368] dark:text-[#c4c7c5]">{release.body}</p>}
                <Button onClick={() => void installUpdate()} disabled={installing} className="mt-4 gap-2 rounded-full">
                  {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {installing ? "Descargando APK…" : "Descargar e instalar"}
                </Button>
                {androidMedia && <p className="mt-3 text-xs text-[#747775] dark:text-[#9aa0a6]">Android solicitará confirmar la instalación. Si es la primera actualización manual, puede pedir permiso para instalar apps de esta fuente.</p>}
              </>
            ) : <p className="text-sm">Tienes la versión más reciente ({currentVersion}).</p>}
          </div>
        )}
      </div>
    </div>
  );
}
