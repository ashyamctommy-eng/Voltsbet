import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/public/currencies", (_req, res) => {
  res.json({
    defaultCode: "KES",
    currencies: [
      { code: "KES", symbol: "KSh", decimals: 2, rate: 1 },
      { code: "USD", symbol: "$", decimals: 2, rate: 0.0078 },
      { code: "EUR", symbol: "€", decimals: 2, rate: 0.0072 },
    ],
  });
});

router.get("/public/currency-resolution", (_req, res) => {
  res.json({ code: "KES", source: "force-default" });
});

router.get("/public/translations", (_req, res) => {
  res.json({ translations: [] });
});

router.get("/public/languages", (_req, res) => {
  res.json({
    languages: [
      { code: "en", name: "English" },
      { code: "sw", name: "Kiswahili" },
    ],
  });
});

router.get("/banners", (_req, res) => {
  res.json({ banners: [] });
});

router.get("/broadcasts", (_req, res) => {
  res.json({ broadcasts: [] });
});

router.get("/search", (_req, res) => {
  res.json({ games: [], sports: [] });
});

router.get("/account", (_req, res) => {
  res.json({
    authenticated: false,
    wallet: null,
    limits: { minStake: 50, maxStake: 100000, maxPayout: 1000000 },
  });
});

router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;