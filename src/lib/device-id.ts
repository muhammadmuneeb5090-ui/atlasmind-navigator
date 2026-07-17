const DEVICE_ID_KEY = "atlasmind:device_id";

/**
 * Returns a stable per-device identifier, generating and persisting one on
 * first call. Used to attribute community reports, favorites, route history,
 * and place confirmations. NOT a security boundary — the app is single-tenant
 * with no sign-in; this is attribution only.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr-unknown";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
