/**
 * i18n — react-i18next singleton (client).
 *
 * Languages: en (English) · sw (Swahili) · fr (French) · pt (Portuguese) ·
 * es (Spanish). The user's choice persists in localStorage under
 * `user_selected_lang` and auto-loads on the next visit.
 */
"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const LANG_KEY = "user_selected_lang";
export const LANGUAGES = [
  { code: "en", label: "EN", name: "English" },
  { code: "sw", label: "SW", name: "Kiswahili" },
  { code: "fr", label: "FR", name: "Français" },
  { code: "pt", label: "PT", name: "Português" },
  { code: "es", label: "ES", name: "Español" },
] as const;
export type LangCode = (typeof LANGUAGES)[number]["code"];

/** Read the persisted language (guarded — runs on the client only). */
export function getStoredLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v && LANGUAGES.some((l) => l.code === v) ? v : "en";
  } catch {
    return "en";
  }
}

export function changeLanguage(lang: string): void {
  void i18n.changeLanguage(lang);
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode — ignore */
  }
}

const resources = {
  en: {
    translation: {
      "nav.home": "Home",
      "nav.sports": "Sports",
      "nav.live": "Live",
      "nav.search": "Search",
      "nav.account": "Account",
      "nav.refer": "Refer",
      "nav.bets": "My Bets",
      "nav.deposit": "Deposit",
      "nav.withdraw": "Withdraw",
      "nav.settings": "Settings",
      "nav.login": "Login",
      "nav.register": "Sign Up",
      "nav.logout": "Logout",
      "nav.profile": "My Account",
      "nav.promotions": "Promotions",
      "nav.results": "Results",
      "common.markets": "Markets",
      "common.closedSettled": "Closed / Settled",
      "common.suspended": "Suspended",
      "common.final": "Final",
      "common.postponed": "Postponed",
      "common.vs": "vs",
      "common.today": "Today",
      "common.tomorrow": "Tomorrow",
      "common.leagues": "Leagues",
      "common.matches": "Matches",
      "common.balance": "Balance",
      "common.allMarkets": "All Markets",
      "common.main": "Main",
      "common.firstHalf": "First Half",
      "market.matchResult": "Match Result",
      "market.correctScore": "Correct Score",
      "market.btts": "Both Teams To Score",
      "market.overUnder": "Over/Under",
      "market.halfTimeResult": "Half-Time Result",
      "market.doubleChance": "Double Chance",
      "market.drawNoBet": "Draw No Bet",
      "market.winner": "Winner",
    },
  },
  sw: {
    translation: {
      "nav.home": "Nyumbani",
      "nav.sports": "Michezo",
      "nav.live": "Moja kwa Moja",
      "nav.search": "Tafuta",
      "nav.account": "Akaunti",
      "nav.refer": "Rejea",
      "nav.bets": "Dau Zangu",
      "nav.deposit": "Weka Fedha",
      "nav.withdraw": "Toa Fedha",
      "nav.settings": "Mipangilio",
      "nav.login": "Ingia",
      "nav.register": "Jisajili",
      "nav.logout": "Toka",
      "nav.profile": "Akaunti Yangu",
      "nav.promotions": "Ofa",
      "nav.results": "Matokeo",
      "common.markets": "Soko",
      "common.closedSettled": "Imefungwa / Imelipwa",
      "common.suspended": "Imesimamishwa",
      "common.final": "Mwisho",
      "common.postponed": "Imeahirishwa",
      "common.vs": "dhidi ya",
      "common.today": "Leo",
      "common.tomorrow": "Kesho",
      "common.leagues": "Mashindano",
      "common.matches": "Mechi",
      "common.balance": "Salio",
      "common.allMarkets": "Masoko Yote",
      "common.main": "Kuu",
      "common.firstHalf": "Kipindi cha Kwanza",
      "market.matchResult": "Matokeo ya Mechi",
      "market.correctScore": "Matokeo Sahihi",
      "market.btts": "Timu Zote Kufunga",
      "market.overUnder": "Zaidi/Chini ya",
      "market.halfTimeResult": "Matokeo ya Kipindi cha Kwanza",
      "market.doubleChance": "Nafasi Mbili",
      "market.drawNoBet": "Hakuna Sare",
      "market.winner": "Mshindi",
    },
  },
  fr: {
    translation: {
      "nav.home": "Accueil",
      "nav.sports": "Sports",
      "nav.live": "Direct",
      "nav.search": "Rechercher",
      "nav.account": "Compte",
      "nav.refer": "Parrainer",
      "nav.bets": "Mes Paris",
      "nav.deposit": "Déposer",
      "nav.withdraw": "Retirer",
      "nav.settings": "Paramètres",
      "nav.login": "Se connecter",
      "nav.register": "S'inscrire",
      "nav.logout": "Se déconnecter",
      "nav.profile": "Mon Compte",
      "nav.promotions": "Promotions",
      "nav.results": "Résultats",
      "common.markets": "Marchés",
      "common.closedSettled": "Clôturés / Réglés",
      "common.suspended": "Suspendu",
      "common.final": "Final",
      "common.postponed": "Reporté",
      "common.vs": "vs",
      "common.today": "Aujourd'hui",
      "common.tomorrow": "Demain",
      "common.leagues": "Ligues",
      "common.matches": "Matchs",
      "common.balance": "Solde",
      "common.allMarkets": "Tous les Marchés",
      "common.main": "Principaux",
      "common.firstHalf": "Première Période",
      "market.matchResult": "Résultat Final",
      "market.correctScore": "Score Exact",
      "market.btts": "Les Deux Équipes Marquent",
      "market.overUnder": "Plus/Moins",
      "market.halfTimeResult": "Résultat Mi-Temps",
      "market.doubleChance": "Double Chance",
      "market.drawNoBet": "Match Nul Remboursé",
      "market.winner": "Gagnant",
    },
  },
  pt: {
    translation: {
      "nav.home": "Início",
      "nav.sports": "Esportes",
      "nav.live": "Ao Vivo",
      "nav.search": "Pesquisar",
      "nav.account": "Conta",
      "nav.refer": "Indicar",
      "nav.bets": "Minhas Apostas",
      "nav.deposit": "Depositar",
      "nav.withdraw": "Sacar",
      "nav.settings": "Configurações",
      "nav.login": "Entrar",
      "nav.register": "Registrar",
      "nav.logout": "Sair",
      "nav.profile": "Minha Conta",
      "nav.promotions": "Promoções",
      "nav.results": "Resultados",
      "common.markets": "Mercados",
      "common.closedSettled": "Encerrados / Liquidados",
      "common.suspended": "Suspenso",
      "common.final": "Final",
      "common.postponed": "Adiado",
      "common.vs": "vs",
      "common.today": "Hoje",
      "common.tomorrow": "Amanhã",
      "common.leagues": "Ligas",
      "common.matches": "Partidas",
      "common.balance": "Saldo",
      "common.allMarkets": "Todos os Mercados",
      "common.main": "Principais",
      "common.firstHalf": "Primeira Parte",
      "market.matchResult": "Resultado Final",
      "market.correctScore": "Placar Exato",
      "market.btts": "Ambas Marcam",
      "market.overUnder": "Mais/Menos",
      "market.halfTimeResult": "Resultado do Intervalo",
      "market.doubleChance": "Dupla Hipótese",
      "market.drawNoBet": "Sem Empate",
      "market.winner": "Vencedor",
    },
  },
  es: {
    translation: {
      "nav.home": "Inicio",
      "nav.sports": "Deportes",
      "nav.live": "En Vivo",
      "nav.search": "Buscar",
      "nav.account": "Cuenta",
      "nav.refer": "Referir",
      "nav.bets": "Mis Apuestas",
      "nav.deposit": "Depositar",
      "nav.withdraw": "Retirar",
      "nav.settings": "Ajustes",
      "nav.login": "Iniciar sesión",
      "nav.register": "Registrarse",
      "nav.logout": "Cerrar sesión",
      "nav.profile": "Mi Cuenta",
      "nav.promotions": "Promociones",
      "nav.results": "Resultados",
      "common.markets": "Mercados",
      "common.closedSettled": "Cerrados / Liquidados",
      "common.suspended": "Suspendido",
      "common.final": "Final",
      "common.postponed": "Aplazado",
      "common.vs": "vs",
      "common.today": "Hoy",
      "common.tomorrow": "Mañana",
      "common.leagues": "Ligas",
      "common.matches": "Partidos",
      "common.balance": "Saldo",
      "common.allMarkets": "Todos los Mercados",
      "common.main": "Principales",
      "common.firstHalf": "Primera Parte",
      "market.matchResult": "Resultado Final",
      "market.correctScore": "Marcador Exacto",
      "market.btts": "Ambos Marcan",
      "market.overUnder": "Más/Menos",
      "market.halfTimeResult": "Resultado al Descanso",
      "market.doubleChance": "Doble Oportunidad",
      "market.drawNoBet": "Empate Anula",
      "market.winner": "Ganador",
    },
  },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: getStoredLang(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/** Translate a DB market name (e.g. "Over/Under 2.5") through the resource
 *  keys, keeping any line suffix (2.5) untranslated. Falls back to the raw
 *  name for markets we don't know. */
export function tMarket(name: string): string {
  const known: Record<string, string> = {
    "Match Result": "market.matchResult",
    "Correct Score": "market.correctScore",
    "Both Teams To Score": "market.btts",
    "Half-Time Result": "market.halfTimeResult",
    "Double Chance": "market.doubleChance",
    "Draw No Bet": "market.drawNoBet",
    Winner: "market.winner",
  };
  const key = known[name] ?? (name.startsWith("Over/Under") ? "market.overUnder" : null);
  if (!key) return name;
  const line = name.startsWith("Over/Under") ? name.replace(/^Over\/Under/, "").trim() : "";
  const base = i18n.t(key);
  return line ? `${base} ${line}` : base;
}

export default i18n;
