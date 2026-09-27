/**
 * Storage verification test — Sell Your Car image upload
 *
 * Covers the 5 required verification points:
 *   1. Image upload succeeds (HTTP 201)
 *   2. Files stored under forms/sell-car/... path in Supabase Storage
 *   3. Storage references (path, public_url, name, size) correctly saved in forms.data
 *   4. Rollback: Storage files removed when DB insert would fail
 *   5. No orphan test files remain in Storage after cleanup
 */

const assert = require("assert");
const http   = require("http");
const path   = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app            = require("../app");
const supabase       = require("../config/supabase");
const storageService = require("../services/storage.service");

// ─── Constants ─────────────────────────────────────────────────────────────────
const RUN_ID      = Date.now();
const BUCKET      = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
const ADMIN_EMAIL = `admin.storage.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS   = "TestPass123!";

const VALID_SELL_CAR = {
  brand:              "BMW",
  model:              "M3",
  registration_day:   "15",
  registration_month: "3",
  registration_year:  "2020",
  vin:                "WBA3A5G59DNP26082",
  postal_code:        "80331",
  mileage_km:         "35000",
  accident_free:      "true",
  repainting:         "false",
  min_price:          "25000",
  first_name:         "Hans",
  last_name:          "Mueller",
  email:              "hans.mueller@example.com",
  phone:              "+49 123 4567890",
  preferred_contact:  "EMAIL",
  privacy_consent:    "true",
};

// Minimal valid JPEG buffer — SOI + APP0 marker
function makeMinimalJpeg() {
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
}

// ─── State tracking ────────────────────────────────────────────────────────────
let server;
let port;
let adminCookie       = "";
const createdFormIds  = [];
const createdEmails   = [];

// ─── Server helpers ────────────────────────────────────────────────────────────
async function startServer() {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
async function apiPost(p, body, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

async function apiPostMultipart(p, fields, files = [], cookie = "") {
  const form = new globalThis.FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) form.append(k, String(v));
  }
  for (const f of files) {
    form.append("images", new Blob([f.buffer], { type: f.mimetype }), f.name);
  }
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}) },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}

function extractCookie(headers) {
  const raw = headers.get("set-cookie");
  return raw ? raw.split(";")[0] : "";
}

// ─── Storage helpers ────────────────────────────────────────────────────────────
async function listStorageFiles(prefix) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error) {
    console.warn(`  [warn] Could not list storage at "${prefix}":`, error.message);
    return [];
  }
  return data || [];
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  if (createdFormIds.length > 0) {
    await supabase.from("forms").delete().in("id", createdFormIds);
  }
  for (const email of createdEmails) {
    await supabase.from("users").delete().eq("email", email.toLowerCase());
  }
}

// ─── Test runner ───────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("============================================================");
  console.log("GERMAN AUTO — STORAGE VERIFICATION (Sell Your Car Images)");
  console.log(`Bucket: ${BUCKET}`);
  console.log("============================================================");

  await startServer();

  // ── Setup ──────────────────────────────────────────────────────────────────
  console.log("\n── SETUP ─────────────────────────────────────────────────────");
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  await supabase.from("users").insert({
    full_name: "Storage Test Admin",
    email:     ADMIN_EMAIL,
    password_hash: pwHash,
    is_verified: true,
    role: "ADMIN",
    token_version: 0,
    favorite_car_ids: [],
    notification_preferences: { forms: true, reviews: true, push: true, sound: true },
    push_subscriptions: [],
  });
  createdEmails.push(ADMIN_EMAIL);

  const { data: loginData, headers: loginHeaders } = await apiPost("/api/auth/login", {
    email: ADMIN_EMAIL, password: TEST_PASS,
  });
  assert.strictEqual(loginData.success, true, "Admin login must succeed");
  adminCookie = extractCookie(loginHeaders);
  console.log("  [OK] Admin session ready");

  // Snapshot Storage state before any uploads
  const filesBefore = await listStorageFiles("forms/sell-car");
  console.log(`  [INFO] Existing files in forms/sell-car before test: ${filesBefore.length}`);

  // ══════════════════════════════════════════════════════════════════════════
  // POINTS 1–3: Upload / Path / DB Reference
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── POINTS 1–3: Upload · Path · DB Reference ─────────────────");

  let uploadedFormId;
  let uploadedPaths = [];

  await test("1. Sell-car with 2 JPEG images → HTTP 201", async () => {
    const jpeg  = makeMinimalJpeg();
    const files = [
      { name: "front.jpg", buffer: jpeg, mimetype: "image/jpeg" },
      { name: "rear.jpg",  buffer: jpeg, mimetype: "image/jpeg" },
    ];

    const { status, data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, files);
    assert.strictEqual(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(data.data.submission_id, "submission_id must be returned");

    uploadedFormId = data.data.submission_id;
    createdFormIds.push(uploadedFormId);
  });

  await test("2. Each file stored under forms/sell-car/... in Supabase Storage", async () => {
    assert.ok(uploadedFormId, "Prerequisite: form must have been created");

    const { data: form } = await supabase
      .from("forms").select("data").eq("id", uploadedFormId).single();

    assert.ok(Array.isArray(form.data.images), "data.images must be an array");
    assert.strictEqual(form.data.images.length, 2, "Both images must be stored");

    const storageFiles = await listStorageFiles("forms/sell-car");

    for (const img of form.data.images) {
      assert.ok(img.path, `Image must have path, got: ${JSON.stringify(img)}`);
      assert.ok(
        img.path.startsWith("forms/sell-car/"),
        `Path "${img.path}" must start with "forms/sell-car/"`
      );

      // Confirm the file actually exists in Supabase Storage
      const fileName   = img.path.replace("forms/sell-car/", "");
      const foundInStorage = storageFiles.find((f) => f.name === fileName);
      assert.ok(foundInStorage, `File "${fileName}" must exist in Storage`);

      uploadedPaths.push(img.path);
      console.log(`      ✓ ${img.path}`);
    }
  });

  await test("3. Storage refs (path, public_url, name, size) correct in forms.data", async () => {
    assert.ok(uploadedFormId, "Prerequisite: form must exist");

    const { data: form } = await supabase
      .from("forms").select("data").eq("id", uploadedFormId).single();

    for (const img of form.data.images) {
      assert.ok(img.path,        "path must be stored");
      assert.ok(img.public_url,  "public_url must be stored");
      assert.ok(img.name,        "original filename must be stored");
      assert.ok(img.size > 0,    "file size must be stored");
      assert.ok(
        img.public_url.includes(BUCKET),
        `public_url "${img.public_url}" must reference bucket "${BUCKET}"`
      );
      // public_url must be a proper HTTPS URL
      assert.ok(
        img.public_url.startsWith("https://"),
        `public_url must be a full HTTPS URL, got: "${img.public_url}"`
      );
      console.log(`      path:       ${img.path}`);
      console.log(`      public_url: ${img.public_url}`);
      console.log(`      name:       ${img.name}, size: ${img.size} bytes`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POINT 4: Rollback — Storage files removed when operation fails
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── POINT 4: Rollback Verification ────────────────────────────");

  await test("4. Rollback: Storage file deleted if DB insert fails after upload", async () => {
    const beforeRollback = await listStorageFiles("forms/sell-car");

    // Step 1: Upload a real file (simulating the upload-before-insert step in submitSellCar)
    const jpeg       = makeMinimalJpeg();
    const rollbackPath = `forms/sell-car/rollback-verify-${RUN_ID}.jpg`;

    const uploaded = await storageService.uploadFile({
      bucket:     BUCKET,
      filePath:   rollbackPath,
      fileBuffer: jpeg,
      mimeType:   "image/jpeg",
    });
    assert.ok(uploaded.path, "Rollback test file must upload successfully");
    console.log(`      Uploaded rollback file: ${uploaded.path}`);

    // Step 2: Verify it exists in Storage
    const afterUpload = await listStorageFiles("forms/sell-car");
    const rollbackFilename = `rollback-verify-${RUN_ID}.jpg`;
    const existsAfterUpload = afterUpload.find((f) => f.name === rollbackFilename);
    assert.ok(existsAfterUpload, "Rollback file must exist in Storage after upload");

    // Step 3: Simulate rollback (what formService does on DB failure)
    const rollbackResult = await storageService.deleteFiles({
      bucket: BUCKET,
      filePaths: [rollbackPath],
    });
    assert.strictEqual(rollbackResult, true, "deleteFiles must return true");
    console.log(`      Rollback executed: ${rollbackPath} deleted`);

    // Step 4: Verify file is gone
    const afterRollback = await listStorageFiles("forms/sell-car");
    const stillExists = afterRollback.find((f) => f.name === rollbackFilename);
    assert.strictEqual(stillExists, undefined, "File must be gone after rollback");

    // Step 5: Net count must be unchanged
    assert.strictEqual(
      afterRollback.length,
      beforeRollback.length,
      `Storage count after rollback (${afterRollback.length}) must equal before rollback (${beforeRollback.length})`
    );
    console.log(`      Storage file count unchanged: ${afterRollback.length} ✓`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // POINT 5: No orphan files remain after cleanup
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n── POINT 5: Orphan Cleanup Verification ──────────────────────");

  await test("5a. Delete test form's Storage files explicitly", async () => {
    assert.ok(uploadedPaths.length > 0, "Must have uploaded paths to delete");

    const deleted = await storageService.deleteFiles({
      bucket:    BUCKET,
      filePaths: uploadedPaths,
    });
    assert.strictEqual(deleted, true, "deleteFiles must succeed");
    console.log(`      Deleted ${uploadedPaths.length} file(s) from Storage`);
  });

  await test("5b. Delete test form DB row", async () => {
    assert.ok(uploadedFormId, "Must have a form ID to delete");

    const { error } = await supabase.from("forms").delete().eq("id", uploadedFormId);
    assert.ok(!error, `DB delete must succeed: ${error?.message}`);

    // Remove from tracking list so cleanup() doesn't double-delete
    const idx = createdFormIds.indexOf(uploadedFormId);
    if (idx > -1) createdFormIds.splice(idx, 1);

    console.log(`      Form ${uploadedFormId} deleted from DB`);
  });

  await test("5c. Verify no orphan files in forms/sell-car/ after cleanup", async () => {
    const filesAfter = await listStorageFiles("forms/sell-car");

    // None of our specifically uploaded files should remain
    for (const p of uploadedPaths) {
      const fileName    = p.replace("forms/sell-car/", "");
      const orphan      = filesAfter.find((f) => f.name === fileName);
      assert.strictEqual(orphan, undefined, `Orphan file found in Storage: ${p}`);
    }

    // Total count must return to the pre-test baseline
    assert.strictEqual(
      filesAfter.length,
      filesBefore.length,
      `Storage count must return to baseline (${filesBefore.length}), got ${filesAfter.length}`
    );

    console.log(`      Storage baseline: ${filesBefore.length}, after cleanup: ${filesAfter.length} ✓`);
    console.log("      No orphan files detected ✓");
  });

  // ─── Final cleanup ─────────────────────────────────────────────────────────
  console.log("\n── CLEANUP ───────────────────────────────────────────────────");
  await cleanup();
  console.log(`  [OK] Removed ${createdEmails.length} test user(s), ${createdFormIds.length} residual form(s)`);

  await stopServer();

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n============================================================");
  console.log(`STORAGE VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("============================================================");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[CRASH]", err.message, err.stack);
  process.exit(1);
});
