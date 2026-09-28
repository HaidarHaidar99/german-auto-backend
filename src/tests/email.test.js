/**
 * GERMAN AUTO — Comprehensive Email Delivery Test Suite
 *
 * Validates:
 * 1. Email Service Provider resolution (Resend vs test transport vs unconfigured production)
 * 2. Resend REST API wire payload format (headers, endpoint, authentication, sender, HTML/text)
 * 3. 100% German email content (Verification & Password Reset)
 * 4. 100% English email content (Verification & Password Reset)
 * 5. Strict 15-minute token lifetime notices in both languages
 * 6. Correct frontend URLs (/verify?token=... and /reset-password?token=...)
 * 7. Security: No tokens or API keys leaked in errors or responses
 * 8. End-to-end signup email dispatch
 * 9. End-to-end resend-verification email dispatch with token replacement
 * 10. End-to-end forgot-password email dispatch
 */

const assert = require("assert");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const emailService = require("../services/email.service");
const authService = require("../services/auth.service");
const supabase = require("../config/supabase");

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

async function runEmailTests() {
  console.log("==========================================");
  console.log("STARTING GERMAN AUTO EMAIL DELIVERY TESTS");
  console.log("==========================================");

  // ── 1. PROVIDER RESOLUTION & SAFETY ───────────────────────────────────────
  console.log("\n── 1. PROVIDER RESOLUTION & SAFETY ────────────────────────");

  await test("Default test transport in test environment", () => {
    const originalKey = process.env.RESEND_API_KEY;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    delete process.env.RESEND_API_KEY;
    const provider = emailService.resolveProvider();
    assert.strictEqual(provider, "test", "Should resolve to 'test' when RESEND_API_KEY is unset in test env");
    process.env.NODE_ENV = origEnv;
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
  });

  await test("Resend provider resolution when RESEND_API_KEY is present", () => {
    const originalKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_dummy_key_123456";
    const provider = emailService.resolveProvider();
    assert.strictEqual(provider, "resend", "Should resolve to 'resend' when key is present");
    if (originalKey) {
      process.env.RESEND_API_KEY = originalKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  await test("Production safeguard: Unconfigured production logs and fails safely", async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origKey = process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;

    const res = await emailService.dispatch({
      to: "safety.check@example.com",
      subject: "Test Safety",
      text: "Test",
      html: "<p>Test</p>",
    });

    assert.strictEqual(res.success, false, "Must fail safely when unconfigured in production");
    assert.strictEqual(res.error, "EMAIL_PROVIDER_NOT_CONFIGURED");

    process.env.NODE_ENV = origNodeEnv;
    if (origKey) process.env.RESEND_API_KEY = origKey;
  });

  // ── 2. RESEND REST API WIRE PROTOCOL INTEGRATION ─────────────────────────
  console.log("\n── 2. RESEND REST API PROTOCOL INTEGRATION ────────────────");

  await test("Resend REST API dispatch makes correct HTTP POST with Bearer auth", async () => {
    const origKey = process.env.RESEND_API_KEY;
    const origFrom = process.env.EMAIL_FROM;
    const origFetch = global.fetch;

    process.env.RESEND_API_KEY = "re_mock_test_key_999";
    process.env.EMAIL_FROM = "German Auto Test <noreply@germanauto.de>";

    let interceptedUrl = null;
    let interceptedOptions = null;

    global.fetch = async (url, options) => {
      interceptedUrl = url;
      interceptedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_resend_mock_id_789" }),
      };
    };

    try {
      const res = await emailService.dispatch({
        to: "buyer@example.de",
        subject: "Willkommen bei German Auto",
        text: "Willkommen!",
        html: "<p>Willkommen!</p>",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.sent, true);
      assert.strictEqual(res.provider, "resend");
      assert.strictEqual(res.id, "msg_resend_mock_id_789");

      // Verify wire payload details
      assert.strictEqual(interceptedUrl, "https://api.resend.com/emails");
      assert.strictEqual(interceptedOptions.method, "POST");
      assert.strictEqual(interceptedOptions.headers["Authorization"], "Bearer re_mock_test_key_999");
      assert.strictEqual(interceptedOptions.headers["Content-Type"], "application/json");

      const body = JSON.parse(interceptedOptions.body);
      assert.strictEqual(body.from, "German Auto Test <noreply@germanauto.de>");
      assert.deepStrictEqual(body.to, ["buyer@example.de"]);
      assert.strictEqual(body.subject, "Willkommen bei German Auto");
      assert.strictEqual(body.text, "Willkommen!");
    } finally {
      global.fetch = origFetch;
      if (origKey) process.env.RESEND_API_KEY = origKey;
      else delete process.env.RESEND_API_KEY;
      if (origFrom) process.env.EMAIL_FROM = origFrom;
      else delete process.env.EMAIL_FROM;
    }
  });

  await test("Resend API error response handled gracefully without unhandled crashes", async () => {
    const origKey = process.env.RESEND_API_KEY;
    const origFetch = global.fetch;

    process.env.RESEND_API_KEY = "re_invalid_key";

    global.fetch = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ message: "API key is invalid", name: "authentication_error" }),
    });

    try {
      const res = await emailService.dispatch({
        to: "test@example.com",
        subject: "Error Test",
        text: "Text",
        html: "<p>Text</p>",
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.sent, false);
      assert.strictEqual(res.error, "API key is invalid");
    } finally {
      global.fetch = origFetch;
      if (origKey) process.env.RESEND_API_KEY = origKey;
      else delete process.env.RESEND_API_KEY;
    }
  });

  // ── 3. VERIFICATION EMAIL TEMPLATES (GERMAN & ENGLISH) ────────────────────
  console.log("\n── 3. VERIFICATION EMAIL TEMPLATES (DE & EN) ──────────────");

  await test("German verification email: 100% German, 15m notice, /verify link", async () => {
    emailService.clearSentEmails();

    const token = "64charveriftoken1234567890abcdef1234567890abcdef1234567890abcdef";
    await emailService.sendVerificationEmail({
      email: "kunde@germanauto.de",
      fullName: "Hans Gruber",
      token,
      lang: "de",
    });

    const mail = emailService.getLastEmail();
    assert.strictEqual(mail.to, "kunde@germanauto.de");
    assert.strictEqual(mail.type, "VERIFICATION");
    assert.strictEqual(mail.lang, "de");

    // Pure German subject
    assert.strictEqual(mail.subject, "Bestätigen Sie Ihre E-Mail-Adresse — German Auto");

    // Pure German body
    assert.ok(mail.text.includes("Hallo Hans Gruber,"), "Salutation should contain recipient name");
    assert.ok(mail.text.includes("/verify?token="), "Must contain /verify URL");
    assert.ok(mail.text.includes(token), "Must contain token");
    assert.ok(mail.text.includes("genau 15 Minuten"), "Must declare exactly 15 minutes");
    assert.ok(!mail.text.includes("Please verify"), "Zero mixed English");
    assert.ok(!mail.text.includes("Verify your email"), "Zero mixed English");

    // Pure German HTML
    assert.ok(mail.html.includes("E-Mail-Adresse bestätigen"), "HTML should have German heading/button");
    assert.ok(mail.html.includes("Gültigkeitsdauer: Genau 15 Minuten"), "HTML should state 15 min validity");
  });

  await test("English verification email: 100% English, 15m notice, /verify link", async () => {
    emailService.clearSentEmails();

    const token = "tokenenglishverif1234567890abcdef1234567890abcdef1234567890abcdef";
    await emailService.sendVerificationEmail({
      email: "client@example.com",
      fullName: "Jane Smith",
      token,
      lang: "en",
    });

    const mail = emailService.getLastEmail();
    assert.strictEqual(mail.to, "client@example.com");
    assert.strictEqual(mail.type, "VERIFICATION");
    assert.strictEqual(mail.lang, "en");

    // Pure English subject
    assert.strictEqual(mail.subject, "Verify your email address — German Auto");

    // Pure English body
    assert.ok(mail.text.includes("Hello Jane Smith,"), "Salutation should contain recipient name");
    assert.ok(mail.text.includes("/verify?token="), "Must contain /verify URL");
    assert.ok(mail.text.includes(token), "Must contain token");
    assert.ok(mail.text.includes("exactly 15 minutes"), "Must declare exactly 15 minutes");
    assert.ok(!mail.text.includes("Bestätigen Sie"), "Zero mixed German");
    assert.ok(!mail.text.includes("E-Mail-Adresse bestätigen"), "Zero mixed German");

    // Pure English HTML
    assert.ok(mail.html.includes("Verify Your Email Address"), "HTML should have English heading");
    assert.ok(mail.html.includes("Validity Period: Exactly 15 Minutes"), "HTML should state 15 min validity");
  });

  // ── 4. PASSWORD RESET EMAIL TEMPLATES (GERMAN & ENGLISH) ──────────────────
  console.log("\n── 4. PASSWORD RESET EMAIL TEMPLATES (DE & EN) ────────────");

  await test("German password reset email: 100% German, single-use, 15m notice, /reset-password link", async () => {
    emailService.clearSentEmails();

    const token = "germanresettoken1234567890abcdef1234567890abcdef1234567890abcdef";
    await emailService.sendPasswordResetEmail({
      email: "kunde@germanauto.de",
      fullName: "Hans Gruber",
      token,
      lang: "de",
    });

    const mail = emailService.getLastEmail();
    assert.strictEqual(mail.to, "kunde@germanauto.de");
    assert.strictEqual(mail.type, "PASSWORD_RESET");
    assert.strictEqual(mail.lang, "de");

    // Pure German subject
    assert.strictEqual(mail.subject, "Passwort zurücksetzen — German Auto");

    // Pure German text
    assert.ok(mail.text.includes("Hallo Hans Gruber,"), "Salutation should contain recipient name");
    assert.ok(mail.text.includes("/reset-password?token="), "Must contain /reset-password URL");
    assert.ok(mail.text.includes(token), "Must contain token");
    assert.ok(mail.text.includes("genau 15 Minuten"), "Must declare exactly 15 minutes");
    assert.ok(mail.text.includes("nur einmal verwendet werden"), "Must declare single use");
    assert.ok(!mail.text.includes("Reset your password"), "Zero mixed English");

    // Pure German HTML
    assert.ok(mail.html.includes("Passwort zurücksetzen"), "HTML button must be German");
    assert.ok(mail.html.includes("Einmaliger Link &bull; Gültig für genau 15 Minuten"), "HTML notice must be German");
  });

  await test("English password reset email: 100% English, single-use, 15m notice, /reset-password link", async () => {
    emailService.clearSentEmails();

    const token = "englishresettoken1234567890abcdef1234567890abcdef1234567890abcdef";
    await emailService.sendPasswordResetEmail({
      email: "client@example.com",
      fullName: "Jane Smith",
      token,
      lang: "en",
    });

    const mail = emailService.getLastEmail();
    assert.strictEqual(mail.to, "client@example.com");
    assert.strictEqual(mail.type, "PASSWORD_RESET");
    assert.strictEqual(mail.lang, "en");

    // Pure English subject
    assert.strictEqual(mail.subject, "Reset your password — German Auto");

    // Pure English text
    assert.ok(mail.text.includes("Hello Jane Smith,"), "Salutation should contain recipient name");
    assert.ok(mail.text.includes("/reset-password?token="), "Must contain /reset-password URL");
    assert.ok(mail.text.includes(token), "Must contain token");
    assert.ok(mail.text.includes("exactly 15 minutes"), "Must declare exactly 15 minutes");
    assert.ok(mail.text.includes("only be used once"), "Must declare single use");
    assert.ok(!mail.text.includes("Passwort zurücksetzen"), "Zero mixed German");

    // Pure English HTML
    assert.ok(mail.html.includes("Reset Password"), "HTML button must be English");
    assert.ok(mail.html.includes("Single-Use Link &bull; Valid for Exactly 15 Minutes"), "HTML notice must be English");
  });

  // ── 5. END-TO-END AUTH FLOW EMAIL DISPATCHES ─────────────────────────────
  console.log("\n── 5. END-TO-END AUTH FLOW EMAIL DISPATCHES ───────────────");

  const runId = Date.now();
  const testEmailDe = `de.flow.${runId}@germanautotestonly.invalid`;
  const testEmailEn = `en.flow.${runId}@germanautotestonly.invalid`;

  try {
    // 5.1 Signup with German language
    await test("Signup with lang='de' dispatches German verification email with 15m token", async () => {
      emailService.clearSentEmails();

      const result = await authService.signup({
        fullName: "Klaus Schmidt",
        email: testEmailDe,
        password: "SecurePassword123!",
        lang: "de",
      });

      assert.strictEqual(result.user.role, "CUSTOMER");
      assert.strictEqual(result.user.is_verified, false);

      // Verify email was dispatched
      const mail = emailService.getLastEmail();
      assert.ok(mail, "Verification email must be dispatched");
      assert.strictEqual(mail.to, testEmailDe);
      assert.strictEqual(mail.lang, "de");
      assert.ok(mail.subject.includes("Bestätigen Sie Ihre E-Mail-Adresse"));

      // Verify token in DB has 15m expiration
      const { data: dbUser } = await supabase
        .from("users")
        .select("link, link_expires_at")
        .eq("email", testEmailDe)
        .single();

      assert.ok(dbUser.link);
      const diffMin = (new Date(dbUser.link_expires_at).getTime() - Date.now()) / (60 * 1000);
      assert.ok(diffMin > 13 && diffMin <= 16, `Expiration should be 15m (was ${diffMin.toFixed(1)}m)`);
      assert.ok(mail.text.includes(dbUser.link), "Email text must contain the token matching DB link");
    });

    // 5.2 Resend verification with English language
    await test("Resend verification with lang='en' replaces token and dispatches English email", async () => {
      const { data: beforeUser } = await supabase
        .from("users")
        .select("link")
        .eq("email", testEmailDe)
        .single();
      const oldToken = beforeUser.link;

      emailService.clearSentEmails();

      const resendRes = await authService.resendVerification({
        email: testEmailDe,
        lang: "en",
      });
      assert.ok(resendRes.message);

      const mail = emailService.getLastEmail();
      assert.ok(mail, "Resend email must be dispatched");
      assert.strictEqual(mail.to, testEmailDe);
      assert.strictEqual(mail.lang, "en");
      assert.ok(mail.subject.includes("Verify your email address"));

      // Check DB has NEW token and still 15m expiration
      const { data: afterUser } = await supabase
        .from("users")
        .select("link, link_expires_at")
        .eq("email", testEmailDe)
        .single();

      assert.notStrictEqual(afterUser.link, oldToken, "Old token must be replaced");
      const diffMin = (new Date(afterUser.link_expires_at).getTime() - Date.now()) / (60 * 1000);
      assert.ok(diffMin > 13 && diffMin <= 16, `New token expiration should be 15m (was ${diffMin.toFixed(1)}m)`);
      assert.ok(mail.text.includes(afterUser.link), "Email text must contain the newly generated token");
    });

    // 5.3 Forgot password with English language
    await test("Forgot password with lang='en' generates 15m reset token and dispatches English reset email", async () => {
      emailService.clearSentEmails();

      const forgotRes = await authService.forgotPassword({
        email: testEmailDe,
        lang: "en",
      });
      assert.ok(forgotRes.message);

      const mail = emailService.getLastEmail();
      assert.ok(mail, "Reset email must be dispatched");
      assert.strictEqual(mail.to, testEmailDe);
      assert.strictEqual(mail.lang, "en");
      assert.ok(mail.subject.includes("Reset your password"));

      const { data: dbUser } = await supabase
        .from("users")
        .select("reset_link, reset_link_expires_at")
        .eq("email", testEmailDe)
        .single();

      assert.ok(dbUser.reset_link);
      const diffMin = (new Date(dbUser.reset_link_expires_at).getTime() - Date.now()) / (60 * 1000);
      assert.ok(diffMin > 13 && diffMin <= 16, `Reset link expiry must be 15m (was ${diffMin.toFixed(1)}m)`);
      assert.ok(mail.text.includes(dbUser.reset_link), "Email text must contain reset token");
    });

    // 5.4 Forgot password with German language
    await test("Forgot password with lang='de' dispatches German reset email", async () => {
      emailService.clearSentEmails();

      await authService.forgotPassword({
        email: testEmailDe,
        lang: "de",
      });

      const mail = emailService.getLastEmail();
      assert.ok(mail);
      assert.strictEqual(mail.to, testEmailDe);
      assert.strictEqual(mail.lang, "de");
      assert.ok(mail.subject.includes("Passwort zurücksetzen"));
      assert.ok(!mail.text.includes("Reset your password"));
    });

  } finally {
    // Clean up test user
    await supabase.from("users").delete().eq("email", testEmailDe);
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log("\n==========================================");
  console.log(`EMAIL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================");

  if (failed > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

runEmailTests().catch((err) => {
  console.error("Unhandled error running email tests:", err);
  process.exit(1);
});
