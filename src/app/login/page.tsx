"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await apiFetch<{ redirect: string }>("/api/auth/login", {
      method: "POST",
      body: { identifier, password, remember },
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    router.push(res.data.redirect ?? "/");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="card p-8">
        <h1 className="text-2xl font-extrabold">Welcome back</h1>
        <p className="mt-1 text-sm text-ink2">Log in to your account to keep betting.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
          <div>
            <label className="label" htmlFor="identifier">Username or email</label>
            <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-ink2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--vb-primary)]" />
              Remember me
            </label>
            <a href="#" className="text-ink3 hover:text-ink" onClick={(e) => e.preventDefault()}>Forgot password?</a>
          </div>
          <button className="btn btn-primary w-full py-3" disabled={loading}>
            {loading ? "Logging in…" : "Log In"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink2">
          New to VoltBet?{" "}
          <Link href="/register" className="font-semibold text-brand hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
