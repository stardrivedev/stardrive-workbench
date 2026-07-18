"use server";

import { redirect } from "next/navigation";
import {
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  setPendingCookie,
  consumePendingCookie,
  totpEnabled,
} from "@/lib/cms/auth";
import { verifyTotpCode, getTotpUri } from "@/lib/cms/totp";
import { siteConfig } from "@/config/site";

// Step 1: verify password. Issues the session directly when TOTP is not
// configured, otherwise issues a short-lived pending cookie for step 2.
export async function verifyPasswordAction(
  _prevState: { error?: string; step?: string } | null,
  formData: FormData
): Promise<{ error: string } | { step: "totp" }> {
  const password = (formData.get("password") as string | null) ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) return { error: "ADMIN_PASSWORD is not configured on this server." };
  if (!password || !verifyPassword(password, adminPassword)) return { error: "Invalid password." };

  if (totpEnabled()) {
    await setPendingCookie();
    return { step: "totp" };
  }

  await setSessionCookie();
  redirect("/admin/dashboard");
}

// Step 2: verify TOTP code, issue session.
export async function verifyTotpAction(
  _prevState: { error?: string } | null,
  formData: FormData
): Promise<{ error: string }> {
  const code = (formData.get("code") as string | null) ?? "";
  const totpSecret = process.env.TOTP_SECRET;

  if (!totpSecret) return { error: "2FA is not configured on this server." };

  const pendingValid = await consumePendingCookie();
  if (!pendingValid) return { error: "Session expired. Please start over." };

  if (!/^\d{6}$/.test(code.trim())) return { error: "Invalid code. Try again." };
  if (!verifyTotpCode(code, totpSecret)) return { error: "Invalid code. Try again." };

  await setSessionCookie();
  redirect("/admin/dashboard");
}

export async function getSetupQrAction(): Promise<
  { error: string } | { qr: string; secret: string; uri: string }
> {
  const totpSecret = process.env.TOTP_SECRET;
  if (!totpSecret) return { error: "TOTP_SECRET is not set in the environment." };

  const uri = getTotpUri(totpSecret, siteConfig.name);
  const QRCode = (await import("qrcode")).default;
  const qr = await QRCode.toDataURL(uri, { width: 240, margin: 2 });
  return { qr, secret: totpSecret, uri };
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/admin");
}
