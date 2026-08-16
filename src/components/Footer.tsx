import Link from "next/link";
import { getSettings } from "@/lib/settings";

export default async function Footer() {
  const s = await getSettings();
  return (
    <footer className="mt-16 border-t border-line bg-[#0a101f]">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-black text-[#052e16]">V</span>
            <span className="font-extrabold">{s.siteName}</span>
          </div>
          <p className="mt-3 text-sm text-ink3">{s.tagline}. Fast odds, live betting, instant crypto deposits.</p>
        </div>
        <div>
          <h4 className="text-sm font-bold text-ink">Betting</h4>
          <ul className="mt-3 space-y-2 text-sm text-ink3">
            <li><Link href="/sports" className="hover:text-ink">Sports</Link></li>
            <li><Link href="/live" className="hover:text-ink">Live Betting</Link></li>
            <li><Link href="/promotions" className="hover:text-ink">Promotions</Link></li>
            <li><Link href="/results" className="hover:text-ink">Results</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold text-ink">Account</h4>
          <ul className="mt-3 space-y-2 text-sm text-ink3">
            <li><Link href="/account" className="hover:text-ink">My Account</Link></li>
            <li><Link href="/account/deposit" className="hover:text-ink">Deposit</Link></li>
            <li><Link href="/account/withdraw" className="hover:text-ink">Withdraw</Link></li>
            <li><Link href="/register" className="hover:text-ink">Register</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold text-ink">Support</h4>
          <ul className="mt-3 space-y-2 text-sm text-ink3">
            <li><Link href="/responsible-gambling" className="hover:text-ink">Responsible Gambling</Link></li>
            <li><Link href="/terms" className="hover:text-ink">Terms & Conditions</Link></li>
            {s.supportEmail && <li><a href={`mailto:${s.supportEmail}`} className="hover:text-ink">{s.supportEmail}</a></li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-ink3">
        18+ · Play responsibly. Only for adults of legal age. © {new Date().getFullYear()} {s.siteName}
      </div>
    </footer>
  );
}
