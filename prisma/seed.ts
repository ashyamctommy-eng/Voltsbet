/**
 * VoltBet seed script — run with: pnpm prisma db seed
 * Creates demo admin + customers, full sports catalogue, games, markets,
 * status engine, currencies, languages, content and settings.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { resources } from "../src/lib/i18n-resources";
import { randomBytes } from "crypto";
import { teamLogo } from "../src/lib/team-logos";

const prisma = new PrismaClient();

const D = (n: number) => new Date(Date.now() + n * 86400_000);
const H = (n: number) => new Date(Date.now() + n * 3600_000);
const dec = (n: string | number) => n.toString();

async function main() {
  console.log("Seeding VoltBet...");

  // ── Idempotency: clear seed-owned dynamic records ───────────
  // Seed games are all source=MANUAL; removing them keeps reseeds clean.
  await prisma.betSelection.deleteMany({ where: { game: { source: "MANUAL" } } });
  await prisma.game.deleteMany({ where: { source: "MANUAL" } });
  const demoUser = await prisma.user.findUnique({ where: { email: "demo@voltbet.test" } });
  if (demoUser) {
    // Remove ALL demo-user activity (bets, txns, deposits, withdrawals, notifications)
    // and reset the wallet to the seed balance — reseeds must be fully reproducible.
    await prisma.bet.deleteMany({ where: { userId: demoUser.id } });
    await prisma.transaction.deleteMany({ where: { userId: demoUser.id } });
    await prisma.deposit.deleteMany({ where: { userId: demoUser.id } });
    await prisma.withdrawal.deleteMany({ where: { userId: demoUser.id } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: demoUser.id }, { userId: null }] } });
    await prisma.wallet.updateMany({ where: { userId: demoUser.id }, data: { balance: dec("24800"), bonusBalance: "0" } });
  }
  for (const uid of ["pending@voltbet.test", "suspended@voltbet.test"]) {
    const u = await prisma.user.findUnique({ where: { email: uid } });
    if (u) {
      await prisma.deposit.deleteMany({ where: { userId: u.id } });
      await prisma.wallet.updateMany({ where: { userId: u.id }, data: { balance: uid.startsWith("pending") ? "0" : "5000", bonusBalance: "0" } });
    }
  }
  await prisma.auditLog.deleteMany({ where: { action: "SEED" } });

  // ── Currencies ──────────────────────────────────────────────
  const currencies = [
    { code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimals: 2, rate: "1", def: true },
    { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, rate: "129" },
    { code: "EUR", name: "Euro", symbol: "€", decimals: 2, rate: "141" },
    { code: "GBP", name: "British Pound", symbol: "£", decimals: 2, rate: "165" },
    { code: "UGX", name: "Ugandan Shilling", symbol: "USh", decimals: 0, rate: "0.033" },
    { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", decimals: 0, rate: "0.048" },
    { code: "NGN", name: "Nigerian Naira", symbol: "₦", decimals: 2, rate: "0.081" },
    { code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵", decimals: 2, rate: "9.9" },
    { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2, rate: "7.1" },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {},
      create: {
        code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals,
        rate: dec(c.rate), isDefault: !!c.def, active: true,
      },
    });
  }

  // ── Languages ───────────────────────────────────────────────
  const langs = [
    { code: "en", name: "English", def: true },
    { code: "sw", name: "Kiswahili" },
    { code: "fr", name: "Français" },
    { code: "de", name: "Deutsch" },
    { code: "es", name: "Español" },
    { code: "pt", name: "Português" },
    { code: "nl", name: "Nederlands" },
    { code: "it", name: "Italiano" },
    { code: "ro", name: "Română" },
    { code: "mt", name: "Malti" },
  ];
  for (const [i, l] of langs.entries()) {
    await prisma.language.upsert({
      where: { code: l.code },
      update: {},
      create: { code: l.code, name: l.name, isDefault: !!l.def, active: true, sortOrder: i },
    });
  }

  const t = (lang: string, key: string, value: string) =>
    prisma.translation.upsert({
      where: { langCode_key: { langCode: lang, key } },
      update: {},
      create: { langCode: lang, key, value },
    });

  const enKeys: [string, string][] = [
    ["nav.home", "Home"], ["nav.sports", "Sports"], ["nav.live", "Live"],
    ["nav.promotions", "Promotions"], ["nav.results", "Results"], ["nav.login", "Log In"],
    ["nav.register", "Register"], ["nav.my_bets", "My Bets"], ["nav.deposit", "Deposit"],
    ["nav.withdraw", "Withdraw"], ["nav.balance", "Balance"], ["nav.account", "Account"],
    ["nav.logout", "Logout"], ["nav.search", "Search"],
    ["betslip.title", "Bet Slip"], ["betslip.singles", "Singles"], ["betslip.accumulator", "Accumulator"],
    ["betslip.stake", "Stake"], ["betslip.total_odds", "Total Odds"], ["betslip.potential_win", "Potential Win"],
    ["betslip.place_bet", "Place Bet"], ["betslip.empty", "Your bet slip is empty. Tap on odds to add selections."],
    ["common.search", "Search teams, matches, competitions..."], ["common.logout", "Logout"],
  ];
  for (const [k, v] of enKeys) await t("en", k, v);

  const swKeys: [string, string][] = [
    ["nav.home", "Nyumbani"], ["nav.sports", "Michezo"], ["nav.live", "Moja kwa moja"],
    ["nav.promotions", "Matangazo"], ["nav.results", "Matokeo"], ["nav.login", "Ingia"],
    ["nav.register", "Jisajili"], ["nav.my_bets", "Dau Zangu"], ["nav.deposit", "Weka pesa"],
    ["nav.withdraw", "Toa pesa"], ["nav.balance", "Salio"], ["nav.account", "Akaunti"],
    ["nav.logout", "Toka"], ["nav.search", "Tafuta"],
    ["betslip.title", "Dau"], ["betslip.place_bet", "Weka Dau"], ["betslip.stake", "Kiasi"],
    ["betslip.total_odds", "Jumla ya Odds"], ["betslip.potential_win", "Ushindi Unaowezekana"],
    ["common.search", "Tafuta timu, mechi, mashindano..."],
  ];
  for (const [k, v] of swKeys) await t("sw", k, v);

  const frKeys: [string, string][] = [
    ["nav.home", "Accueil"], ["nav.sports", "Sports"], ["nav.live", "Direct"],
    ["nav.promotions", "Promotions"], ["nav.results", "Résultats"], ["nav.login", "Connexion"],
    ["nav.register", "S'inscrire"], ["nav.my_bets", "Mes Paris"], ["nav.deposit", "Dépôt"],
    ["nav.withdraw", "Retrait"], ["nav.balance", "Solde"], ["nav.account", "Compte"],
    ["nav.logout", "Déconnexion"], ["nav.search", "Rechercher"],
    ["betslip.title", "Ticket de pari"], ["betslip.place_bet", "Parier"], ["betslip.stake", "Mise"],
    ["betslip.total_odds", "Cote totale"], ["betslip.potential_win", "Gain potentiel"],
    ["common.search", "Rechercher équipes, matchs, compétitions..."],
  ];
  for (const [k, v] of frKeys) await t("fr", k, v);

  const deKeys: [string, string][] = [
    ["nav.home", "Startseite"], ["nav.sports", "Sport"], ["nav.live", "Live"],
    ["nav.promotions", "Aktionen"], ["nav.results", "Ergebnisse"], ["nav.login", "Anmelden"],
    ["nav.register", "Registrieren"], ["nav.my_bets", "Meine Wetten"], ["nav.deposit", "Einzahlen"],
    ["nav.withdraw", "Auszahlen"], ["nav.balance", "Guthaben"], ["nav.account", "Konto"],
    ["nav.logout", "Abmelden"], ["nav.search", "Suchen"],
    ["betslip.title", "Wettschein"], ["betslip.place_bet", "Wette platzieren"], ["betslip.stake", "Einsatz"],
    ["betslip.total_odds", "Gesamtquote"], ["betslip.potential_win", "Möglicher Gewinn"],
    ["common.search", "Teams, Spiele, Wettbewerbe suchen..."],
  ];
  for (const [k, v] of deKeys) await t("de", k, v);

  // ── Status engine ───────────────────────────────────────────
  const statuses: [string, string, string, string, string[] | null, string[] | null][] = [
    // type, key, name, color, allowed, blocked
    ["USER", "ACTIVE", "Active", "#16a34a", ["bet", "deposit", "withdraw"], null],
    ["USER", "PENDING_VERIFICATION", "Pending Verification", "#d97706", ["deposit"], ["bet", "withdraw"]],
    ["USER", "SUSPENDED", "Suspended", "#dc2626", null, ["bet", "deposit", "withdraw"]],
    ["USER", "SELF_EXCLUDED", "Self-Excluded", "#7c3aed", null, ["bet", "deposit", "withdraw"]],
    ["BET", "OPEN", "Open", "#2563eb", null, null],
    ["BET", "WON", "Won", "#16a34a", null, null],
    ["BET", "LOST", "Lost", "#dc2626", null, null],
    ["BET", "VOID", "Void", "#6b7280", null, null],
    ["GAME", "SCHEDULED", "Scheduled", "#2563eb", null, null],
    ["GAME", "LIVE", "Live", "#dc2626", null, null],
    ["GAME", "HALF_TIME", "Half Time", "#d97706", null, null],
    ["GAME", "SUSPENDED", "Suspended", "#6b7280", null, null],
    ["GAME", "POSTPONED", "Postponed", "#6b7280", null, null],
    ["GAME", "FINISHED", "Finished", "#16a34a", null, null],
    ["GAME", "CANCELLED", "Cancelled", "#dc2626", null, null],
    ["MARKET", "OPEN", "Open", "#16a34a", null, null],
    ["MARKET", "SUSPENDED", "Suspended", "#6b7280", null, null],
    ["MARKET", "CLOSED", "Closed", "#d97706", null, null],
    ["MARKET", "SETTLED", "Settled", "#2563eb", null, null],
    ["DEPOSIT", "PAYMENT_CREATED", "Payment Created", "#6b7280", null, null],
    ["DEPOSIT", "AWAITING_PAYMENT", "Awaiting Payment", "#d97706", null, null],
    ["DEPOSIT", "PAYMENT_DETECTED", "Payment Detected", "#2563eb", null, null],
    ["DEPOSIT", "CONFIRMING", "Confirming", "#7c3aed", null, null],
    ["DEPOSIT", "CONFIRMED", "Confirmed", "#0ea5e9", null, null],
    ["DEPOSIT", "COMPLETED", "Completed", "#16a34a", null, null],
    ["DEPOSIT", "EXPIRED", "Expired", "#6b7280", null, null],
    ["DEPOSIT", "FAILED", "Failed", "#dc2626", null, null],
    ["DEPOSIT", "CANCELLED", "Cancelled", "#6b7280", null, null],
    ["WITHDRAWAL", "PENDING", "Pending", "#d97706", null, null],
    ["WITHDRAWAL", "VERIFICATION_REQUIRED", "Verification Required", "#7c3aed", null, null],
    ["WITHDRAWAL", "PROCESSING", "Processing", "#2563eb", null, null],
    ["WITHDRAWAL", "COMPLETED", "Completed", "#16a34a", null, null],
    ["WITHDRAWAL", "REJECTED", "Rejected", "#dc2626", null, null],
    ["WITHDRAWAL", "CANCELLED", "Cancelled", "#6b7280", null, null],
    ["WITHDRAWAL", "FAILED", "Failed", "#dc2626", null, null],
    ["PAYMENT", "PENDING", "Payment Pending", "#d97706", null, null],
    ["PAYMENT", "RECEIVED", "Payment Received", "#2563eb", null, null],
    ["PAYMENT", "PENDING_VERIFICATION", "Pending Verification", "#7c3aed", null, null],
    ["PAYMENT", "PENDING_PROCESSING", "Pending Processing", "#0ea5e9", null, null],
    ["PAYMENT", "PROCESSING", "Processing", "#2563eb", null, null],
    ["PAYMENT", "COMPLETED", "Completed", "#16a34a", null, null],
    ["PAYMENT", "REJECTED", "Rejected", "#dc2626", null, null],
    ["PAYMENT", "CANCELLED", "Cancelled", "#6b7280", null, null],
    ["PAYMENT", "FAILED", "Failed", "#dc2626", null, null],
  ];
  for (const [type, key, name, color, allowed, blocked] of statuses) {
    await prisma.statusType.upsert({
      where: { type_key: { type, key } },
      update: {},
      create: {
        type, key, name, color,
        allowedActions: allowed ? JSON.stringify(allowed) : null,
        blockedActions: blocked ? JSON.stringify(blocked) : null,
      },
    });
  }

  // ── Settings ────────────────────────────────────────────────
  const settings: [string, unknown][] = [
    ["site.name", "VoltBet"],
    ["site.tagline", "Live the rush"],
    ["branding.primaryColor", "#00e676"],
    ["branding.secondaryColor", "#0b1220"],
    ["branding.accentColor", "#7c3aed"],
    ["betting.minStake", "50"],
    ["betting.maxStake", "100000"],
    ["betting.maxPayout", "2000000"],
    ["support.whatsapp", "+254700000000"],
    ["support.whatsappMessage", "Hello VoltBet! I need help."],
    ["support.whatsappEnabled", "true"],
    ["support.whatsappPosition", "bottom-right"],
    ["support.telegram", "https://t.me/voltbet_community"],
    ["support.telegramText", "Join Our Telegram Group"],
    ["support.telegramEnabled", "true"],
    ["support.telegramPosition", "bottom-left"],
    ["support.email", "support@voltbet.test"],
    ["crypto.provider", "NOWPAYMENTS"],
    ["crypto.apiKey", ""],
    ["crypto.ipnSecret", ""],
    ["crypto.payoutApiKey", ""],
    ["crypto.minDeposit", "500"],
    ["crypto.maxDeposit", "500000"],
    ["crypto.confirmations", "1"],
    ["crypto.expirationMinutes", "30"],
    ["crypto.currencies", JSON.stringify(["BTC", "ETH", "USDT", "USDC"])],
    ["crypto.rates", JSON.stringify({ BTC: 8500000, ETH: 430000, USDT: 129, USDC: 129 })],
    ["mpesa.enabled", "false"],
    ["mpesa.env", "sandbox"],
    ["mpesa.consumerKey", ""],
    ["mpesa.consumerSecret", ""],
    ["mpesa.passkey", ""],
    ["mpesa.shortcode", ""],
    ["mpesa.initiatorName", ""],
    ["mpesa.securityCredential", ""],
    ["mpesa.callbackSecret", randomBytes(16).toString("hex")],
    ["app.url", ""],
    ["home.heroTitle", "Bet on the games you love"],
    ["home.heroSubtitle", "Fast odds, instant crypto deposits, live betting."],
  ];
  for (const [k, v] of settings) {
    await prisma.setting.upsert({
      where: { key: k },
      update: {},
      create: { key: k, value: typeof v === "string" ? v : JSON.stringify(v) },
    });
  }

  // ── Users + wallets ─────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@voltbet.test" },
    update: {},
    create: {
      fullName: "VoltBet Admin", username: "admin", email: "admin@voltbet.test",
      phone: "+254700000001", passwordHash: await bcrypt.hash("Admin123!", 10),
      role: "SUPER_ADMIN", status: "ACTIVE", verified: true, country: "KE",
      referralCode: "VOLT-ADMIN",
    },
  });
  const demo = await prisma.user.upsert({
    where: { email: "demo@voltbet.test" },
    update: {},
    create: {
      fullName: "Demo Player", username: "demo", email: "demo@voltbet.test",
      phone: "+254700000002", passwordHash: await bcrypt.hash("Demo123!", 10),
      role: "CUSTOMER", status: "ACTIVE", verified: true, country: "KE",
      currencyCode: "KES", referralCode: "VOLT-DEMO",
    },
  });
  const pending = await prisma.user.upsert({
    where: { email: "pending@voltbet.test" },
    update: {},
    create: {
      fullName: "Pending User", username: "pendinguser", email: "pending@voltbet.test",
      phone: "+254700000003", passwordHash: await bcrypt.hash("Demo123!", 10),
      role: "CUSTOMER", status: "PENDING_VERIFICATION", verified: false, country: "KE",
      currencyCode: "KES",
    },
  });
  const suspended = await prisma.user.upsert({
    where: { email: "suspended@voltbet.test" },
    update: {},
    create: {
      fullName: "Suspended User", username: "suspendeduser", email: "suspended@voltbet.test",
      phone: "+254700000004", passwordHash: await bcrypt.hash("Demo123!", 10),
      role: "CUSTOMER", status: "SUSPENDED", verified: true, country: "KE",
      currencyCode: "KES",
    },
  });

  await prisma.wallet.upsert({
    where: { userId: demo.id }, update: {},
    create: { userId: demo.id, balance: dec("24800"), currencyCode: "KES" },
  });
  await prisma.wallet.upsert({
    where: { userId: pending.id }, update: {},
    create: { userId: pending.id, balance: dec("0"), currencyCode: "KES" },
  });
  await prisma.wallet.upsert({
    where: { userId: suspended.id }, update: {},
    create: { userId: suspended.id, balance: dec("5000"), currencyCode: "KES" },
  });

  // ── Sports ──────────────────────────────────────────────────
  const sports: [string, string, string, boolean][] = [
    ["Football", "football", "⚽", true],
    ["Basketball", "basketball", "🏀", true],
    ["Tennis", "tennis", "🎾", true],
    ["Volleyball", "volleyball", "🏐", false],
    ["Baseball", "baseball", "⚾", false],
    ["Ice Hockey", "ice-hockey", "🏒", false],
    ["Rugby", "rugby", "🏉", false],
    ["Handball", "handball", "🤾", false],
    ["Cricket", "cricket", "🏏", false],
    ["Esports", "esports", "🎮", true],
    ["Boxing", "boxing", "🥊", false],
    ["Golf", "golf", "⛳", false],
    ["Motorsport", "motorsport", "🏎️", false],
    ["Other Sports", "other", "⭐", false],
  ];
  const sportMap: Record<string, string> = {};
  for (const [i, [name, slug, icon, popular]] of sports.entries()) {
    const s = await prisma.sport.upsert({
      where: { slug }, update: {},
      create: { name, slug, icon, sortOrder: i, isPopular: popular },
    });
    sportMap[slug] = s.id;
  }

  // ── Competitions ────────────────────────────────────────────
  const comps: [string, string, string][] = [
    ["Premier League", "football", "England"],
    ["La Liga", "football", "Spain"],
    ["Serie A", "football", "Italy"],
    ["Bundesliga", "football", "Germany"],
    ["NBA", "basketball", "USA"],
    ["ATP Tour", "tennis", "World"],
    ["WTA Tour", "tennis", "World"],
    ["Volleyball Nations League", "volleyball", "World"],
    ["MLB", "baseball", "USA"],
    ["NHL", "ice-hockey", "Canada/USA"],
    ["The Rugby Championship", "rugby", "World"],
    ["EHF Champions League", "handball", "Europe"],
    ["T20 Internationals", "cricket", "World"],
    ["ESL Pro League (CS2)", "esports", "World"],
    ["Heavyweight Division", "boxing", "World"],
    ["PGA Tour", "golf", "World"],
    ["Formula 1", "motorsport", "World"],
    ["PDC World Darts", "other", "World"],
  ];
  const compMap: Record<string, string> = {};
  for (const [name, slug, country] of comps) {
    const c = await prisma.competition.create({
      data: { sportId: sportMap[slug], name, country },
    });
    compMap[name] = c.id;
  }

  // ── Teams (for search) ──────────────────────────────────────
  const teams = ["Manchester United", "Chelsea", "Arsenal", "Liverpool", "Manchester City",
    "Tottenham Hotspur", "Real Madrid", "Barcelona", "Bayern Munich", "Borussia Dortmund",
    "Inter Milan", "Juventus", "AC Milan", "Napoli", "LA Lakers", "Boston Celtics",
    "Golden State Warriors", "Milwaukee Bucks", "Denver Nuggets", "Miami Heat",
    "Carlos Alcaraz", "Jannik Sinner", "Naomi Osaka", "Iga Swiatek", "Novak Djokovic",
    "Daniil Medvedev", "New York Yankees", "Boston Red Sox", "Toronto Maple Leafs",
    "Montreal Canadiens", "New Zealand All Blacks", "South Africa Springboks"];
  for (const name of teams) {
    await prisma.team.create({ data: { name } });
  }

  // ── Games & markets ─────────────────────────────────────────
  type Mk = { key: string; name: string; outcomes: [string, string, string][] }; // [name, label, odds]

  const footballMarkets = (h: string, a: string): Mk[] => [
    { key: "MATCH_RESULT", name: "Match Result", outcomes: [[h, "1", "2.10"], ["Draw", "X", "3.40"], [a, "2", "3.20"]] },
    { key: "DOUBLE_CHANCE", name: "Double Chance", outcomes: [["1X", "1X", "1.30"], ["X2", "X2", "1.62"], ["12", "12", "1.25"]] },
    { key: "OVER_UNDER", name: "Over/Under 2.5", outcomes: [["Over 2.5", "Over", "1.85"], ["Under 2.5", "Under", "1.95"]] },
    { key: "BTTS", name: "Both Teams To Score", outcomes: [["Yes", "Yes", "1.75"], ["No", "No", "2.05"]] },
    { key: "HT_RESULT", name: "Half-Time Result", outcomes: [[h, "1", "2.60"], ["Draw", "X", "2.10"], [a, "2", "3.10"]] },
    { key: "DRAW_NO_BET", name: "Draw No Bet", outcomes: [[h, "1", "1.55"], [a, "2", "2.35"]] },
    { key: "CORRECT_SCORE", name: "Correct Score", outcomes: [["1-0", "", "7.50"], ["2-0", "", "9.00"], ["2-1", "", "9.50"], ["0-0", "", "8.50"], ["1-1", "", "6.50"], ["0-1", "", "9.00"]] },
  ];
  const basketMarkets = (h: string, a: string): Mk[] => [
    { key: "MATCH_RESULT", name: "Match Winner", outcomes: [[h, "1", "1.90"], [a, "2", "1.90"]] },
    { key: "OVER_UNDER", name: "Over/Under 220.5", outcomes: [["Over 220.5", "Over", "1.90"], ["Under 220.5", "Under", "1.90"]] },
    { key: "HANDICAP", name: "Handicap", outcomes: [[`${h} -4.5`, "H", "1.95"], [`${a} +4.5`, "A", "1.85"]] },
  ];
  const tennisMarkets = (p1: string, p2: string, total?: string): Mk[] => [
    { key: "MATCH_RESULT", name: "Match Winner", outcomes: [[p1, "1", "1.72"], [p2, "2", "2.10"]] },
    { key: "OVER_UNDER", name: `Total Games ${total ?? "22.5"}`, outcomes: [[`Over ${total ?? "22.5"}`, "Over", "1.85"], [`Under ${total ?? "22.5"}`, "Under", "1.95"]] },
  ];
  const genericWinner = (h: string, a: string): Mk[] => [
    { key: "MATCH_RESULT", name: "Match Winner", outcomes: [[h, "1", "1.80"], [a, "2", "2.00"]] },
  ];

  async function addGame(opts: {
    sport: string; comp?: string; home: string; away: string; start: Date;
    featured?: boolean; live?: boolean; status?: string; hs?: number; as?: number;
    period?: string; clock?: string; markets: Mk[]; suspendedMarkets?: string[];
    suspendedOutcomes?: string[];
  }) {
    const game = await prisma.game.create({
      data: {
        sportId: sportMap[opts.sport],
        competitionId: opts.comp ? compMap[opts.comp] : null,
        competitionName: opts.comp,
        homeName: opts.home, awayName: opts.away,
        homeLogo: teamLogo(opts.home), awayLogo: teamLogo(opts.away),
        startAt: opts.start, featured: opts.featured ?? false, live: opts.live ?? false,
        status: opts.status ?? "SCHEDULED",
        homeScore: opts.hs ?? 0, awayScore: opts.as ?? 0,
        period: opts.period, clock: opts.clock,
      },
    });
    for (const [i, m] of opts.markets.entries()) {
      const market = await prisma.market.create({
        data: {
          gameId: game.id, name: m.name, key: m.key,
          status: opts.suspendedMarkets?.includes(m.name) ? "SUSPENDED" : "OPEN",
          sortOrder: i,
        },
      });
      for (const [j, [name, label, odds]] of m.outcomes.entries()) {
        await prisma.outcome.create({
          data: {
            marketId: market.id, name, label, odds: dec(odds), sortOrder: j,
            status: opts.suspendedOutcomes?.includes(name) ? "SUSPENDED" : "ACTIVE",
          },
        });
      }
    }
    return game;
  }

  const g1 = await addGame({
    sport: "football", comp: "Premier League", home: "Manchester United", away: "Chelsea",
    start: D(2), featured: true, markets: footballMarkets("Manchester United", "Chelsea"),
  });
  const g2 = await addGame({
    sport: "football", comp: "Premier League", home: "Arsenal", away: "Liverpool",
    start: D(1), markets: footballMarkets("Arsenal", "Liverpool"),
  });
  const g3 = await addGame({
    sport: "football", comp: "La Liga", home: "Real Madrid", away: "Barcelona",
    start: D(3), featured: true, markets: footballMarkets("Real Madrid", "Barcelona"),
  });
  const g4 = await addGame({
    sport: "football", comp: "Bundesliga", home: "Bayern Munich", away: "Borussia Dortmund",
    start: D(2), markets: footballMarkets("Bayern Munich", "Borussia Dortmund"),
  });
  const g5 = await addGame({
    sport: "football", comp: "Serie A", home: "Inter Milan", away: "Juventus",
    start: H(-1), live: true, status: "LIVE", hs: 2, as: 1, period: "2H", clock: "67:42",
    featured: true, markets: footballMarkets("Inter Milan", "Juventus"),
    suspendedMarkets: ["Correct Score"],
  });
  const g6 = await addGame({
    sport: "football", comp: "Serie A", home: "AC Milan", away: "Napoli",
    start: D(4), status: "POSTPONED", markets: footballMarkets("AC Milan", "Napoli"),
  });
  const g7 = await addGame({
    sport: "football", comp: "Premier League", home: "Manchester City", away: "Tottenham Hotspur",
    start: H(-26), status: "FINISHED", hs: 1, as: 0,
    markets: footballMarkets("Manchester City", "Tottenham Hotspur"),
  });
  const g8 = await addGame({
    sport: "basketball", comp: "NBA", home: "LA Lakers", away: "Boston Celtics",
    start: D(1), featured: true, markets: basketMarkets("LA Lakers", "Boston Celtics"),
  });
  const g9 = await addGame({
    sport: "basketball", comp: "NBA", home: "Golden State Warriors", away: "Milwaukee Bucks",
    start: D(2), markets: basketMarkets("Golden State Warriors", "Milwaukee Bucks"),
  });
  const g10 = await addGame({
    sport: "basketball", comp: "NBA", home: "Denver Nuggets", away: "Miami Heat",
    start: H(-1), live: true, status: "LIVE", hs: 98, as: 94, period: "Q4", clock: "08:12",
    markets: basketMarkets("Denver Nuggets", "Miami Heat"),
  });
  const g11 = await addGame({
    sport: "tennis", comp: "ATP Tour", home: "Carlos Alcaraz", away: "Jannik Sinner",
    start: D(1), featured: true, markets: tennisMarkets("Carlos Alcaraz", "Jannik Sinner"),
  });
  const g12 = await addGame({
    sport: "tennis", comp: "WTA Tour", home: "Naomi Osaka", away: "Iga Swiatek",
    start: D(2), markets: tennisMarkets("Naomi Osaka", "Iga Swiatek"),
  });
  const g13 = await addGame({
    sport: "tennis", comp: "ATP Tour", home: "Novak Djokovic", away: "Daniil Medvedev",
    start: H(-2), live: true, status: "LIVE", hs: 2, as: 1, period: "Set 4", clock: "03:12",
    markets: tennisMarkets("Novak Djokovic", "Daniil Medvedev", "34.5"),
  });
  const g14 = await addGame({
    sport: "volleyball", comp: "Volleyball Nations League", home: "Brazil", away: "Italy",
    start: D(1), markets: genericWinner("Brazil", "Italy"),
  });
  const g15 = await addGame({
    sport: "baseball", comp: "MLB", home: "New York Yankees", away: "Boston Red Sox",
    start: D(2), markets: genericWinner("New York Yankees", "Boston Red Sox"),
  });
  const g16 = await addGame({
    sport: "ice-hockey", comp: "NHL", home: "Toronto Maple Leafs", away: "Montreal Canadiens",
    start: D(1), markets: genericWinner("Toronto Maple Leafs", "Montreal Canadiens"),
  });
  const g17 = await addGame({
    sport: "rugby", comp: "The Rugby Championship", home: "New Zealand All Blacks", away: "South Africa Springboks",
    start: D(3), markets: genericWinner("New Zealand All Blacks", "South Africa Springboks"),
  });
  const g18 = await addGame({
    sport: "handball", comp: "EHF Champions League", home: "Denmark", away: "France",
    start: D(2), markets: genericWinner("Denmark", "France"),
  });
  const g19 = await addGame({
    sport: "cricket", comp: "T20 Internationals", home: "India", away: "Australia",
    start: D(1), markets: genericWinner("India", "Australia"),
  });
  const g20 = await addGame({
    sport: "esports", comp: "ESL Pro League (CS2)", home: "Fnatic", away: "G2 Esports",
    start: D(1), markets: genericWinner("Fnatic", "G2 Esports"),
  });
  const g21 = await addGame({
    sport: "boxing", comp: "Heavyweight Division", home: "Anthony Joshua", away: "Tyson Fury",
    start: D(5), markets: genericWinner("Anthony Joshua", "Tyson Fury"),
  });
  const g22 = await addGame({
    sport: "golf", comp: "PGA Tour", home: "Scottie Scheffler", away: "Jon Rahm",
    start: D(4), markets: genericWinner("Scottie Scheffler", "Jon Rahm"),
  });
  const g23 = await addGame({
    sport: "motorsport", comp: "Formula 1", home: "Max Verstappen", away: "Lando Norris",
    start: D(4), markets: genericWinner("Max Verstappen", "Lando Norris"),
  });
  const g24 = await addGame({
    sport: "other", comp: "PDC World Darts", home: "Luke Littler", away: "Luke Humphries",
    start: D(1), markets: genericWinner("Luke Littler", "Luke Humphries"),
  });

  // ── Settle the finished game (Man City vs Spurs 1-0) ────────
  const finished = await prisma.game.findUniqueOrThrow({ where: { id: g7.id }, include: { markets: { include: { outcomes: true } } } });
  for (const m of finished.markets) {
    for (const o of m.outcomes) {
      let result: string | null = null;
      if (m.key === "MATCH_RESULT" || m.key === "HT_RESULT") result = o.label === "1" ? "WON" : o.label === "2" ? "LOST" : "LOST";
      else if (m.key === "DOUBLE_CHANCE") result = (o.label === "1X" || o.label === "12") ? "WON" : "LOST";
      else if (m.key === "OVER_UNDER") result = (o.name === "Under 2.5" || o.name === "Under 1.5") ? "WON" : o.label === "Under" ? "WON" : "LOST";
      else if (m.key === "BTTS") result = o.label === "No" ? "WON" : "LOST";
      else if (m.key === "DRAW_NO_BET") result = o.label === "1" ? "WON" : "LOST";
      else if (m.key === "CORRECT_SCORE") result = o.name === "1-0" ? "WON" : "LOST";
      else result = o.label === "1" ? "WON" : "LOST";
      await prisma.outcome.update({
        where: { id: o.id },
        data: { settled: true, result, status: "ACTIVE" },
      });
    }
    await prisma.market.update({ where: { id: m.id }, data: { status: "SETTLED" } });
  }

  // ── Demo user betting history ───────────────────────────────
  // History: deposit +25000 → 25000; won single (MR Home @2.10, stake 1000) → 24000 → +2100 = 26100;
  // lost single (BTTS Yes @1.75, stake 500) → 25600; open multiple (stake 800, odds 4.25) → 24800.
  const mr = finished.markets.find((m) => m.key === "MATCH_RESULT")!;
  const homeOutcome = mr.outcomes.find((o) => o.label === "1")!;
  const btts = finished.markets.find((m) => m.key === "BTTS")!;
  const bttsYes = btts.outcomes.find((o) => o.label === "Yes")!;

  const wonBet = await prisma.bet.create({
    data: {
      code: "VB-DEMO1", userId: demo.id, type: "SINGLE", stake: dec("1000"),
      totalOdds: dec("2.10"), potentialWin: dec("2100"), status: "WON", settledAt: H(-26),
      selections: {
        create: [{
          gameId: g7.id, marketId: mr.id, outcomeId: homeOutcome.id,
          marketName: mr.name, outcomeName: homeOutcome.name, label: "1",
          oddsAtPlacement: dec("2.10"), result: "WON", settled: true,
        }],
      },
    },
  });
  const lostBet = await prisma.bet.create({
    data: {
      code: "VB-DEMO2", userId: demo.id, type: "SINGLE", stake: dec("500"),
      totalOdds: dec("1.75"), potentialWin: dec("875"), status: "LOST", settledAt: H(-26),
      selections: {
        create: [{
          gameId: g7.id, marketId: btts.id, outcomeId: bttsYes.id,
          marketName: btts.name, outcomeName: bttsYes.name, label: "Yes",
          oddsAtPlacement: dec("1.75"), result: "LOST", settled: true,
        }],
      },
    },
  });
  const openBet = await prisma.bet.create({
    data: {
      code: "VB-DEMO3", userId: demo.id, type: "MULTIPLE", stake: dec("800"),
      totalOdds: dec("4.25"), potentialWin: dec("3400"), status: "OPEN",
    },
  });
  await prisma.betSelection.createMany({
    data: [
      {
        betId: openBet.id, gameId: g2.id, marketId: (await prisma.market.findFirstOrThrow({ where: { gameId: g2.id, key: "MATCH_RESULT" } })).id,
        outcomeId: (await prisma.outcome.findFirstOrThrow({ where: { market: { gameId: g2.id, key: "MATCH_RESULT" }, label: "1" } })).id,
        marketName: "Match Result", outcomeName: "Arsenal", label: "1", oddsAtPlacement: dec("2.10"),
      },
      {
        betId: openBet.id, gameId: g8.id, marketId: (await prisma.market.findFirstOrThrow({ where: { gameId: g8.id, key: "MATCH_RESULT" } })).id,
        outcomeId: (await prisma.outcome.findFirstOrThrow({ where: { market: { gameId: g8.id, key: "MATCH_RESULT" }, label: "1" } })).id,
        marketName: "Match Winner", outcomeName: "LA Lakers", label: "1", oddsAtPlacement: dec("1.90"),
      },
    ],
  });

  // Transactions matching the history
  const txns: [string, string, string, string, string][] = [
    ["DEPOSIT", "25000", "0", "25000", "Crypto deposit USDT (manual seed)"],
    ["BET_STAKE", "-1000", "25000", "24000", `Bet stake ${wonBet.code}`],
    ["BET_WIN", "2100", "24000", "26100", `Bet won ${wonBet.code}`],
    ["BET_STAKE", "-500", "26100", "25600", `Bet stake ${lostBet.code}`],
    ["BET_STAKE", "-800", "25600", "24800", `Bet stake ${openBet.code}`],
  ];
  for (const [type, amount, prev, next, reason] of txns) {
    await prisma.transaction.create({
      data: {
        userId: demo.id, type, amount: dec(amount), currencyCode: "KES",
        prevBalance: dec(prev), newBalance: dec(next), reason,
        reference: type === "DEPOSIT" ? "SEED-DEP-1" : undefined,
      },
    });
  }

  // ── Deposits / withdrawals for finance demo ─────────────────
  await prisma.deposit.create({
    data: {
      userId: demo.id, provider: "NOWPAYMENTS", method: "CRYPTO", amount: dec("5000"),
      currencyCode: "KES", status: "COMPLETED", cryptoCurrency: "USDT", network: "TRC20",
      paymentAddress: "TSeededDemoAddress123", txHash: "0xseed0001", fiatValue: dec("5000"),
      exchangeRate: dec("129"), confirmedAt: H(-30),
    },
  });
  await prisma.deposit.create({
    data: {
      userId: pending.id, provider: "NOWPAYMENTS", method: "CRYPTO", amount: dec("2000"),
      currencyCode: "KES", status: "AWAITING_PAYMENT", cryptoCurrency: "BTC", network: "Bitcoin",
      paymentAddress: "bc1qseededaddress", expiresAt: H(0.4),
    },
  });
  await prisma.withdrawal.create({
    data: {
      userId: demo.id, amount: dec("2000"), currencyCode: "KES", method: "CRYPTO",
      destination: "TSeededDemoAddress123", status: "PENDING",
    },
  });

  // ── Content ─────────────────────────────────────────────────
  const banners = [
    { title: "Welcome to VoltBet", description: "100% first deposit bonus up to KSh 10,000", image: "", ctaText: "Claim Bonus", ctaUrl: "/register", sortOrder: 0 },
    { title: "El Clásico — Live", description: "Real Madrid vs Barcelona. Live betting available.", image: "", ctaText: "Bet Now", ctaUrl: `/match/${g3.id}`, sortOrder: 1 },
    { title: "Crypto Deposits", description: "Instant, secure deposits with BTC, ETH, USDT & more.", image: "", ctaText: "Deposit", ctaUrl: "/account/deposit", sortOrder: 2 },
  ];
  for (const b of banners) await prisma.banner.create({ data: b });

  const promos = [
    { title: "Welcome Bonus", description: "Get a 100% match on your first deposit, up to KSh 10,000.", bonusType: "WELCOME_BONUS", bonusValue: dec("10000"), terms: "Min deposit KSh 500. Wagering 5x. Valid for 30 days." },
    { title: "Weekly Acca Boost", description: "Boost your accumulator winnings by up to 25% every week.", bonusType: "ACCA_PROMO", bonusValue: dec("25"), terms: "4+ selections, odds 1.10+ each. Boost applied automatically." },
    { title: "Free Bet Friday", description: "Place 3 bets of KSh 500+ this week and get a KSh 500 free bet.", bonusType: "FREE_BET", bonusValue: dec("500"), terms: "Free bet expires 7 days after issue. Winnings paid, stake excluded." },
    { title: "Crypto Bonus", description: "Extra 10% on every crypto deposit above KSh 5,000.", bonusType: "DEPOSIT_BONUS", bonusValue: dec("10"), terms: "Applies to BTC, ETH, USDT deposits." },
  ];
  for (const [i, p] of promos.entries()) {
    await prisma.promotion.create({ data: { ...p, sortOrder: i, active: true, startAt: D(-2), endAt: D(60) } });
  }

  const testimonials = [
    { name: "Brian K.", rating: 5, text: "Fast odds updates and withdrawals to crypto in under an hour. Best sportsbook I've used.", status: "APPROVED", sortOrder: 0 },
    { name: "Amina W.", rating: 5, text: "The live betting experience is smooth even on my phone. Inter vs Juve was intense!", status: "APPROVED", sortOrder: 1 },
    { name: "Samuel O.", rating: 4, text: "Great odds on football and the accumulator boost is a nice touch.", status: "APPROVED", sortOrder: 2 },
    { name: "Grace N.", rating: 5, text: "Deposited with USDT and it credited instantly. Support on WhatsApp is quick.", status: "APPROVED", sortOrder: 3 },
  ];
  for (const t of testimonials) await prisma.testimonial.create({ data: t });

  // ── Notifications ───────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { userId: demo.id, title: "Welcome to VoltBet! 🎉", message: "Thanks for joining. Claim your 100% welcome bonus today.", type: "GENERAL" },
      { userId: demo.id, title: "Bet Won 🏆", message: "Your single on Manchester City to win (1-0) returned KSh 2,100.", type: "BET_RESULT" },
      { userId: demo.id, title: "Deposit Confirmed", message: "Your USDT deposit of KSh 5,000 was confirmed.", type: "DEPOSIT" },
      { userId: null, title: "Maintenance Notice", message: "Scheduled maintenance Sunday 04:00–05:00 EAT. Betting will pause briefly.", type: "ANNOUNCEMENT" },
    ],
  });

  // ── Audit log sample ────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      adminId: admin.id, adminName: "VoltBet Admin", action: "SEED",
      entity: "SYSTEM", newValue: JSON.stringify({ note: "Initial database seed" }),
    },
  });
  // ── Extended UI keys (market names + nav extras) from the client bundle ──
  // Keeps the admin panel dictionary in sync with the UI keys; existing
  // seeded values win (update: {}), missing keys are added. Idempotent.
  for (const lang of ["en", "sw", "fr", "pt", "es"]) {
    const bundle = (resources as Record<string, { translation: Record<string, string> }>)[lang]?.translation ?? {};
    for (const [key, value] of Object.entries(bundle)) {
      await t(lang, key, String(value));
    }
  }

  console.log("Seed complete ✅");
  console.log("  Admin login:  admin@voltbet.test / Admin123!");
  console.log("  Demo login:   demo@voltbet.test / Demo123!");
  console.log("  Pending user: pending@voltbet.test / Demo123! (betting locked)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
