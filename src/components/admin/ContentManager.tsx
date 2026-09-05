"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/BetSlipContext";

type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "checkbox";
  placeholder?: string;
};

type Row = Record<string, unknown> & { id: string };

/**
 * Generic admin CRUD manager (used by Banners, etc.).
 *
 * Mode is an explicit `{ kind: "create" } | { kind: "edit", row } | null`
 * union — never inferred from a sentinel id — so:
 *  - "Edit" on a row ALWAYS populates the form from that row and saves via
 *    PATCH `/endpoint/{id}` (updates the record, never duplicates it);
 *  - "Add" ALWAYS saves via POST (creates a new record).
 */
type Mode = { kind: "create" } | { kind: "edit"; row: Row } | null;

function blankForm(fields: Field[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? false : ""]));
}

export function ContentManager({
  endpoint, title, fields, columns,
}: {
  endpoint: string;
  title: string;
  fields: Field[];
  columns: { key: string; label: string; render?: (r: Row) => React.ReactNode }[];
}) {
  const { push } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<Record<string, Row[]>>(endpoint);
    if (r.ok) {
      const key = Object.keys(r.data).find((k) => k !== "ok");
      if (key) setRows(r.data[key] ?? []);
    }
  }, [endpoint]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  function closeForm() {
    setMode(null);
    setForm({});
  }

  function startCreate() {
    setMode({ kind: "create" });
    setForm(blankForm(fields));
  }

  function startEdit(r: Row) {
    // Populate the form with the selected row's stored values (Title,
    // Destination URL, Sort Order, Active, Image, …) and enter UPDATE mode.
    const f: Record<string, unknown> = {};
    for (const field of fields) {
      f[field.name] = r[field.name] ?? (field.type === "checkbox" ? false : "");
    }
    setMode({ kind: "edit", row: r });
    setForm(f);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res =
      mode?.kind === "edit"
        ? await apiFetch(`${endpoint}/${mode.row.id}`, { method: "PATCH", body: form })
        : await apiFetch(endpoint, { method: "POST", body: form });
    setLoading(false);
    if (!res.ok) return push("error", res.error.message);
    push("success", mode?.kind === "edit" ? `${title}: updated` : `${title}: created`);
    closeForm();
    load();
  }

  async function remove(r: Row) {
    if (!confirm(`Delete this item?`)) return;
    const res = await apiFetch(`${endpoint}/${r.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return push("error", res.error.message);
    push("success", "Deleted");
    load();
  }

  const inputCls = "input";
  const isEditing = mode?.kind === "edit";

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">{title}</h2>

      {!mode && (
        <button className="btn btn-primary" onClick={startCreate}>
          + Add {title.slice(0, -1)}
        </button>
      )}

      {mode && (
        <form onSubmit={save} className="card grid gap-3 p-5 sm:grid-cols-2">
          <div className="flex items-center justify-between sm:col-span-2">
            <h3 className="font-bold">{isEditing ? "Edit" : "New"}</h3>
            <button type="button" className="text-sm text-ink3 hover:text-ink" onClick={closeForm}>Cancel</button>
          </div>
          {fields.map((f) => (
            <div key={f.name} className={f.type === "textarea" || f.type === "checkbox" ? "sm:col-span-2" : ""}>
              <label className="label">{f.label}</label>
              {f.type === "textarea" ? (
                <textarea className={inputCls} rows={3} value={String(form[f.name] ?? "")} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} placeholder={f.placeholder} />
              ) : f.type === "checkbox" ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink2">
                  <input type="checkbox" checked={!!form[f.name]} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} className="h-4 w-4 accent-[var(--vb-primary)]" />
                  {f.placeholder ?? "Active"}
                </label>
              ) : (
                <input
                  className={inputCls}
                  type={f.type === "number" ? "number" : "text"}
                  step={f.type === "number" ? "any" : undefined}
                  value={String(form[f.name] ?? "")}
                  onChange={(e) => setForm({ ...form, [f.name]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                  placeholder={f.placeholder}
                  required={f.name === "title" || f.name === "name" || f.name === "text" ? true : false}
                />
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 sm:col-span-2">
            <button className="btn btn-primary" disabled={loading}>{loading ? "Saving…" : isEditing ? "Save Changes" : "Save"}</button>
            {isEditing && (
              <button type="button" className="btn btn-ghost" onClick={startCreate}>+ Add new instead</button>
            )}
          </div>
        </form>
      )}

      <div className="card divide-y divide-line">
        {rows.length === 0 && <div className="p-8 text-center text-sm text-ink3">Nothing here yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {columns.map((c) => (
              <div key={c.key} className={c.render ? "" : "min-w-0 flex-1"}>
                {c.render ? c.render(r) : (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{String(r[c.key] ?? "—")}</div>
                  </div>
                )}
              </div>
            ))}
            <div className="ml-auto flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(r)}>Edit</button>
              <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
