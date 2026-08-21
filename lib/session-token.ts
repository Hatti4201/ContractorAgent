import { createHmac, timingSafeEqual } from "node:crypto";

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function passwordsMatch(candidate: string, expected: string) {
  const left = signature(candidate, "password-check");
  const right = signature(expected, "password-check");
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function createSessionToken(expiresAt: number, secret: string) {
  const expires = expiresAt.toString(36);
  return `${expires}.${signature(expires, secret)}`;
}

export function isSessionTokenValid(token: string | undefined, secret: string, now = Date.now()) {
  if (!token) return false;

  const [expires, suppliedSignature, extra] = token.split(".");
  if (!expires || !suppliedSignature || extra) return false;

  const expiresAt = Number.parseInt(expires, 36);
  const expectedSignature = signature(expires, secret);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  if (suppliedSignature.length !== expectedSignature.length) return false;

  return timingSafeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature));
}
