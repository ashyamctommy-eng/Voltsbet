import { getSettings } from "@/lib/settings";

/** Floating WhatsApp + Telegram widgets, configured from the admin backend (§33/§34). */
export default async function SupportWidgets() {
  const s = await getSettings();

  return (
    <>
      {s.whatsappEnabled && s.whatsapp && (
        <a
          href={`https://wa.me/${s.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(s.whatsappMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`fixed z-40 flex h-13 w-13 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform hover:scale-110 ${
            s.whatsappPosition === "bottom-left" ? "bottom-20 left-4 xl:bottom-6 xl:left-6" : "bottom-20 right-4 xl:bottom-6 xl:right-6"
          }`}
          style={{ width: 52, height: 52 }}
          aria-label="WhatsApp support"
          title="Chat on WhatsApp"
        >
          <svg viewBox="0 0 32 32" width="26" height="26" fill="#fff" aria-hidden>
            <path d="M16 3C9.4 3 4 8.4 4 15c0 2.6.8 5 2.2 7L4 29l7.2-2.1c1.9 1 4 1.6 6.3 1.6 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-2.2 0-4.3-.6-6.1-1.8l-.4-.3-4.2 1.2 1.2-4.1-.3-.4C5.1 17.8 4.5 15.9 4.5 14 4.5 8.7 9.3 3.9 16 3.9S27.5 8.7 27.5 14 22.7 24.8 16 24.8zm5.8-7.3c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.5-.1-.2-.7-1.8-1-2.4-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.1 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4z" />
          </svg>
        </a>
      )}
      {s.telegramEnabled && s.telegram && (
        <a
          href={s.telegram}
          target="_blank"
          rel="noopener noreferrer"
          className={`fixed bottom-28 z-40 flex items-center justify-center rounded-full bg-[#229ED9] shadow-lg transition-transform hover:scale-110 xl:bottom-16 ${
            s.telegramPosition === "bottom-right" ? "right-4 xl:right-6" : "left-4 xl:left-6"
          }`}
          style={{ width: 52, height: 52 }}
          aria-label="Join Telegram community"
          title="Telegram"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="#fff" aria-hidden>
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
      )}
    </>
  );
}

