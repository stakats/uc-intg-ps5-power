import test from "ava";
import { normalizePIN, extractOAuthCode, validateBackupJson } from "../src/validation.js";

// ---------------------------------------------------------------------------
// normalizePIN
// ---------------------------------------------------------------------------

test("normalizePIN: accepts a plain 8-digit string", (t) => {
  t.is(normalizePIN("12345678"), "12345678");
});

test("normalizePIN: strips a space after the first four digits (PS5 display format)", (t) => {
  t.is(normalizePIN("1234 5678"), "12345678");
});

test("normalizePIN: strips leading/trailing/interior whitespace of all kinds", (t) => {
  t.is(normalizePIN(" 1234\t5678\n"), "12345678");
});

test("normalizePIN: strips NBSP (U+00A0)", (t) => {
  t.is(normalizePIN("1234\u00A05678"), "12345678");
});

test("normalizePIN: rejects a 4-digit input", (t) => {
  t.is(normalizePIN("1234"), null);
});

test("normalizePIN: rejects a 9-digit input", (t) => {
  t.is(normalizePIN("123456789"), null);
});

test("normalizePIN: rejects non-digit characters", (t) => {
  t.is(normalizePIN("abcdefgh"), null);
});

test("normalizePIN: rejects the empty string", (t) => {
  t.is(normalizePIN(""), null);
});

test("normalizePIN: rejects undefined", (t) => {
  t.is(normalizePIN(undefined), null);
});

test("normalizePIN: rejects null", (t) => {
  t.is(normalizePIN(null), null);
});

test("normalizePIN: rejects a number (not a string)", (t) => {
  t.is(normalizePIN(12345678), null);
});

// ---------------------------------------------------------------------------
// extractOAuthCode
// ---------------------------------------------------------------------------

test("extractOAuthCode: extracts the code from a typical Sony redirect URL", (t) => {
  const url = "https://remoteplay.dl.playstation.net/remoteplay/redirect?code=ABC123xyz";
  t.is(extractOAuthCode(url), "ABC123xyz");
});

test("extractOAuthCode: extracts the code from a URL with additional query params", (t) => {
  const url = "https://remoteplay.dl.playstation.net/remoteplay/redirect?foo=bar&code=XYZ789&baz=qux";
  t.is(extractOAuthCode(url), "XYZ789");
});

test("extractOAuthCode: returns null when the URL has no code parameter", (t) => {
  const url = "https://remoteplay.dl.playstation.net/remoteplay/redirect?state=abc";
  t.is(extractOAuthCode(url), null);
});

test("extractOAuthCode: returns null for a malformed URL", (t) => {
  t.is(extractOAuthCode("not a url"), null);
});

test("extractOAuthCode: returns null for the empty string", (t) => {
  t.is(extractOAuthCode(""), null);
});

// ---------------------------------------------------------------------------
// validateBackupJson
// ---------------------------------------------------------------------------

test("validateBackupJson: accepts a valid single-device backup", (t) => {
  const json = JSON.stringify({
    "78C8819F1C87": {
      "app-type": "r",
      "auth-type": "R",
      accountId: "BGW9fHO5XFM=",
      registration: { "PS5-Mac": "78c8819f1c87" }
    }
  });
  const result = validateBackupJson(json);
  t.true(result.ok);
  if (result.ok) {
    t.truthy(result.data["78C8819F1C87"]);
  }
});

test("validateBackupJson: accepts a multi-device backup", (t) => {
  const json = JSON.stringify({ AA: { x: 1 }, BB: { x: 2 } });
  const result = validateBackupJson(json);
  t.true(result.ok);
  if (result.ok) {
    t.is(Object.keys(result.data).length, 2);
  }
});

test("validateBackupJson: rejects an empty object", (t) => {
  const result = validateBackupJson("{}");
  t.false(result.ok);
  if (!result.ok) {
    t.is(result.error, "empty credentials");
  }
});

test("validateBackupJson: rejects a JSON array", (t) => {
  const result = validateBackupJson("[]");
  t.false(result.ok);
  if (!result.ok) {
    t.is(result.error, "expected JSON object");
  }
});

test("validateBackupJson: rejects a JSON string literal", (t) => {
  const result = validateBackupJson('"foo"');
  t.false(result.ok);
  if (!result.ok) {
    t.is(result.error, "expected JSON object");
  }
});

test("validateBackupJson: rejects the JSON literal null", (t) => {
  const result = validateBackupJson("null");
  t.false(result.ok);
  if (!result.ok) {
    t.is(result.error, "expected JSON object");
  }
});

test("validateBackupJson: rejects malformed JSON", (t) => {
  const result = validateBackupJson("{");
  t.false(result.ok);
  if (!result.ok) {
    // Error message comes from JSON.parse — just assert it's non-empty.
    t.true(result.error.length > 0);
  }
});
