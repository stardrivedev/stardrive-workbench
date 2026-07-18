import { verifySync, generateURI } from "otplib";

export function verifyTotpCode(code: string, secret: string): boolean {
  try {
    const result = verifySync({
      token: code.replace(/\s/g, ""),
      secret,
      epochTolerance: [1, 1],
    });
    return result.valid;
  } catch {
    return false;
  }
}

export function getTotpUri(secret: string, issuer: string): string {
  return generateURI({ issuer, label: "admin", secret });
}
