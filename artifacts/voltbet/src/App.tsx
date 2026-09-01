import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { ToastProvider } from "@/components/BetSlipContext";
import { BetSlipProvider } from "@/components/BetSlipContext";
import { DrawerProvider } from "@/components/DrawerProvider";
import I18nSync from "@/components/I18nSync";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import BetSlip from "@/components/BetSlip";
import BroadcastBanner from "@/components/BroadcastBanner";
import SupportWidget from "@/components/SupportWidget";
import UNIBET360SplashLoader from "@/components/VoltBetSplashLoader";
import MatchFeed, { type FeedGame } from "@/components/MatchFeed";
import MatchSlideshow from "@/components/MatchSlideshow";
import { SportIcon } from "@/components/SportIcon";
import { IconGift, IconLightning, IconShield, IconTrophy } from "@/components/icons";

const queryClient = new QueryClient();

const sports = [
  { id: "football", slug: "football", name: "Football", icon: "⚽" },
  { id: "basketball", slug: "basketball", name: "Basketball", icon: "🏀" },
  { id: "tennis", slug: "tennis", name: "Tennis", icon: "🎾" },
  { id: "cricket", slug: "cricket", name: "Cricket", icon: "🏏" },
  { id: "esports", slug: "esports", name: "Esports", icon: "🎮" },
];

function upcoming(hours: number) {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + hours);
  return date;
}

function makeGame(
  id: string,
  homeName: string,
  awayName: string,
  league: string,
  hours: number,
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
): FeedGame {
  return {
    id,
    isApiMatch: true,
    homeName,
    awayName,
    homeLogo: null,
    awayLogo: null,
    startAt: upcoming(hours),
    status: "SCHEDULED",
    homeScore: 0,
    awayScore: 0,
    period: null,
    clock: null,
    live: false,
    featured: hours <= 3,
    sport: { name: "Football", slug: "football", icon: "⚽" },
    competitionName: league,
    markets: [
      {
        id: `${id}-match-result`,
        name: "Match Result",
        key: "MATCH_RESULT",
        status: "OPEN",
        outcomes: [
          { id: `${id}-home`, name: homeName, label: "1", odds: homeOdds, status: "ACTIVE" },
          { id: `${id}-draw`, name: "Draw", label: "X", odds: drawOdds, status: "ACTIVE" },
          { id: `${id}-away`, name: awayName, label: "2", odds: awayOdds, status: "ACTIVE" },
        ],
      },
    ],
  };
}

const featuredGames: FeedGame[] = [
  makeGame("ars-che", "Arsenal", "Chelsea", "England - Premier League", 2, 1.72, 3.75, 4.6),
  makeGame("bar-sev", "Barcelona", "Sevilla", "Spain - La Liga", 4, 1.44, 4.8, 6.5),
  makeGame("bvb-bay", "Dortmund", "Bayern Munich", "Germany - Bundesliga", 7, 2.55, 3.65, 2.3),
  makeGame("int-juv", "Inter Milan", "Juventus", "Italy - Serie A", 10, 1.9, 3.4, 4.1),
];

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-panel-bg">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-[#052e16]">U</span>
            <span className="text-lg font-extrabold tracking-tight">UNIBET360</span>
          </div>
          <p className="mt-3 text-sm text-ink3">Fast odds, live betting, instant crypto deposits.</p>
        </div>
        <FooterColumn title="Betting" links={["Sports", "Live Betting", "Promotions", "Results"]} />
        <FooterColumn title="Account" links={["My Account", "Deposit", "Withdraw", "Register"]} />
        <FooterColumn title="Support" links={["Responsible Gambling", "Terms & Conditions", "Help Centre"]} />
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-ink3">
        18+ · Play responsibly. Only for adults of legal age. © {new Date().getFullYear()} UNIBET360
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-ink">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-ink3">
        {links.map((label) => (
          <li key={label}>
            <a href={label === "Sports" ? "/sports" : "#"} className="transition-colors hover:text-ink">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Home() {
  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <MatchSlideshow games={featuredGames} />
      <MatchFeed games={featuredGames} sports={sports} autoFetch={false} />

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Popular Sports</h2>
          <a href="/sports" className="text-sm font-semibold text-brand hover:underline">All sports →</a>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {sports.map((sport) => (
            <a key={sport.id} href={`/sports/${sport.slug}`} className="card card-hover flex flex-col items-center gap-2 px-3 py-5 text-center">
              <SportIcon slug={sport.slug} icon={sport.icon} className="h-8 w-8 text-brand" />
              <span className="text-sm font-semibold">{sport.name}</span>
              <span className="text-[11px] text-ink3">View markets</span>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <PromoCard icon={<IconGift className="h-5 w-5" />} title="20% cashback" body="Get more from every deposit with our weekly cashback offer." />
        <PromoCard icon={<IconLightning className="h-5 w-5" />} title="Fast payouts" body="Simple deposits and quick withdrawals in your preferred currency." />
        <PromoCard icon={<IconShield className="h-5 w-5" />} title="Play responsibly" body="Set limits, self-exclude, or get help whenever you need it." />
      </section>
    </div>
  );
}

function PromoCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="card flex gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">{icon}</span>
      <div>
        <h3 className="font-bold">{title}</h3>
        <p className="mt-1 text-sm text-ink2">{body}</p>
      </div>
    </div>
  );
}

function SportsPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Explore</p>
      <h1 className="mt-2 text-3xl font-black">All sports</h1>
      <p className="mt-2 max-w-xl text-ink2">Browse today&apos;s fixtures and find your next selection.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sports.map((sport) => (
          <a key={sport.id} href={`/sports/${sport.slug}`} className="card card-hover flex items-center gap-4 p-5">
            <SportIcon slug={sport.slug} icon={sport.icon} className="h-10 w-10 text-brand" />
            <span className="text-lg font-bold">{sport.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function SportPage({ params }: { params: { slug: string } }) {
  const sport = sports.find((item) => item.slug === params.slug) ?? sports[0];
  const games = featuredGames.map((game) => ({ ...game, sport: { ...game.sport, slug: sport.slug, name: sport.name, icon: sport.icon } }));
  return (
    <div className="mx-auto max-w-[1600px] px-4">
      <MatchFeed games={games} sports={sports} autoFetch={false} sportHeader={{ name: sport.name, slug: sport.slug, icon: sport.icon }} />
    </div>
  );
}

function SimplePage({ title, eyebrow, body }: { title: string; eyebrow: string; body: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h1 className="mt-3 text-4xl font-black">{title}</h1>
      <p className="mt-4 text-lg leading-8 text-ink2">{body}</p>
      <div className="mt-8 card p-6">
        <div className="flex items-center gap-3 text-brand">
          <IconTrophy className="h-6 w-6" />
          <span className="font-bold">Your next great moment starts here</span>
        </div>
        <p className="mt-3 text-sm text-ink3">Sign in or create an account to unlock your wallet, betslip, promotions, and personalised betting history.</p>
        <div className="mt-5 flex gap-3">
          <a href="/register" className="btn btn-primary">Create account</a>
          <a href="/sports" className="btn btn-ghost">Browse sports</a>
        </div>
      </div>
    </div>
  );
}

function RouteSurface() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sports" component={SportsPage} />
        <Route path="/sports/:slug" component={SportPage} />
        <Route path="/live" component={() => <SimplePage title="Live betting" eyebrow="In play" body="Follow the action as it happens and keep every live market close at hand." />} />
        <Route path="/promotions" component={() => <SimplePage title="Promotions" eyebrow="More value" body="Discover deposit bonuses, cashback, and special offers built for VoltBet players." />} />
        <Route path="/results" component={() => <SimplePage title="Results" eyebrow="Match centre" body="Review completed fixtures and follow the results that matter to you." />} />
        <Route path="/search" component={() => <SimplePage title="Search" eyebrow="Find a match" body="Search teams, leagues, and fixtures to get straight to the markets you want." />} />
        <Route path="/login" component={() => <SimplePage title="Welcome back" eyebrow="Account" body="Sign in to manage your bets, wallet, and preferences in one place." />} />
        <Route path="/register" component={() => <SimplePage title="Join VoltBet" eyebrow="Get started" body="Create your account and start exploring today&apos;s best odds." />} />
        <Route path="/account/:rest*" component={() => <SimplePage title="Your account" eyebrow="Account" body="Manage your profile, bets, deposits, withdrawals, and preferences." />} />
        <Route path="/account" component={() => <SimplePage title="Your account" eyebrow="Account" body="Manage your profile, bets, deposits, withdrawals, and preferences." />} />
        <Route path="/casino" component={() => <SimplePage title="Casino" eyebrow="Coming soon" body="A new way to play is on its way. Keep an eye out for the VoltBet casino experience." />} />
        <Route path="/responsible-gambling" component={() => <SimplePage title="Play responsibly" eyebrow="Your wellbeing" body="Set deposit limits, take a break, or find support. Betting should always stay fun and within your control." />} />
        <Route path="/terms" component={() => <SimplePage title="Terms & conditions" eyebrow="Legal" body="Please review the rules and conditions that apply when using VoltBet." />} />
        <Route path="/admin/:rest*" component={() => <SimplePage title="Admin workspace" eyebrow="Operations" body="Manage games, users, payments, promotions, and platform settings from the operator workspace." />} />
        <Route component={() => <SimplePage title="Page not found" eyebrow="404" body="The page you requested is not available, but the latest fixtures are ready whenever you are." />} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function AppShell() {
  return (
    <div className="min-h-screen bg-panel-bg">
      <UNIBET360SplashLoader />
      <BroadcastBanner />
      <Header user={null} siteName="UNIBET360" sports={sports} />
      <main className="min-h-[60vh] pb-32 xl:pb-0">
        <RouteSurface />
      </main>
      <Footer />
      <MobileNav loggedIn={false} liveCount={0} />
      <SupportWidget
        isStaff={false}
        support={{ phone: "+254 700 000000", whatsappEnabled: false, whatsapp: "", telegramEnabled: false, telegram: "" }}
      />
      <BetSlip />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <I18nSync />
          <CurrencyProvider>
            <ToastProvider>
              <BetSlipProvider>
                <DrawerProvider
                  isStaff={false}
                  support={{ whatsappEnabled: false, whatsapp: "", telegramEnabled: false, telegram: "" }}
                >
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <AppShell />
                  </WouterRouter>
                </DrawerProvider>
              </BetSlipProvider>
            </ToastProvider>
          </CurrencyProvider>
        </ThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;