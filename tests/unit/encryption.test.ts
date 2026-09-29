import { describe, it, expect, afterEach } from "vitest"
import { encryptTokenIfConfigured, decryptStoredToken } from "@/lib/encryption"

const KEY = "a".repeat(64)

describe("lib/encryption.ts — stored token helpers", () => {
  const original = process.env.ENCRYPTION_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = original
  })

  it("returns the token unchanged when no key is configured", () => {
    delete process.env.ENCRYPTION_KEY
    expect(encryptTokenIfConfigured("gho_plain")).toBe("gho_plain")
  })

  it("round-trips an encrypted token when a key is configured", () => {
    process.env.ENCRYPTION_KEY = KEY
    const stored = encryptTokenIfConfigured("gho_secret")
    expect(stored).not.toContain("gho_secret")
    expect(decryptStoredToken(stored)).toBe("gho_secret")
  })

  it("returns legacy plaintext tokens as-is even when a key is configured", () => {
    process.env.ENCRYPTION_KEY = KEY
    expect(decryptStoredToken("gho_legacy_plaintext")).toBe("gho_legacy_plaintext")
  })

  it("stores plaintext rather than throwing when the key is malformed", () => {
    process.env.ENCRYPTION_KEY = "too-short"
    expect(encryptTokenIfConfigured("gho_plain")).toBe("gho_plain")
  })
})
