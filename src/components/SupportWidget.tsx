"use client";

import { useState } from "react";
import { IconChat, IconPhone, IconSend, IconWhatsApp, IconTelegram } from "@/components/icons";

type SupportConfig = {
  phone: string;
  whatsappEnabled: boolean;
  whatsapp: string;
  telegramEnabled: boolean;
  telegram: string;
};

const FAQ: { q: string; a: string }[] = [
  { q: "How do I deposit?", a: "Tap the green wallet button in the header, pick Crypto or M-Pesa, enter an amount and follow the instructions. Crypto deposits credit automatically via webhook." },
  { q: "How do I withdraw?", a: "Go to Account → Withdraw, choose your method and amount. Withdrawals are reviewed and paid out by our team." },
  { q: "Why is my bet unsettled?", a: "Bets settle automatically shortly after a match finishes. If a market needed manual review it stays open until our team confirms the result." },
  { q: "What is the accumulator bonus?", a: "Multiples earn a bonus on top of your combined odds: 2 picks +4%, 3 +5%, 4 +6%, 5 +7%, 6+ +8-10%." },
];

type Msg = { from: "bot" | "user"; text: string };

/** Floating support bubble + bottom-sheet modal (Live Chat / Call Us). */
export default function SupportWidget({ support }: { support: SupportConfig }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bot", text: "Hi! 👋 I'm VoltBot. Ask me about deposits, withdrawals, bets or bonuses." }]);
  const [input, setInput] = useState("");

  function ask(q: string) {
    const answer = FAQ.find((f) => f.q === q)?.a ?? "I'll get our team on it — use WhatsApp or Telegram below for instant human help.";
    setMsgs((m) => [...m, { from: "user", text: q }, { from: "bot", text: answer }]);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    setMsgs((m) => [...m, { from: "user", text: q }, { from: "bot", text: "Thanks — a human agent will reply shortly. For instant help use WhatsApp or Telegram below." }]);
  }

  return (
    <>
      {/* Floating chat bubble (bottom-left, above bottom nav) */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open support"
        className="fixed bottom-20 left-4 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.45)] transition-transform hover:scale-110 xl:bottom-6 xl:left-6"
        style={{ width: 52, height: 52 }}
      >
        <IconChat className="h-6 w-6" />
      </button>

      {/* Bottom-sheet support modal */}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Support">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => { setOpen(false); setChat(false); }} />
          <div className="sheet-up relative w-full max-w-md overflow-hidden rounded-t-2xl border border-line bg-[#0d1726] sm:rounded-2xl">
            {/* Gradient header */}
            <div className="relative bg-gradient-to-r from-sky-600 to-blue-700 px-5 py-5">
              <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-white">Need Help? — We're here to assist you 24/7</h2>
                  <p className="mt-0.5 text-xs text-sky-100/90">Available Monday - Sunday, 24 hours</p>
                </div>
                <button
                  onClick={() => { setOpen(false); setChat(false); }}
                  aria-label="Close support"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            </div>

            {!chat ? (
              <div className="space-y-3 p-5">
                <button
                  onClick={() => setChat(true)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-line bg-[#131d2e] p-4 text-left transition-colors hover:border-sky-500/50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                    <IconChat className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold text-ink">Live Chat</span>
                    <span className="block text-xs text-ink3">Chat with our support team instantly</span>
                  </span>
                </button>

                <a
                  href={`tel:${support.phone.replace(/[^+\d]/g, "")}`}
                  className="flex w-full items-center gap-4 rounded-2xl border border-line bg-[#131d2e] p-4 text-left transition-colors hover:border-sky-500/50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-500/15 text-green-400">
                    <IconPhone className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold text-ink">Call Us</span>
                    <span className="block text-xs text-ink3">Speak to an agent: {support.phone}</span>
                  </span>
                </a>

                <p className="pt-1 text-center text-[11px] text-ink3">Available Monday - Sunday, 24 hours</p>
              </div>
            ) : (
              <div className="flex h-[380px] flex-col">
                {/* Messages */}
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {msgs.map((m, i) => (
                    <div key={i} className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.from === "bot" ? "rounded-bl-sm bg-[#131d2e] text-ink" : "ml-auto rounded-br-sm bg-brand/90 text-[#052e16]"}`}>
                      {m.text}
                    </div>
                  ))}
                  <div className="pt-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-ink3">Quick questions</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {FAQ.map((f) => (
                        <button key={f.q} onClick={() => ask(f.q)} className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink2 transition-colors hover:border-sky-500/50 hover:text-ink">
                          {f.q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Composer */}
                <form onSubmit={send} className="flex items-center gap-2 border-t border-line p-3">
                  <input
                    className="input !py-2"
                    placeholder="Type a message…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <button type="submit" aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-[#052e16]">
                    <IconSend className="h-5 w-5" />
                  </button>
                </form>

                {/* Human channels */}
                {(support.whatsappEnabled || support.telegramEnabled) && (
                  <div className="flex items-center justify-center gap-2 border-t border-line p-3">
                    <span className="text-[11px] text-ink3">Prefer a human?</span>
                    {support.whatsappEnabled && (
                      <a href={`https://wa.me/${support.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white">
                        <IconWhatsApp className="h-4 w-4" />
                      </a>
                    )}
                    {support.telegramEnabled && (
                      <a href={support.telegram} target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#229ED9] text-white">
                        <IconTelegram className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
