import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

/** Wardrobe data is private per person, so these surfaces require a session. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.origin },
            });
      if (error) throw error;
      if (mode === "signup") toast.success("Account created — you're signed in.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign you in.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    try {
      await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    } catch (err) {
      console.error(err);
      toast.error("Google sign-in failed.");
    }
  };

  if (!ready) return <div className="glass h-40 animate-pulse rounded-3xl" aria-hidden="true" />;

  if (session)
    return (
      <div className="grid gap-4">
        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
          <span className="truncate">{session.user.email ?? "Signed in"}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-full border border-border px-4 py-1.5 transition hover:text-foreground"
          >
            Sign out
          </button>
        </div>
        {children}
      </div>
    );

  return (
    <div className="glass mx-auto w-full max-w-md rounded-3xl p-6">
      <h2 className="text-lg font-medium">
        {mode === "signin" ? "Sign in to your wardrobe" : "Create your wardrobe"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your scanned pieces are private to your account.
      </p>
      <form onSubmit={submit} className="mt-5 grid gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email"
          className="rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className="rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        onClick={google}
        className="mt-3 w-full rounded-full border border-border px-6 py-2.5 text-sm transition hover:bg-secondary"
      >
        Continue with Google
      </button>
      <button
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-4 w-full text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "No account yet? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
