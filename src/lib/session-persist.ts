/**
 * Keeps the signed-in session alive across reloads.
 *
 * Supabase already persists to localStorage, but embedded/preview contexts and
 * some privacy modes partition or clear it. We mirror the refresh token into a
 * long-lived cookie and restore from it when localStorage comes back empty.
 */
import { supabase } from "@/integrations/supabase/client";

const COOKIE = "stylear_session";
const MAX_AGE = 60 * 60 * 24 * 365; // a year — long-lived sign-in

function write(value: string) {
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${value ? MAX_AGE : 0}; samesite=${
    secure ? "none" : "lax"
  }${secure ? "; secure" : ""}`;
}

function read(): { access_token: string; refresh_token: string } | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  if (!hit) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(hit.slice(COOKIE.length + 1)));
    return parsed?.refresh_token ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberSession(session: { access_token: string; refresh_token: string } | null) {
  if (typeof document === "undefined") return;
  write(
    session
      ? encodeURIComponent(
          JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        )
      : "",
  );
}

/** Returns the restored session, or null when there is nothing to restore. */
export async function restoreSession() {
  if (typeof document === "undefined") return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const saved = read();
  if (!saved) return null;
  const { data: restored, error } = await supabase.auth.setSession(saved);
  if (error || !restored.session) {
    write("");
    return null;
  }
  return restored.session;
}
