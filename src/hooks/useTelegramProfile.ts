import { useEffect, useState } from "react";
import { withMediaConnection } from "@/lib/telegram/mediaConnection";

interface Profile { photo?: string; name: string; }
const empty: Profile = { name: "Telegram" };
function readProfile(account: string | null): Profile {
  try { return JSON.parse(localStorage.getItem(`telefotos-profile:${account}`) ?? "null") ?? empty; }
  catch { return empty; }
}

export function useTelegramProfile(account: string | null, ready: boolean, opened: boolean) {
  const [profile, setProfile] = useState<Profile>(() => readProfile(account));
  useEffect(() => {
    setProfile(readProfile(account));
    if (!account || !ready) return;
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const next = await withMediaConnection(async client => {
          // Fetch the current user, rather than a possibly stale entity for "me".
          const me = await client.getMe();
          const name = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "Telegram";
          const bytes = await client.downloadProfilePhoto(me, { isBig: false });
          let photo: string | undefined;
          if (bytes && typeof bytes !== "string" && bytes.length) {
            photo = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
            });
          }
          return { name, photo };
        });
        if (!cancelled) {
          setProfile(next);
          try { localStorage.setItem(`telefotos-profile:${account}`, JSON.stringify(next)); } catch { /* Cache is optional. */ }
        }
      } catch (error) { console.warn("No se pudo actualizar el perfil de Telegram:", error); }
      finally { loading = false; }
    };
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); };
  }, [account, ready, opened]);
  return profile;
}
