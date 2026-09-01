/** How long after placement an OPEN bet can be cancelled (stake refunded).
 *  Pure module — safe for both server (cancel API) and client (timer UI). */
export const BET_CANCEL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
