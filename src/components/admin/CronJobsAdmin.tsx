"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/client";
import { CRON_JOBS, type CronJobDef, type CronJobId } from "@/lib/cron-jobs";
import { IconCheck, IconClock, IconCopy } from "@/components/icons";

type Props = {
  baseUrl: string;
  secret: string;
  initialSchedules: Record<string, string>;
};

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard blocked — ignore */
        }
      }}
      className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[11px] font-bold text-ink2 transition-colors hover:border-brand hover:text-brand"
      title={label}
    >
      {copied ? <IconCheck className="h-3 w-3 text-green-400" /> : <IconCopy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-black/30 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink2">
        {value}
      </code>
      <CopyBtn text={value} label={label} />
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-28 shrink-0 font-bold text-ink3">{k}</span>
      <code className="min-w-0 flex-1 break-all text-ink2">{v}</code>
      <CopyBtn text={v} label={k} />
    </div>
  );
}

export default function CronJobsAdmin({ baseUrl, secret, initialSchedules }: Props) {
  const [schedules, setSchedules] = useState<Record<string, string>>(initialSchedules);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [revealSecret, setRevealSecret] = useState(false);

  const base = baseUrl.replace(/\/+$/, "");
  const hasConfig = !!base && !!secret;

  const jobUrl = useCallback(
    (id: CronJobId) => `${base}/api/cron/${id}?secret=${secret}`,
    [base, secret],
  );

  const saveSchedule = async (job: CronJobDef) => {
    setSaving(job.id);
    const res = await apiFetch<{ saved: string[] }>("/api/admin/cronjobs", {
      method: "POST",
      body: { jobs: { [job.id]: schedules[job.id] ?? job.defaultSchedule } },
    });
    setSaving(null);
    if (res.ok) {
      setSavedFlash(job.id);
      setTimeout(() => setSavedFlash(null), 1400);
    }
  };

  const runJob = async (job: CronJobDef) => {
    setRunning(job.id);
    const res = await apiFetch<Record<string, unknown>>("/api/admin/cronjobs/run", {
      method: "POST",
      body: { job: job.id },
    });
    setRunning(null);
    setResults((r) => ({ ...r, [job.id]: JSON.stringify(res.ok ? res.data : { error: res.error }, null, 2) }));
  };

  const recommended = jobUrl("settle");

  return (
    <div className="space-y-5">
      {/* Provider recommendation + secret status */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <div className="text-xs font-black uppercase tracking-wider text-brand">My pick</div>
          <h3 className="mt-1 font-bold">cron-job.org (free)</h3>
          <p className="mt-1 text-xs text-ink3">
            Real cron syntax, fixed time-of-day, unlimited jobs, up to 60 runs/hour. UptimeRobot works too but the free plan
            has no fixed hour and a 5-min floor — fine for <code>settle</code>, clunky for daily jobs.
          </p>
          <div className="mt-2 rounded-lg bg-hover-tint px-3 py-2 text-[11px] text-ink2">
            <b>Tip:</b> sign up → New Cronjob → paste the URL below → set the schedule (cron syntax) → Test run. Done.
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-black uppercase tracking-wider text-ink3">Cron secret</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-black/30 px-2.5 py-1.5 text-[11px]">
              {revealSecret || !secret ? secret || "(not configured)" : secret.slice(0, 12) + "…" + secret.slice(-6)}
            </code>
            {secret && (
              <button
                onClick={() => setRevealSecret((v) => !v)}
                className="shrink-0 rounded-md border border-line bg-card px-2 py-1 text-[11px] font-bold text-ink2 hover:text-ink"
              >
                {revealSecret ? "Hide" : "Reveal"}
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-ink3">
            Source: Admin → Website Settings → <b>cron.secret</b> (DB) or <b>CRON_SECRET</b> env var — DB wins if set. Keep
            one source of truth (recommended: the env var).
          </p>
          {!hasConfig && (
            <div className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-[11px] font-semibold text-red-400">
              Set APP_URL (or app.url in Website Settings) and a cron secret to generate working links.
            </div>
          )}
        </div>
      </div>

      {/* Job cards */}
      {CRON_JOBS.map((job) => {
        const schedule = schedules[job.id] ?? job.defaultSchedule;
        const url = jobUrl(job.id);
        const curl = `curl -s "${url}"`;
        const wget = `wget -qO- "${url}"`;
        const result = results[job.id];
        return (
          <div key={job.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IconClock className="h-4 w-4 text-brand" />
                <h3 className="font-bold">{job.title}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    job.credits === "0" ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {job.credits === "0" ? "0 credits" : `${job.credits} credits/run`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => runJob(job)}
                  disabled={running === job.id}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-[#052e16] transition-transform hover:scale-[1.03] disabled:opacity-50"
                >
                  {running === job.id ? "Running…" : "Run now"}
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-ink3">{job.short}</p>
            <p className="mt-1 text-[11px] text-ink3">{job.description}</p>

            {/* Schedule editor */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-bold text-ink3">Schedule (UTC):</label>
              <input
                value={schedule}
                onChange={(e) => setSchedules((s) => ({ ...s, [job.id]: e.target.value }))}
                spellCheck={false}
                className="input w-40 !py-1.5 font-mono text-xs"
              />
              <button
                onClick={() => saveSchedule(job)}
                disabled={saving === job.id}
                className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-bold text-ink2 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {savedFlash === job.id ? "✓ Saved" : saving === job.id ? "Saving…" : "Save"}
              </button>
              <span className="text-[10px] text-ink3">default: <code>{job.defaultSchedule}</code></span>
            </div>

            {/* Generated configs */}
            {hasConfig ? (
              <div className="mt-3 space-y-2">
                <CodeBlock value={url} label={`${job.id} URL`} />
                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wider text-ink3">Railway cron (start command)</div>
                    <CodeBlock value={wget} label="Railway start command" />
                    <div className="text-[10px] font-black uppercase tracking-wider text-ink3">cron-job.org</div>
                    <div className="space-y-1.5">
                      <Field k="Title" v={`VoltBet ${job.title}`} />
                      <Field k="URL" v={url} />
                      <Field k="Method" v="GET" />
                      <Field k="Cron syntax" v={schedule} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wider text-ink3">UptimeRobot</div>
                    <div className="space-y-1.5">
                      <Field k="Monitor" v={`VB ${job.id}`} />
                      <Field k="URL" v={url} />
                      <Field k="Interval" v={job.uptimerobotInterval} />
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-ink3">Terminal (curl)</div>
                    <CodeBlock value={curl} label="curl command" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[11px] font-semibold text-red-400">
                Configure a base URL + cron secret above to generate copy-paste configs.
              </div>
            )}

            {/* Last run result */}
            {result && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-line bg-black/40 p-3 text-[10px] leading-relaxed text-green-300">
                {result}
              </pre>
            )}
          </div>
        );
      })}

      {/* One-time quick test */}
      <div className="card p-4">
        <h3 className="font-bold">Quick test (run this from your machine)</h3>
        {hasConfig ? (
          <div className="mt-2">
            <CodeBlock value={`curl -s "${jobUrl("settle")}"`} label="Test settle endpoint" />
            <p className="mt-1 text-[11px] text-ink3">
              Expect <code>{"{ok:true,…}"}</code> — a 401 means the secret does not match; 503 CRON_NOT_CONFIGURED means no
              secret is configured. {recommended && <span className="text-ink2">After deploy, run <code>sync</code> once manually (≈44 credits) and check Admin → Games.</span>}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
