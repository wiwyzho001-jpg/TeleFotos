import { lazy, Suspense, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { restoreSession } from "./lib/telegram/restoreSession";
import { bootstrapTeleDrive } from "./lib/telegram/bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { invoke } from "@tauri-apps/api/core";

// Lazy pages
const PhotosLayout = lazy(() => import("./components/photos/PhotosLayout"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const RemoteSyncOrchestrator = lazy(
  () => import("./components/RemoteSyncOrchestrator"),
);
const WhatsNewDialog = lazy(
  () => import("./components/support/WhatsNewDialog"),
);
import { useSupportStore } from "./stores/supportStore";

// Full-screen spinner fallback
function LoadingFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background select-none">
      <Loader2 className="h-8 w-8 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
    </div>
  );
}

// Splash Screen Loader
function SplashLoader({ status }: { status: string }) {
  const { t } = useTranslation("drive");
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground gap-4 select-none">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/phogram-logo.png"
          alt={t("logoAlt")}
          className="h-16 w-16 object-contain shrink-0"
        />
        <div className="flex items-center gap-2.5 text-[#444746] dark:text-[#C4C7C5] font-medium bg-surface dark:bg-[#111214] border border-slate-200/80 dark:border-white/[0.04] px-5 py-2 rounded-full shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
          <span className="text-xs">{status}</span>
        </div>
      </div>
    </div>
  );
}

// Protected Route Guard
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/auth" replace />;
}

// Guest/Auth Route Guard
function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return !isAuthenticated ? <>{children}</> : <Navigate to="/photos" replace />;
}

import { useTheme } from "./hooks/useTheme";

function App() {
  useTheme(); // Initialize theme logic
  const [isRestoring, setIsRestoring] = useState(true);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { t } = useTranslation("drive");
  const status = t("splash.connecting");

  useEffect(() => {
    useSupportStore.getState().initFirstLaunch();
    let active = true;
    async function initSession() {
      try {
        // Fast local check first:
        const stored = await invoke<{
          session: string | null;
          phone: string | null;
        }>("load_session");
        const sessionString = stored?.session ?? null;
        const phoneNumber = stored?.phone ?? "";

        if (sessionString && active) {
          // Pre-authenticate the user immediately so route guards resolve and layouts mount
          const { useAuthStore } = await import("./stores/authStore");
          useAuthStore.getState().setSession(sessionString, phoneNumber);

          // If we have cached files, bypass the splash screen instantly!
          const cached = localStorage.getItem("teledrive_cached_files");
          let hasCachedFiles = false;
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed) && parsed.length > 0) {
                hasCachedFiles = true;
              }
            } catch (_) {}
          }

          if (hasCachedFiles) {
            setIsRestoring(false);
          }

          // Trigger Telegram connection and remote sync in the background
          (async () => {
            const { useFileStore } = await import("./stores/fileStore");
            useFileStore.getState().setSyncing(true);
            try {
              const restored = await restoreSession();
              if (restored) {
                await bootstrapTeleDrive(undefined, phoneNumber);
              }
            } catch (err) {
              console.error(
                "Background session restoration/bootstrap failed:",
                err,
              );
            } finally {
              if (active) {
                useFileStore.getState().setSyncing(false);
                setIsRestoring(false);
              }
            }
          })();
        } else {
          // No stored session, go to login page (bypass splash loader)
          if (active) setIsRestoring(false);
        }
      } catch (err: any) {
        console.error("Failed to restore session on app launch:", err);
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_ERR: ${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`,
        }).catch(() => {});
        if (active) setIsRestoring(false);
      }
    }
    initSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const completeNativeBackup = async (requestId: string, outcome: string) => {
      const { androidMedia, mediaCommand } =
        await import("./lib/photos/device");
      if (androidMedia) {
        await mediaCommand("completeBackgroundBackup", { requestId, outcome });
      }
    };
    const handleBackgroundBackup = async (event: Event) => {
      const { requestId, phone } = (
        event as CustomEvent<{ requestId: string; phone: string }>
      ).detail;
      let outcome = "retry";
      try {
        const [{ runPhotoBackup, usePhotoBackup }, { useFileStore }] =
          await Promise.all([
            import("./lib/photos/backup"),
            import("./stores/fileStore"),
          ]);
        const auth = useAuthStore.getState();
        const files = useFileStore.getState();
        if (!auth.isAuthenticated || auth.phoneNumber !== phone) {
          outcome = "disabled";
        } else if (
          !files.bootstrapComplete ||
          files.isSyncing ||
          usePhotoBackup.getState().running
        ) {
          outcome = "retry";
        } else {
          await runPhotoBackup();
          outcome = usePhotoBackup.getState().error ? "retry" : "success";
        }
      } catch (error) {
        console.warn("Respaldo en segundo plano en pausa:", error);
      } finally {
        await completeNativeBackup(requestId, outcome).catch((error) =>
          console.warn(
            "No se pudo confirmar el respaldo en segundo plano:",
            error,
          ),
        );
      }
    };
    window.addEventListener(
      "telefotos-background-backup",
      handleBackgroundBackup,
    );
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (
        previous.isAuthenticated &&
        !state.isAuthenticated &&
        previous.phoneNumber
      ) {
        void import("./lib/photos/device")
          .then(({ androidMedia, mediaCommand }) => {
            if (androidMedia) {
              return mediaCommand("configurePhotoBackup", {
                phone: previous.phoneNumber,
                enabled: false,
                wifiOnly: true,
              });
            }
          })
          .catch((error) =>
            console.warn(
              "No se pudo detener el respaldo al cerrar sesión:",
              error,
            ),
          );
      }
    });
    return () => {
      window.removeEventListener(
        "telefotos-background-backup",
        handleBackgroundBackup,
      );
      unsubscribeAuth();
    };
  }, []);

  if (isRestoring) {
    return <SplashLoader status={status} />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Start at Telegram sign-in; authenticated users are redirected by GuestRoute. */}
          <Route path="/" element={<Navigate to="/auth" replace />} />

          {/* Guest routes (Auth) */}
          <Route
            path="/auth"
            element={
              <GuestRoute>
                <AuthPage />
              </GuestRoute>
            }
          />

          <Route
            path="/photos"
            element={
              <ProtectedRoute>
                <PhotosLayout />
              </ProtectedRoute>
            }
          />

          {/* Old links return to the single photo library. */}
          <Route path="/drive/*" element={<Navigate to="/photos" replace />} />

          {/* Settings protected route */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      {/* Live multi-device sync coordinator. Headless component
          that runs only while authenticated + bootstrapped. */}
      <Suspense fallback={null}>
        <RemoteSyncOrchestrator />
      </Suspense>
      {/* Support & update dialogs */}
      {isAuthenticated && (
        <Suspense fallback={null}>
          <WhatsNewDialog />
        </Suspense>
      )}
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
