"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/client";

/**
 * Printable voucher sheets. Full codes exist ONLY in the generating admin's
 * session (sessionStorage — they are never stored server-side), so:
 *   - fresh generation → full codes render on the sheets;
 *   - otherwise → masked codes render with a notice.
 * Print: window.print() with @media print rules (sheets only).
 */
export default function VoucherPrintPage() {
  const sp = useSearchParams();
  const batchId = sp?.get("batchId") ?? "";
  const value = sp?.get("value") ?? "";
  const currency = sp?.get("currency") ?? "";
  const [codes, setCodes] = useState<string[] | null>(null);
  const [masked, setMasked] = useState<{ displayCode: string; status: string }[] | null>(null);
  const [batchName, setBatchName] = useState<string | null>(null);
  const [val, setVal] = useState(value);
  const [cur, setCur] = useState(currency);

  useEffect(() => {
    if (!batchId) return;
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(`vb_voucher_codes_${batchId}`);
        if (raw) setCodes(JSON.parse(raw) as string[]);
      } catch { /* ignore */ }
      apiFetch<{ batch: { name: string | null; value: number; currency: string }; vouchers: { displayCode: string; status: string }[] }>(
        `/api/admin/voucher-batches/${batchId}`,
      ).then((r) => {
        if (!r.ok) return;
        setBatchName(r.data.batch.name);
        if (!val) {
          setVal(String(r.data.batch.value));
          setCur(r.data.batch.currency);
        }
        if (!codes) setMasked(r.data.vouchers);
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const rows = codes ?? masked?.map((m) => m.displayCode) ?? [];
  const isFull = !!codes;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-extrabold">Print Voucher Sheets</h1>
          <p className="text-sm text-ink3">
            {isFull
              ? "Full codes from this session — printable."
              : "Full codes are only available in the session that generated them. Showing masked codes."}
            {batchName ? ` · Batch: ${batchName}` : ""}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => window.print()}>Print ({rows.length})</button>
      </div>

      {/* Sheets — 6 per page (2 cols × 3 rows), print CSS isolates this grid */}
      <div className="voucher-sheet-grid">
        {rows.map((code, i) => (
          <div key={`${code}-${i}`} className="voucher-card">
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-brand">VoltBet</div>
              <div className="text-[9px] uppercase tracking-wider text-ink3">Deposit Voucher</div>
              <div className="mt-2 text-xl font-extrabold">
                {cur} {Number(val || 0).toLocaleString()}
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-line2 px-2 py-2 font-mono text-sm font-bold tracking-wider">
                {code}
              </div>
              {!isFull && (
                <div className="mt-1 text-[9px] text-amber-500">masked — codes available only at generation</div>
              )}
              <div className="mt-2 text-[9px] text-ink3">Valid until: {new Date().toLocaleDateString()}</div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="card p-10 text-center text-sm text-ink3">No vouchers to print for this batch.</div>
        )}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .voucher-sheet-grid, .voucher-sheet-grid * { visibility: visible; }
          .voucher-sheet-grid {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr);
            gap: 8mm;
            width: 100%;
          }
          .voucher-card {
            border: 1.5px dashed #333 !important;
            border-radius: 6px;
            padding: 10mm 6mm;
            break-inside: avoid;
            page-break-inside: avoid;
            color: #000 !important;
            background: #fff !important;
          }
          .voucher-card .text-brand { color: #000 !important; }
          .voucher-card .text-ink3 { color: #555 !important; }
        }
        .voucher-sheet-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
        .voucher-card { border: 1.5px dashed var(--line2, #334155); border-radius: 10px; padding: 2rem 1rem; }
      `}</style>
    </div>
  );
}
