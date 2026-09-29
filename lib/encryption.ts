import crypto from "crypto"

/**
 * Encrypt sensitive data (e.g., API tokens) using AES-256-GCM.
 * Requires ENCRYPTION_KEY environment variable (32 bytes, hex-encoded).
 */
export function encryptToken(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || "", "hex")
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters)")
  }

  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")

  const authTag = cipher.getAuthTag()
  // Format: IV (32 hex) + authTag (32 hex) + ciphertext
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}

/**
 * Decrypt AES-256-GCM encrypted token.
 * Returns empty string if decryption fails (graceful degradation).
 */
export function decryptToken(encrypted: string): string {
  try {
    const key = Buffer.from(process.env.ENCRYPTION_KEY || "", "hex")
    if (key.length !== 32) {
      console.error("ENCRYPTION_KEY misconfigured")
      return ""
    }

    const parts = encrypted.split(":")
    if (parts.length !== 3) {
      console.error("Invalid encrypted token format")
      return ""
    }

    const iv = Buffer.from(parts[0], "hex")
    const authTag = Buffer.from(parts[1], "hex")
    const ciphertext = parts[2]

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(ciphertext, "hex", "utf8")
    decrypted += decipher.final("utf8")

    return decrypted
  } catch (err) {
    console.error("Token decryption failed:", err)
    return ""
  }
}

// iv (16 bytes) : GCM auth tag (16 bytes) : ciphertext — all hex
const ENCRYPTED_FORMAT = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i

/**
 * Encrypt a token for storage when ENCRYPTION_KEY is configured; otherwise
 * (or if encryption fails) return it unchanged so auth flows never break.
 */
export function encryptTokenIfConfigured(plaintext: string): string {
  if (!process.env.ENCRYPTION_KEY) return plaintext
  try {
    return encryptToken(plaintext)
  } catch (err) {
    console.error("Token encryption failed; storing unencrypted:", err)
    return plaintext
  }
}

/**
 * Read a stored token. Values in the encrypted format are decrypted (returns
 * "" if that fails); anything else is a legacy plaintext token and is returned
 * as-is, so tokens saved before encryption was enabled keep working.
 */
export function decryptStoredToken(stored: string): string {
  if (!ENCRYPTED_FORMAT.test(stored)) return stored
  return decryptToken(stored)
}
