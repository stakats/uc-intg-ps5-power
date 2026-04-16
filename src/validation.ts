/**
 * Pure validation/normalization helpers used by the setup flow.
 *
 * These functions have no UC SDK or playactor dependencies, so they are
 * safe to import from unit tests without triggering driver.ts's
 * module-level integration init.
 */

/**
 * Normalize and validate an 8-digit PlayStation pairing PIN.
 *
 * Strips all whitespace (including NBSP and stray CR/LF from paste), then
 * validates that exactly 8 ASCII digits remain. Returns the normalized PIN
 * on success, or `null` if the input is not a valid PIN.
 *
 * The PS5 pairing screen displays the PIN with a space after the first four
 * digits for legibility; users who copy that format verbatim should succeed.
 */
export function normalizePIN(raw: unknown): string | null {
  const pin = (typeof raw === "string" ? raw : "").replace(/\s+/g, "");
  return /^\d{8}$/.test(pin) ? pin : null;
}

/**
 * Extract the OAuth `code` query parameter from a Sony PlayStation Network
 * redirect URL. Returns the code on success, or `null` if the URL is
 * malformed or has no `code` parameter.
 */
export function extractOAuthCode(redirectUrl: string): string | null {
  try {
    return new URL(redirectUrl).searchParams.get("code");
  } catch {
    return null;
  }
}

export type ValidateBackupResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/**
 * Validate a credential backup JSON string. Expects a non-empty JSON object
 * keyed by device MAC; each value is a playactor credential record.
 */
export function validateBackupJson(json: string): ValidateBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "parse error" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "expected JSON object" };
  }
  if (Object.keys(parsed).length === 0) {
    return { ok: false, error: "empty credentials" };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}
