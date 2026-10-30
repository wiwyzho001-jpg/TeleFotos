import { useEffect, useRef } from "react";

const handlers = new Map<symbol, { priority: number; handle: () => boolean }>();
declare global {
  interface Window { __telefotosHandleBack?: () => boolean; }
}
window.__telefotosHandleBack = () => {
  for (const handler of [...handlers.values()].sort((a, b) => b.priority - a.priority)) {
    if (handler.handle()) return true;
  }
  return false;
};

/** Return true when the current screen handled Android's Back action. */
export function useAndroidBack(handle: () => boolean, priority = 0) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const id = Symbol();
    handlers.set(id, { priority, handle: () => latest.current() });
    return () => { handlers.delete(id); };
  }, [priority]);
}
