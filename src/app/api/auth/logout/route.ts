import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const POST = handle(async () => {
  await destroySession();
  return ok({ message: "Logged out" });
});
