import { prisma } from "./prisma";

/**
 * Status-engine helpers. Feature gating is data-driven via StatusType rows:
 * e.g. USER/ACTIVE allows ["bet","deposit","withdraw"], USER/PENDING_VERIFICATION
 * blocks ["bet","withdraw"], etc.
 */

export async function getStatus(type: string, key: string) {
  return prisma.statusType.findUnique({ where: { type_key: { type, key } } });
}

export async function blockedActionsFor(type: string, key: string): Promise<string[]> {
  const s = await getStatus(type, key);
  if (!s) return [];
  try {
    return JSON.parse(s.blockedActions ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function allowedActionsFor(type: string, key: string): Promise<string[]> {
  const s = await getStatus(type, key);
  if (!s) return [];
  try {
    return JSON.parse(s.allowedActions ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Is `action` (bet|deposit|withdraw) allowed for a user with the given status key? */
export async function isUserActionAllowed(statusKey: string, action: "bet" | "deposit" | "withdraw") {
  const blocked = await blockedActionsFor("USER", statusKey);
  if (blocked.includes(action)) return false;
  const allowed = await allowedActionsFor("USER", statusKey);
  if (allowed.length && !allowed.includes(action)) return false;
  return true;
}

/** Human-readable reason shown to the user when an action is blocked. */
export async function userBlockReason(statusKey: string, action: string): Promise<string | null> {
  const s = await getStatus("USER", statusKey);
  const blocked = await blockedActionsFor("USER", statusKey);
  if (blocked.includes(action) || (s?.allowedActions && !JSON.parse(s.allowedActions ?? "[]").includes(action))) {
    switch (statusKey) {
      case "PENDING_VERIFICATION":
        return "Your account is pending verification. This feature is unlocked once your identity is verified.";
      case "SUSPENDED":
        return "Your account has been suspended. Contact support for assistance.";
      case "SELF_EXCLUDED":
        return "Self-exclusion is active on your account. This feature is temporarily disabled.";
      default:
        return `This feature is currently unavailable for your account status (${s?.name ?? statusKey}).`;
    }
  }
  return null;
}
