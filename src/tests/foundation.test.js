const assert = require("assert");
const http = require("http");
const path = require("path");

const backendDir = path.resolve(__dirname, "../..");
require(path.join(backendDir, "node_modules/dotenv")).config({ path: path.join(backendDir, ".env") });

const app = require("../app");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken, verifyToken, getAuthCookieOptions } = require("../utils/jwt.util");
const { generateRandomToken, hashToken } = require("../utils/token.util");
const emailService = require("../services/email.service");
const storageService = require("../services/storage.service");

async function runTests() {
  console.log("==========================================");
  console.log("STARTING BACKEND FOUNDATION TESTS");
  console.log("==========================================");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Password utility test
  await testAsync("Password Hashing & Verification (bcryptjs)", async () => {
    const raw = "SuperSecretP@ss123";
    const hash = await hashPassword(raw);
    assert.ok(hash && hash.startsWith("$2"), "Hash should start with $2");
    const valid = await comparePassword(raw, hash);
    assert.strictEqual(valid, true, "Valid password should match");
    const invalid = await comparePassword("WrongPassword", hash);
    assert.strictEqual(invalid, false, "Invalid password should fail");
  });

  // 2. JWT utility test
  test("JWT Sign, Verify & Cookie Options", () => {
    const payload = { id: "user-123", role: "CUSTOMER", token_version: 0 };
    const token = signToken(payload);
    assert.ok(token && typeof token === "string", "Token should be a string");
    const decoded = verifyToken(token);
    assert.strictEqual(decoded.id, "user-123");
    assert.strictEqual(decoded.role, "CUSTOMER");
    assert.strictEqual(decoded.token_version, 0);

    const cookieOpts = getAuthCookieOptions();
    assert.strictEqual(cookieOpts.httpOnly, true, "Cookie must be HttpOnly");
    assert.strictEqual(cookieOpts.path, "/", "Cookie path must be root");
    assert.ok(cookieOpts.maxAge > 0, "Cookie maxAge must be positive");
  });

  // 3. Cryptographic Token Generation test
  test("Random Token Generation (crypto)", () => {
    const token1 = generateRandomToken();
    const token2 = generateRandomToken();
    assert.strictEqual(token1.length, 64, "Token must be 64 hex characters");
    assert.notStrictEqual(token1, token2, "Subsequent tokens must be unique");
    const hashed = hashToken(token1);
    assert.strictEqual(hashed.length, 64, "Hashed token must be 64 hex characters");
  });

  // 4. Email Service Abstraction test (Verification & Password Reset in DE & EN)
  await testAsync("Email Service Abstraction Dispatch (German & English)", async () => {
    emailService.clearSentEmails();

    // German verification email
    const deRes = await emailService.sendVerificationEmail({
      email: "kunde@example.de",
      fullName: "Max Mustermann",
      token: "sample-token-de-123",
      lang: "de",
    });
    assert.strictEqual(deRes.success, true, "German verification dispatch should succeed");

    const deMail = emailService.getLastEmail();
    assert.strictEqual(deMail.to, "kunde@example.de");
    assert.ok(deMail.subject.includes("Bestätigen Sie Ihre E-Mail-Adresse"), "Subject must be German");
    assert.ok(deMail.text.includes("/verify?token=sample-token-de-123"), "Text must contain verify URL");
    assert.ok(deMail.text.includes("15 Minuten"), "Text must specify 15-minute validity");
    assert.ok(!deMail.text.includes("Please verify"), "German email must not contain mixed English text");

    // English verification email
    const enRes = await emailService.sendVerificationEmail({
      email: "customer@example.com",
      fullName: "John Doe",
      token: "sample-token-en-456",
      lang: "en",
    });
    assert.strictEqual(enRes.success, true, "English verification dispatch should succeed");

    const enMail = emailService.getLastEmail();
    assert.strictEqual(enMail.to, "customer@example.com");
    assert.ok(enMail.subject.includes("Verify your email address"), "Subject must be English");
    assert.ok(enMail.text.includes("/verify?token=sample-token-en-456"), "Text must contain verify URL");
    assert.ok(enMail.text.includes("15 minutes"), "Text must specify 15-minute validity");
    assert.ok(!enMail.text.includes("Bestätigen Sie"), "English email must not contain mixed German text");

    // German password reset email
    const deResetRes = await emailService.sendPasswordResetEmail({
      email: "kunde@example.de",
      fullName: "Max Mustermann",
      token: "reset-token-de-789",
      lang: "de",
    });
    assert.strictEqual(deResetRes.success, true, "German password reset dispatch should succeed");
    const deResetMail = emailService.getLastEmail();
    assert.ok(deResetMail.subject.includes("Passwort zurücksetzen"), "Reset subject must be German");
    assert.ok(deResetMail.text.includes("/reset-password?token=reset-token-de-789"), "Text must contain reset URL");
    assert.ok(deResetMail.text.includes("15 Minuten"), "Reset text must specify 15-minute validity");

    // English password reset email
    const enResetRes = await emailService.sendPasswordResetEmail({
      email: "customer@example.com",
      fullName: "John Doe",
      token: "reset-token-en-012",
      lang: "en",
    });
    assert.strictEqual(enResetRes.success, true, "English password reset dispatch should succeed");
    const enResetMail = emailService.getLastEmail();
    assert.ok(enResetMail.subject.includes("Reset your password"), "Reset subject must be English");
    assert.ok(enResetMail.text.includes("/reset-password?token=reset-token-en-012"), "Text must contain reset URL");
    assert.ok(enResetMail.text.includes("15 minutes"), "Reset text must specify 15-minute validity");
  });

  // 5. Storage Service Abstraction test
  test("Storage Service Media Validation & URL Helper", () => {
    const validImg = storageService.validateFile({
      mimeType: "image/webp",
      sizeBytes: 1024 * 1024,
      category: "IMAGE",
    });
    assert.strictEqual(validImg.valid, true, "WebP image should be valid");

    const invalidType = storageService.validateFile({
      mimeType: "application/x-executable",
      sizeBytes: 1024,
      category: "IMAGE",
    });
    assert.strictEqual(invalidType.valid, false, "Executable should be rejected");

    const oversized = storageService.validateFile({
      mimeType: "image/jpeg",
      sizeBytes: 50 * 1024 * 1024,
      category: "IMAGE",
    });
    assert.strictEqual(oversized.valid, false, "50MB image should be rejected");

    const publicUrl = storageService.getPublicUrl({
      bucket: "german-auto-media",
      filePath: "cars/uuid/main.webp",
    });
    assert.ok(publicUrl.includes("german-auto-media"), "Public URL should contain bucket name");
  });

  // 6. HTTP Server & Route Integration tests
  await testAsync("HTTP Server: Health Check (GET /)", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.status, "healthy");

      // Verify Helmet security headers
      assert.ok(res.headers.get("x-content-type-options"), "Should have X-Content-Type-Options");
      assert.ok(res.headers.get("x-frame-options"), "Should have X-Frame-Options");
    } finally {
      server.close();
    }
  });

  await testAsync("HTTP Server: 404 Route Not Found (GET /api/unknown)", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/unknown`);
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(data.message.includes("Route not found"));
    } finally {
      server.close();
    }
  });

  await testAsync("HTTP Server: Auth Signup Validation (POST /api/auth/signup)", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid-email", password: "123" }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(data.errors.full_name, "Should flag missing full_name");
      assert.ok(data.errors.email, "Should flag invalid email");
      assert.ok(data.errors.password, "Should flag short password");
    } finally {
      server.close();
    }
  });

  await testAsync("HTTP Server: Auth Login Validation (POST /api/auth/login)", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(data.errors.email, "Should flag invalid email");
      assert.ok(data.errors.password, "Should flag missing password");
    } finally {
      server.close();
    }
  });

  console.log("==========================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
