/**
 * Admin auth for Node.js server context (server actions, API routes).
 * Session token is a SHA-256 hash derived from ADMIN_PASSWORD, stored in an
 * httpOnly cookie. TOTP two-factor is enabled when TOTP_SECRET is set.
 */
import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "d4_admin_session";
const PENDING_COOKIE = "d4_admin_pending";

export function computeToken(password: string): string {
  return createHash("sha256").update(`d4-admin-session:${password}`).digest("hex");
}

export function verifyPassword(submitted: string, stored: string): boolean {
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(stored).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export function totpEnabled(): boolean {
  return Boolean(process.env.TOTP_SECRET);
}

export async function assertAuthenticated(): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("Admin not configured.");

  const store = await cookies();
  const session = store.get(SESSION_COOKIE)?.value;
  if (!session || session !== computeToken(adminPassword)) throw new Error("Unauthorized.");
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await assertAuthenticated();
    return true;
  } catch {
    return false;
  }
}

export async function setSessionCookie(): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD!;
  const store = await cookies();
  store.set(SESSION_COOKIE, computeToken(adminPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// ── Pending (post-password, pre-TOTP) cookie ──────────────────────────

function pendingTokenForWindow(adminPassword: string, window: number): string {
  return createHash("sha256")
    .update(`d4-admin-pending:${adminPassword}:${window}`)
    .digest("hex");
}

export async function setPendingCookie(): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD!;
  const window = Math.floor(Date.now() / 300_000);
  const store = await cookies();
  store.set(PENDING_COOKIE, pendingTokenForWindow(adminPassword, window), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
}

/** Validates and consumes the pending cookie. Valid for roughly ten minutes. */
export async function consumePendingCookie(): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const store = await cookies();
  const token = store.get(PENDING_COOKIE)?.value;
  if (!token) return false;

  const current = Math.floor(Date.now() / 300_000);
  const valid = [current, current - 1].some((w) => {
    const expected = pendingTokenForWindow(adminPassword, w);
    try {
      return (
        expected.length === token.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(token))
      );
    } catch {
      return false;
    }
  });

  store.delete(PENDING_COOKIE);
  return valid;
}
