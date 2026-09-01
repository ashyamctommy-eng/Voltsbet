---
name: Vite migration boundaries
description: Keep imported Next.js server modules out of the browser bundle when porting a client surface to Vite.
---

When porting a Next.js app to Vite, shared view-model helpers must not import server-only feed, Prisma, settings, or authentication modules; keep browser data contracts and transforms in client-safe files and expose server behavior through the API artifact.

**Why:** Vite bundles every module reachable from the client entry point, so a seemingly harmless shared import can pull in Prisma or Next runtime code and fail at browser runtime.

**How to apply:** Trace imports from the Vite entry point before reusing copied components, replace Next navigation with the app router, and keep environment access on the server or behind Vite’s import.meta.env.