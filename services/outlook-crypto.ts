import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MAX_CACHE_BYTES = 1_000_000;

function key(value = process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY ?? "") {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("OUTLOOK_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return decoded;
}

export function encryptOutlookTokenCache(value: string, encryptionKey?: string) {
  if (!value || Buffer.byteLength(value) > MAX_CACHE_BYTES) throw new Error("Outlook token cache is invalid.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptOutlookTokenCache(value: string, encryptionKey?: string) {
  const [version, encodedIv, encodedTag, encodedContent, extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedContent || extra || value.length > MAX_CACHE_BYTES * 2) {
    throw new Error("Stored Outlook token cache is invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(encryptionKey), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedContent, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored Outlook token cache could not be decrypted.");
  }
}
