// cPanel "Setup Node.js App" startup file.
// Passenger runs this file with `node`; it boots Next.js in production mode
// and listens on the PORT Passenger provides (or 3000 as a fallback).
// Usage: set "Application startup file" to `start.js` in cPanel.
const { spawn } = require("child_process");

const port = process.env.PORT || "3000";
const host = process.env.HOSTNAME || "127.0.0.1";

console.log(`[voltbet] starting Next.js on ${host}:${port} (NODE_ENV=${process.env.NODE_ENV ?? "production"})`);

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", host, "-p", port],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  console.log(`[voltbet] next exited (code=${code}, signal=${signal})`);
  process.exit(code ?? (signal ? 1 : 0));
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
