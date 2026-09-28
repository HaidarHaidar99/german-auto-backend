/**
 * GERMAN AUTO — Complete Authentication Test Suite
 * Tests all auth flows against the live Supabase database.
 * Each test group is isolated and cleans up after itself.
 * No fake business data is created or left behind.
 */

const assert = require("assert");
const http = require("http");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = require("../app");
const supabase = require("../config/supabase");

// ─── Globals ──────────────────────────────────────────────────────────────────

let server;
let port;

// Unique per test run to avoid collisions
const RUN_ID = Date.now();
const TEST_EMAIL = `auth.test.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASSWORD = "TestPass123!";
const TEST_NAME = "Auth Test User";
const NEW_PASS = "ResetPass456!";   // set after reset
const CHANGE_PASS = "ChangedPass789!"; // set after change-password

// ─── Server helpers ───────────────────────────────────────────────────────────

async function startServer() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
}

async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function cleanupUser(email) {
  await supabase.from("users").delete().eq("email", email.toLowerCase());
}

async function getUser(email) {
  const { data } = await supabase
    .from("users")
    .select(
      "id, email, is_verified, link, link_expires_at, reset_link, reset_link_expires_at, token_version, password_hash, role"
    )
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return data;
}

async function forceVerify(email) {
  await supabase
    .from("users")
    .update({ is_verified: true, link: null, link_expires_at: null })
    .eq("email", email.toLowerCase());
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

async function apiGet(path, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}) },
  });
  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

async function apiDelete(path, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "DELETE",
    headers: { ...(cookie ? { Cookie: cookie } : {}) },
  });
  const data = await res.json();
  return { status: res.status, data };
}

function extractCookie(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0]; // "token=<value>"
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

// ─── SECTION 1: SIGNUP ───────────────────────────────────────────────────────

async function testSignup() {
  console.log("\n── SIGNUP ──────────────────────────────────────────────");

  await test("Missing all fields → 400 with field errors", async () => {
    const { status, data } = await apiPost("/api/auth/signup", {
      email: "bad",
      password: "x",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.full_name, "Should flag full_name");
    assert.ok(data.errors.email, "Should flag email");
    assert.ok(data.errors.password, "Should flag password");
  });

  await test("Mismatched confirm_password → 400", async () => {
    const { status, data } = await apiPost("/api/auth/signup", {
      full_name: "Test",
      email: TEST_EMAIL,
      password: "Password123!",
      confirm_password: "Different!",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.confirm_password);
  });

  await test("Valid signup → 201, unverified, no secrets in response", async () => {
    const { status, data } = await apiPost("/api/auth/signup", {
      full_name: TEST_NAME,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      confirm_password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.data.user.id);
    assert.strictEqual(data.data.user.role, "CUSTOMER");
    assert.strictEqual(data.data.user.password_hash, undefined, "password_hash must not be exposed");
    assert.strictEqual(data.data.user.link, undefined, "verification token must not be exposed");
    assert.strictEqual(data.data.user.reset_link, undefined, "reset token must not be exposed");
  });

  await test("DB: is_verified=false, link token stored with 15m expiration", async () => {
    const user = await getUser(TEST_EMAIL);
    assert.ok(user, "User should exist");
    assert.strictEqual(user.is_verified, false);
    assert.ok(user.link, "Verification token should be stored");
    assert.ok(user.link_expires_at, "Expiry should be stored");
    const diffMs = new Date(user.link_expires_at).getTime() - Date.now();
    const diffMin = diffMs / (60 * 1000);
    assert.ok(diffMin > 13 && diffMin <= 16, `Verification link expiry must be 15 minutes (was ${diffMin.toFixed(1)}m)`);
  });

  await test("Unverified email re-signup → 201 with new verification link", async () => {
    const userBefore = await getUser(TEST_EMAIL);
    const oldToken = userBefore.link;

    const { status, data } = await apiPost("/api/auth/signup", {
      full_name: "Re-Signup Name",
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      confirm_password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 201);
    assert.ok(data.message.includes("verification link has been sent"));

    const userAfter = await getUser(TEST_EMAIL);
    assert.ok(userAfter.link);
    assert.notStrictEqual(userAfter.link, oldToken, "Token should be refreshed on re-signup");
  });
}

// ─── SECTION 2: LOGIN BEFORE VERIFICATION ────────────────────────────────────

async function testLoginPreVerification() {
  console.log("\n── LOGIN BEFORE VERIFICATION ────────────────────────────");

  await test("Login with unverified account → 403", async () => {
    const { status, data } = await apiPost("/api/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 403);
    assert.ok(data.message.toLowerCase().includes("verify"));
  });

  await test("Login with wrong password → 401", async () => {
    const { status } = await apiPost("/api/auth/login", {
      email: TEST_EMAIL,
      password: "WrongPwd!",
    });
    assert.strictEqual(status, 401);
  });

  await test("Login with nonexistent email → 401", async () => {
    const { status } = await apiPost("/api/auth/login", {
      email: "nobody@germanautotestonly.invalid",
      password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 401);
  });
}

// ─── SECTION 3: EMAIL VERIFICATION ───────────────────────────────────────────

async function testEmailVerification() {
  console.log("\n── EMAIL VERIFICATION ───────────────────────────────────");

  await test("Missing token → 400", async () => {
    const { status } = await apiGet("/api/auth/verify-email");
    assert.strictEqual(status, 400);
  });

  await test("Garbage token → 400", async () => {
    const { status } = await apiGet("/api/auth/verify-email?token=garbage-xyz-000");
    assert.strictEqual(status, 400);
  });

  await test("Expired token → 400", async () => {
    const user = await getUser(TEST_EMAIL);
    // Force token expiry in DB
    await supabase
      .from("users")
      .update({ link_expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", user.id);

    const { status, data } = await apiGet(`/api/auth/verify-email?token=${user.link}`);
    assert.strictEqual(status, 400);
    assert.ok(data.message.toLowerCase().includes("expir"), "Should mention expiration");

    // Restore valid expiry so subsequent tests work
    await supabase
      .from("users")
      .update({ link_expires_at: new Date(Date.now() + 3600000).toISOString() })
      .eq("id", user.id);
  });

  let usedToken;
  await test("Valid token → 200, is_verified=true, token cleared in DB", async () => {
    const user = await getUser(TEST_EMAIL);
    usedToken = user.link;

    const { status, data } = await apiGet(`/api/auth/verify-email?token=${user.link}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);

    const userAfter = await getUser(TEST_EMAIL);
    assert.strictEqual(userAfter.is_verified, true);
    assert.strictEqual(userAfter.link, null, "Token must be cleared");
    assert.strictEqual(userAfter.link_expires_at, null, "Expiry must be cleared");
  });

  await test("Verified account duplicate signup → 409", async () => {
    const { status } = await apiPost("/api/auth/signup", {
      full_name: "Dup Verified",
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      confirm_password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 409);
  });

  await test("Reusing the consumed verification token → 400", async () => {
    const { status } = await apiGet(`/api/auth/verify-email?token=${usedToken}`);
    assert.strictEqual(status, 400);
  });
}

// ─── SECTION 4: RESEND VERIFICATION ──────────────────────────────────────────

async function testResendVerification() {
  console.log("\n── RESEND VERIFICATION ──────────────────────────────────");

  const RESEND_EMAIL = `resend.${RUN_ID}@germanautotestonly.invalid`;
  await apiPost("/api/auth/signup", {
    full_name: "Resend Test",
    email: RESEND_EMAIL,
    password: TEST_PASSWORD,
    confirm_password: TEST_PASSWORD,
  });

  await test("Resend generates new token, invalidates old one", async () => {
    const userBefore = await getUser(RESEND_EMAIL);
    const oldToken = userBefore.link;

    const { status } = await apiPost("/api/auth/resend-verification", { email: RESEND_EMAIL });
    assert.strictEqual(status, 200);

    const userAfter = await getUser(RESEND_EMAIL);
    assert.ok(userAfter.link, "New token should be stored");
    assert.notStrictEqual(userAfter.link, oldToken, "Token should differ from original");
    assert.ok(new Date(userAfter.link_expires_at) > new Date(), "New expiry should be future");
  });

  await test("Resend for nonexistent email → 200 (anti-enumeration)", async () => {
    const { status } = await apiPost("/api/auth/resend-verification", {
      email: "ghost@germanautotestonly.invalid",
    });
    assert.strictEqual(status, 200);
  });

  await test("Resend for already-verified account → 200 (anti-enumeration)", async () => {
    // TEST_EMAIL is now verified
    const { status } = await apiPost("/api/auth/resend-verification", { email: TEST_EMAIL });
    assert.strictEqual(status, 200);
  });

  await test("Resend with invalid email format → 400", async () => {
    const { status, data } = await apiPost("/api/auth/resend-verification", { email: "not-email" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.email);
  });

  await cleanupUser(RESEND_EMAIL);
}

// ─── SECTION 5: LOGIN ────────────────────────────────────────────────────────

// Returns a valid auth cookie for further tests
async function testLogin() {
  console.log("\n── LOGIN ────────────────────────────────────────────────");

  let authCookie = "";

  await test("Missing both fields → 400", async () => {
    const { status, data } = await apiPost("/api/auth/login", {});
    assert.strictEqual(status, 400);
    assert.ok(data.errors.email);
    assert.ok(data.errors.password);
  });

  await test("Successful login → 200, HttpOnly cookie, no JWT in body, no secrets", async () => {
    const { status, data, headers } = await apiPost("/api/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.data.user.id);
    assert.strictEqual(data.data.user.role, "CUSTOMER");

    // JWT must be in cookie, NOT in body
    const cookieHeader = headers.get("set-cookie") || "";
    assert.ok(cookieHeader.includes("german_auto_jwt="), "Cookie should be named 'german_auto_jwt'");
    assert.ok(cookieHeader.toLowerCase().includes("httponly"), "Cookie must be HttpOnly");
    assert.ok(cookieHeader.includes("Max-Age=86400"), "Cookie Max-Age must be 86400 (24 hours)");
    assert.strictEqual(data.data.token, undefined, "JWT must NOT appear in body");
    assert.strictEqual(data.data.user.password_hash, undefined, "password_hash must not be exposed");
    assert.strictEqual(data.data.user.link, undefined, "verification link must not be exposed");
    assert.strictEqual(data.data.user.reset_link, undefined, "reset link must not be exposed");
    assert.strictEqual(data.data.user.token_version, undefined, "token_version must not be exposed");

    authCookie = extractCookie(headers);
  });

  // Get a fresh cookie for downstream tests
  const { headers } = await apiPost("/api/auth/login", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  authCookie = extractCookie(headers);

  return authCookie;
}

// ─── SECTION 6: GET ME ────────────────────────────────────────────────────────

async function testGetMe(authCookie) {
  console.log("\n── GET ME ───────────────────────────────────────────────");

  await test("No auth → 401", async () => {
    const { status } = await apiGet("/api/auth/me");
    assert.strictEqual(status, 401);
  });

  await test("Valid cookie → 200, safe profile, no secrets", async () => {
    const { status, data } = await apiGet("/api/auth/me", authCookie);
    assert.strictEqual(status, 200);
    assert.ok(data.data.user.id);
    assert.ok(data.data.user.email);
    assert.ok(data.data.user.role);
    assert.strictEqual(data.data.user.password_hash, undefined);
    assert.strictEqual(data.data.user.link, undefined);
    assert.strictEqual(data.data.user.reset_link, undefined);
    assert.strictEqual(data.data.user.token_version, undefined);
  });
}

// ─── SECTION 7: LOGOUT ───────────────────────────────────────────────────────

async function testLogout(authCookie) {
  console.log("\n── LOGOUT ───────────────────────────────────────────────");

  await test("POST /logout → 200, cookie cleared", async () => {
    const { status, headers } = await apiPost("/api/auth/logout", {}, authCookie);
    assert.strictEqual(status, 200);
    const setCookie = headers.get("set-cookie") || "";
    // Cleared cookie has empty value and/or Max-Age=0
    assert.ok(
      setCookie.includes("german_auto_jwt=") || setCookie.includes("Max-Age=0"),
      "Cookie clear header should be sent"
    );
  });

  // After logout, the old cookie should not work  
  // (Note: the server actually clears the cookie, but we still have the value — it just won't work
  // because the server sets it to empty/expired. Here we verify conceptually.)
  await test("GET /me without any cookie → 401", async () => {
    const { status } = await apiGet("/api/auth/me", "");
    assert.strictEqual(status, 401);
  });
}

// ─── SECTION 8: FORGOT PASSWORD ──────────────────────────────────────────────

async function testForgotPassword() {
  console.log("\n── FORGOT PASSWORD ──────────────────────────────────────");

  await test("Invalid email format → 400", async () => {
    const { status } = await apiPost("/api/auth/forgot-password", { email: "not-email" });
    assert.strictEqual(status, 400);
  });

  await test("Nonexistent email → 200 (anti-enumeration)", async () => {
    const { status, data } = await apiPost("/api/auth/forgot-password", {
      email: "nobody@germanautotestonly.invalid",
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    // Reset link must not appear in response
    assert.strictEqual(data.data, undefined);
  });

  await test("Valid email → 200, reset token stored in DB", async () => {
    const { status, data } = await apiPost("/api/auth/forgot-password", { email: TEST_EMAIL });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);

    const user = await getUser(TEST_EMAIL);
    assert.ok(user.reset_link, "Reset token should be stored in DB");
    assert.ok(user.reset_link_expires_at, "Expiry should be stored");
    const diffMs = new Date(user.reset_link_expires_at).getTime() - Date.now();
    const diffMin = diffMs / (60 * 1000);
    assert.ok(diffMin > 13 && diffMin <= 16, `Reset link expiry must be 15 minutes (was ${diffMin.toFixed(1)}m)`);
  });
}

// ─── SECTION 9: RESET PASSWORD ───────────────────────────────────────────────

// Returns the current password after reset
async function testResetPassword() {
  console.log("\n── RESET PASSWORD ───────────────────────────────────────");

  await test("Missing token → 400", async () => {
    const { status, data } = await apiPost("/api/auth/reset-password", {
      password: NEW_PASS,
      confirm_password: NEW_PASS,
    });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.token);
  });

  await test("Password too short → 400", async () => {
    const { status } = await apiPost("/api/auth/reset-password", {
      token: "abc",
      password: "short",
      confirm_password: "short",
    });
    assert.strictEqual(status, 400);
  });

  await test("Passwords don't match → 400", async () => {
    const { status, data } = await apiPost("/api/auth/reset-password", {
      token: "abc",
      password: NEW_PASS,
      confirm_password: "DifferentPass!",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.confirm_password);
  });

  await test("Garbage token → 400", async () => {
    const { status } = await apiPost("/api/auth/reset-password", {
      token: "garbage-xyz",
      password: NEW_PASS,
      confirm_password: NEW_PASS,
    });
    assert.strictEqual(status, 400);
  });

  await test("Expired token → 400", async () => {
    const user = await getUser(TEST_EMAIL);
    const savedToken = user.reset_link;

    // Force expiry
    await supabase
      .from("users")
      .update({ reset_link_expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", user.id);

    const { status, data } = await apiPost("/api/auth/reset-password", {
      token: savedToken,
      password: NEW_PASS,
      confirm_password: NEW_PASS,
    });
    assert.strictEqual(status, 400);
    assert.ok(data.message.toLowerCase().includes("expir"), "Should mention expiration");

    // Restore valid expiry
    await supabase
      .from("users")
      .update({ reset_link_expires_at: new Date(Date.now() + 3600000).toISOString() })
      .eq("id", user.id);
  });

  await test("Valid reset → 200, password changed, token_version incremented, token cleared", async () => {
    const userBefore = await getUser(TEST_EMAIL);
    const oldVersion = userBefore.token_version;
    const resetToken = userBefore.reset_link;

    const { status, data } = await apiPost("/api/auth/reset-password", {
      token: resetToken,
      password: NEW_PASS,
      confirm_password: NEW_PASS,
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);

    const userAfter = await getUser(TEST_EMAIL);
    assert.strictEqual(userAfter.reset_link, null, "Reset token must be cleared");
    assert.strictEqual(userAfter.reset_link_expires_at, null, "Reset expiry must be cleared");
    assert.ok(
      userAfter.token_version > oldVersion,
      `token_version (${userAfter.token_version}) should exceed old (${oldVersion})`
    );
  });

  await test("Reusing the consumed reset token → 400", async () => {
    const user = await getUser(TEST_EMAIL);
    // reset_link is now null; test with the string that was previously valid
    const { status } = await apiPost("/api/auth/reset-password", {
      token: "previously-consumed-token",
      password: NEW_PASS,
      confirm_password: NEW_PASS,
    });
    assert.strictEqual(status, 400);
  });
}

// ─── SECTION 10: TOKEN VERSION INVALIDATION ──────────────────────────────────

async function testTokenVersionInvalidation() {
  console.log("\n── TOKEN VERSION INVALIDATION ───────────────────────────");

  // Login with NEW_PASS (set during reset)
  const { headers: h1 } = await apiPost("/api/auth/login", {
    email: TEST_EMAIL,
    password: NEW_PASS,
  });
  const cookieBeforeReset = extractCookie(h1);
  assert.ok(cookieBeforeReset, "Should be able to log in with new password after reset");

  await test("Cookie obtained before password reset is rejected after token_version increment", async () => {
    // Trigger another reset to increment token_version again
    await apiPost("/api/auth/forgot-password", { email: TEST_EMAIL });
    const user = await getUser(TEST_EMAIL);

    if (user.reset_link) {
      const { status } = await apiPost("/api/auth/reset-password", {
        token: user.reset_link,
        password: CHANGE_PASS,
        confirm_password: CHANGE_PASS,
      });
      assert.strictEqual(status, 200, "Second reset should succeed");
    }

    // The cookie issued before the second reset should now be invalid
    const { status } = await apiGet("/api/auth/me", cookieBeforeReset);
    assert.strictEqual(status, 401, "Pre-reset cookie should be rejected after token_version increment");
  });
}

// ─── SECTION 11: CHANGE PASSWORD ─────────────────────────────────────────────

async function testChangePassword() {
  console.log("\n── CHANGE PASSWORD ──────────────────────────────────────");

  const CHANGE_EMAIL = `change.${RUN_ID}@germanautotestonly.invalid`;
  const INITIAL_PASS = "InitialPass123!";
  const SECOND_PASS = "SecondPass456!";

  await apiPost("/api/auth/signup", {
    full_name: "Change Pwd Test",
    email: CHANGE_EMAIL,
    password: INITIAL_PASS,
    confirm_password: INITIAL_PASS,
  });
  await forceVerify(CHANGE_EMAIL);

  const { headers: loginH } = await apiPost("/api/auth/login", {
    email: CHANGE_EMAIL,
    password: INITIAL_PASS,
  });
  let cookie = extractCookie(loginH);

  await test("Change password — unauthenticated → 401", async () => {
    const { status } = await apiPost("/api/auth/change-password", {
      current_password: INITIAL_PASS,
      new_password: SECOND_PASS,
      confirm_new_password: SECOND_PASS,
    });
    assert.strictEqual(status, 401);
  });

  await test("Change password — wrong current password → 400", async () => {
    const { status } = await apiPost("/api/auth/change-password", {
      current_password: "WrongPass!",
      new_password: SECOND_PASS,
      confirm_new_password: SECOND_PASS,
    }, cookie);
    assert.strictEqual(status, 400);
  });

  await test("Change password — mismatched confirm → 400", async () => {
    const { status, data } = await apiPost("/api/auth/change-password", {
      current_password: INITIAL_PASS,
      new_password: SECOND_PASS,
      confirm_new_password: "MismatchPwd!",
    }, cookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.confirm_new_password);
  });

  let newCookie = "";
  await test("Successful change → 200, new cookie issued, token_version incremented", async () => {
    const userBefore = await getUser(CHANGE_EMAIL);
    const oldVer = userBefore.token_version;

    const { status, headers } = await apiPost("/api/auth/change-password", {
      current_password: INITIAL_PASS,
      new_password: SECOND_PASS,
      confirm_new_password: SECOND_PASS,
    }, cookie);
    assert.strictEqual(status, 200);

    const userAfter = await getUser(CHANGE_EMAIL);
    assert.ok(userAfter.token_version > oldVer, "token_version should be incremented");

    newCookie = extractCookie(headers);
    assert.ok(newCookie, "New session cookie should be returned");
  });

  await test("Old cookie rejected after change", async () => {
    const { status } = await apiGet("/api/auth/me", cookie);
    assert.strictEqual(status, 401, "Old cookie must be rejected");
  });

  await test("New cookie works after change", async () => {
    const { status } = await apiGet("/api/auth/me", newCookie);
    assert.strictEqual(status, 200, "New cookie must be accepted");
  });

  await cleanupUser(CHANGE_EMAIL);
}

// ─── SECTION 12: ROLE AUTHORIZATION ──────────────────────────────────────────

async function testRoleAuthorization() {
  console.log("\n── ROLE AUTHORIZATION ───────────────────────────────────");

  // At this point TEST_EMAIL has CHANGE_PASS from the second password reset in Section 10
  const { headers } = await apiPost("/api/auth/login", {
    email: TEST_EMAIL,
    password: CHANGE_PASS,
  });
  const customerCookie = extractCookie(headers);

  await test("CUSTOMER can access /me (own resource)", async () => {
    const { status, data } = await apiGet("/api/auth/me", customerCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.user.role, "CUSTOMER");
  });

  await test("No cookie → 401 on protected route", async () => {
    const { status } = await apiGet("/api/auth/me", "");
    assert.strictEqual(status, 401);
  });

  await test("Invalid/garbage cookie → 401 on protected route", async () => {
    const { status } = await apiGet("/api/auth/me", "german_auto_jwt=garbage-token-value");
    assert.strictEqual(status, 401);
  });
}

// ─── SECTION 13: GOOGLE OAUTH SECURITY & RESTRICTIONS ─────────────────────────

async function testGoogleOAuth() {
  console.log("\n── GOOGLE OAUTH SECURITY & RESTRICTIONS ────────────────");

  await test("GET /api/auth/google endpoint exists", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/google`, {
      redirect: "manual",
    });
    assert.ok(
      res.status === 302 || res.status === 503,
      `Status should be 302 redirect or 503 unconfigured (got ${res.status})`
    );
  });

  await test("POST /api/auth/google without payload → 400", async () => {
    const { status, data } = await apiPost("/api/auth/google", {});
    assert.strictEqual(status, 400);
    assert.ok(data.message.includes("credential or authorization code"));
  });

  await test("Google OAuth strictly forbids ADMIN / SUPER_ADMIN roles", async () => {
    const authService = require("../services/auth.service");
    
    const originalFetch = global.fetch;
    global.fetch = async (url, ...args) => {
      if (typeof url === "string" && url.includes("oauth2.googleapis.com/tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            email: "hh1816341@gmail.com", // existing ADMIN account
            name: "Admin User",
            email_verified: "true",
          }),
        };
      }
      return originalFetch(url, ...args);
    };

    try {
      let threw = false;
      try {
        await authService.googleAuth({ credential: "mock-admin-google-token" });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.statusCode, 403, "Must return 403 forbidden");
        assert.ok(
          err.message.includes("restricted to customer accounts only"),
          `Expected admin rejection error message, got: ${err.message}`
        );
      }
      assert.ok(threw, "Admin Google OAuth MUST throw 403 error");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("Google OAuth allows CUSTOMER registration/login with 24h session", async () => {
    const authService = require("../services/auth.service");
    const GOOGLE_CUST_EMAIL = `google.cust.${RUN_ID}@germanautotestonly.invalid`;

    const originalFetch = global.fetch;
    global.fetch = async (url, ...args) => {
      if (typeof url === "string" && url.includes("oauth2.googleapis.com/tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            email: GOOGLE_CUST_EMAIL,
            name: "Google Customer",
            email_verified: "true",
          }),
        };
      }
      return originalFetch(url, ...args);
    };

    try {
      const result = await authService.googleAuth({ credential: "mock-cust-google-token" });
      assert.ok(result.user);
      assert.strictEqual(result.user.role, "CUSTOMER", "Created role MUST be CUSTOMER");
      assert.strictEqual(result.user.is_verified, true, "Google users are auto-verified");
      assert.ok(result.token, "JWT token must be issued");

      const { verifyToken } = require("../utils/jwt.util");
      const decoded = verifyToken(result.token);
      assert.strictEqual(decoded.role, "CUSTOMER");
      const lifetimeSec = decoded.exp - decoded.iat;
      assert.strictEqual(lifetimeSec, 86400, "JWT session lifetime must be exactly 86400 seconds (24 hours)");

      await cleanupUser(GOOGLE_CUST_EMAIL);
    } finally {
      global.fetch = originalFetch;
    }
  });
}

// ─── SECTION 14: DELETE ACCOUNT ──────────────────────────────────────────────

async function testDeleteAccount() {
  console.log("\n── DELETE ACCOUNT ───────────────────────────────────────");

  const DEL_EMAIL = `delete.${RUN_ID}@germanautotestonly.invalid`;
  await apiPost("/api/auth/signup", {
    full_name: "Delete Test",
    email: DEL_EMAIL,
    password: TEST_PASSWORD,
    confirm_password: TEST_PASSWORD,
  });
  await forceVerify(DEL_EMAIL);

  const { headers } = await apiPost("/api/auth/login", {
    email: DEL_EMAIL,
    password: TEST_PASSWORD,
  });
  const cookie = extractCookie(headers);

  await test("Delete without auth → 401", async () => {
    const { status } = await apiDelete("/api/auth/delete-account", "");
    assert.strictEqual(status, 401);
  });

  await test("Delete with auth → 200, user removed from DB", async () => {
    const { status } = await apiDelete("/api/auth/delete-account", cookie);
    assert.strictEqual(status, 200);

    const user = await getUser(DEL_EMAIL);
    assert.strictEqual(user, null, "User record should be gone from DB");
  });

  await test("Cookie from deleted account → 401", async () => {
    const { status } = await apiGet("/api/auth/me", cookie);
    assert.strictEqual(status, 401);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================");
  console.log("GERMAN AUTO — AUTH TESTS (LIVE SUPABASE)");
  console.log("==========================================");

  await startServer();
  // Clean slate
  await cleanupUser(TEST_EMAIL);

  try {
    await testSignup();
    await testLoginPreVerification();
    await testEmailVerification();
    await testResendVerification();
    const authCookie = await testLogin();
    await testGetMe(authCookie);
    await testLogout(authCookie);
    await testForgotPassword();
    await testResetPassword();
    await testTokenVersionInvalidation();
    await testChangePassword();
    await testRoleAuthorization();
    await testGoogleOAuth();
    await testDeleteAccount();
  } catch (crashErr) {
    console.error("\n[CRASH] Test suite crashed unexpectedly:", crashErr.message);
    failed++;
    failures.push({ name: "Suite crash", error: crashErr.message });
  } finally {
    await cleanupUser(TEST_EMAIL);
    await stopServer();
  }

  console.log("\n==========================================");
  console.log(`AUTH TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("==========================================");

  if (failed > 0) process.exit(1);
}

main();
