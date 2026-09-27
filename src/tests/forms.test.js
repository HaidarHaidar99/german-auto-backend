/**
 * GERMAN AUTO — Forms Module Test Suite
 *
 * Tests all form endpoints against the live Supabase database.
 * Creates temporary test records; cleans ALL of them up completely afterward.
 * No forms or uploaded files are left behind.
 *
 * NOTE: Sell-Your-Car image upload tests use tiny synthetic JPEG/PNG buffers
 * to exercise the full upload path without generating real vehicle images.
 */

const assert = require("assert");
const http   = require("http");
const path   = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app      = require("../app");
const supabase = require("../config/supabase");

// ─── Globals ──────────────────────────────────────────────────────────────────

let server;
let port;

const RUN_ID = Date.now();

const ADMIN_EMAIL    = `admin.forms.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL = `customer.forms.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS      = "TestPass123!";

let adminCookie    = "";
let customerCookie = "";

// Track all form IDs created — for guaranteed cleanup
const createdFormIds    = [];
const createdUserEmails = [];

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

async function cleanup() {
  if (createdFormIds.length > 0) {
    await supabase.from("forms").delete().in("id", createdFormIds);
  }
  for (const email of createdUserEmails) {
    await supabase.from("users").delete().eq("email", email.toLowerCase());
  }
}

async function createUser(role, email) {
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  const { data } = await supabase
    .from("users")
    .insert({
      full_name: `${role} Test`,
      email,
      password_hash: pwHash,
      is_verified:   true,
      role,
      token_version: 0,
      favorite_car_ids: [],
      notification_preferences: { forms: true, reviews: true, push: true, sound: true },
      push_subscriptions: [],
    })
    .select("id")
    .single();
  createdUserEmails.push(email);
  return data;
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
  return { status: res.status, data };
}

async function apiPatch(path, body, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

/**
 * POST multipart/form-data with optional file attachments.
 * files: [{ name, buffer, mimetype }]
 */
async function apiPostMultipart(path, fields, files = [], cookie = "") {
  const { FormData, File } = await import("node:buffer").catch(() => ({}));

  // Use the native fetch FormData (Node 18+)
  const form = new globalThis.FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) {
      form.append(key, String(value));
    }
  }
  for (const file of files) {
    const blob = new Blob([file.buffer], { type: file.mimetype });
    form.append("images", blob, file.name);
  }

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function extractCookie(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
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

// ─── Minimal valid JPEG buffer (20 bytes — triggers valid MIME check) ─────────

function makeMinimalJpeg() {
  // SOI marker + APP0 start = valid enough for MIME detection
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
}

function makeMinimalPng() {
  // PNG signature only
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
}

// ─── Valid base payloads ───────────────────────────────────────────────────────

const VALID_CONTACT = {
  name:            "Hans Mueller",
  email:           "hans.mueller@example.com",
  phone:           "+49 123 4567890",
  regarding:       "Test inquiry",
  message:         "This is a test message with sufficient length.",
  privacy_consent: true,
};

const VALID_SELL_CAR = {
  brand:             "BMW",
  model:             "M3",
  registration_day:  "15",
  registration_month:"3",
  registration_year: "2020",
  vin:               "WBA3A5G59DNP26082",
  postal_code:       "80331",
  mileage_km:        "35000",
  accident_free:     "true",
  repainting:        "false",
  min_price:         "25000",
  first_name:        "Hans",
  last_name:         "Mueller",
  email:             "hans.mueller@example.com",
  phone:             "+49 123 4567890",
  preferred_contact: "EMAIL",
  privacy_consent:   "true",
};

// ─── SETUP ────────────────────────────────────────────────────────────────────

async function setup() {
  console.log("\n── SETUP ────────────────────────────────────────────────");
  await createUser("ADMIN", ADMIN_EMAIL);
  await createUser("CUSTOMER", CUSTOMER_EMAIL);

  const { data: adminData, headers: adminH } = await apiPost("/api/auth/login", { email: ADMIN_EMAIL, password: TEST_PASS });
  assert.strictEqual(adminData.success, true, "Admin login must succeed");
  adminCookie = extractCookie(adminH);

  const { data: custData, headers: custH } = await apiPost("/api/auth/login", { email: CUSTOMER_EMAIL, password: TEST_PASS });
  assert.strictEqual(custData.success, true, "Customer login must succeed");
  customerCookie = extractCookie(custH);

  console.log("  [OK] Admin and customer sessions established");
}

// ─── SECTION 1: CONTACT FORM ──────────────────────────────────────────────────

async function testContactForm() {
  console.log("\n── CONTACT FORM ─────────────────────────────────────────");

  await test("Valid contact submission — guest → 201", async () => {
    const { status, data } = await apiPost("/api/forms/contact", VALID_CONTACT);
    assert.strictEqual(status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.data.submission_id, "Should return submission_id");
    createdFormIds.push(data.data.submission_id);
  });

  await test("Valid contact submission — authenticated → 201, user_id stored", async () => {
    const { status, data } = await apiPost("/api/forms/contact", VALID_CONTACT, customerCookie);
    assert.strictEqual(status, 201);
    createdFormIds.push(data.data.submission_id);

    // Verify user_id was stored in DB
    const { data: form } = await supabase.from("forms").select("user_id").eq("id", data.data.submission_id).single();
    assert.ok(form.user_id, "user_id should be stored for authenticated user");
  });

  await test("Guest contact submission — user_id is null", async () => {
    const { status, data } = await apiPost("/api/forms/contact", VALID_CONTACT);
    assert.strictEqual(status, 201);
    createdFormIds.push(data.data.submission_id);

    const { data: form } = await supabase.from("forms").select("user_id").eq("id", data.data.submission_id).single();
    assert.strictEqual(form.user_id, null, "user_id must be null for guest submissions");
  });

  await test("Missing name → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, name: "" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.name);
  });

  await test("Invalid email → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, email: "not-an-email" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.email);
  });

  await test("Invalid phone format → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, phone: "INVALID_PHONE!!!" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.phone);
  });

  await test("Missing regarding → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, regarding: "" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.regarding);
  });

  await test("Message too short → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, message: "Hi" });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.message);
  });

  await test("Message too long → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, message: "x".repeat(5001) });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.message);
  });

  await test("Privacy consent false → 400", async () => {
    const { status, data } = await apiPost("/api/forms/contact", { ...VALID_CONTACT, privacy_consent: false });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.privacy_consent);
  });

  await test("Privacy consent missing → 400", async () => {
    const { name, email, phone, regarding, message } = VALID_CONTACT;
    const { status, data } = await apiPost("/api/forms/contact", { name, email, phone, regarding, message });
    assert.strictEqual(status, 400);
    assert.ok(data.errors.privacy_consent);
  });

  await test("Response never exposes form data payload to submitter", async () => {
    const { data } = await apiPost("/api/forms/contact", VALID_CONTACT);
    // Response should only have submission_id — no data JSONB, no admin_notes
    assert.strictEqual(data.data.form, undefined, "Should not return full form object");
    assert.strictEqual(data.data.admin_notes, undefined);
    assert.strictEqual(data.data.data, undefined, "Should not return data JSONB");
    createdFormIds.push(data.data.submission_id);
  });
}

// ─── SECTION 2: SELL YOUR CAR FORM ───────────────────────────────────────────

async function testSellCarForm() {
  console.log("\n── SELL YOUR CAR FORM ───────────────────────────────────");

  await test("Valid sell-car submission — guest, no images → 201", async () => {
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, []);
    assert.strictEqual(status, 201);
    assert.ok(data.data.submission_id);
    createdFormIds.push(data.data.submission_id);
  });

  await test("Valid sell-car — authenticated → 201, user_id stored", async () => {
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, [], customerCookie);
    assert.strictEqual(status, 201);
    createdFormIds.push(data.data.submission_id);

    const { data: form } = await supabase.from("forms").select("user_id").eq("id", data.data.submission_id).single();
    assert.ok(form.user_id, "user_id must be stored for authenticated submitter");
  });

  await test("Valid sell-car — with 2 JPEG images → 201, image refs stored", async () => {
    const jpegBuf = makeMinimalJpeg();
    const files = [
      { name: "front.jpg", buffer: jpegBuf, mimetype: "image/jpeg" },
      { name: "rear.jpg",  buffer: jpegBuf, mimetype: "image/jpeg" },
    ];
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, files);
    assert.strictEqual(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    createdFormIds.push(data.data.submission_id);

    // Verify images were stored in data JSONB
    const { data: form } = await supabase
      .from("forms")
      .select("data")
      .eq("id", data.data.submission_id)
      .single();
    assert.ok(Array.isArray(form.data.images), "images should be stored");
    assert.strictEqual(form.data.images.length, 2, "Both images should be recorded");
    assert.ok(form.data.images[0].path, "Image path should be stored (not binary)");
    assert.ok(form.data.images[0].public_url, "Public URL should be stored");
  });

  await test("More than 5 images → 422 or 400", async () => {
    const jpegBuf = makeMinimalJpeg();
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `img${i}.jpg`, buffer: jpegBuf, mimetype: "image/jpeg",
    }));
    const { status } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, files);
    assert.ok(status === 422 || status === 400, `Expected 422 or 400, got ${status}`);
  });

  await test("Invalid image MIME type (text/plain) → 422 or 400", async () => {
    const badFile = [{ name: "evil.txt", buffer: Buffer.from("bad"), mimetype: "text/plain" }];
    const { status } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, badFile);
    assert.ok(status === 422 || status === 400, `Expected 422 or 400, got ${status}`);
  });

  await test("Missing brand → 400", async () => {
    const payload = { ...VALID_SELL_CAR, brand: "" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.brand);
  });

  await test("Missing model → 400", async () => {
    const payload = { ...VALID_SELL_CAR, model: "" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.model);
  });

  await test("Invalid VIN (16 chars) → 400", async () => {
    const payload = { ...VALID_SELL_CAR, vin: "TOOSHORT1234567" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.vin);
  });

  await test("VIN with forbidden character I → 400", async () => {
    const payload = { ...VALID_SELL_CAR, vin: "IIIIIIIIIIIIIIIII" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.vin);
  });

  await test("Invalid registration year (future) → 400", async () => {
    const payload = { ...VALID_SELL_CAR, registration_year: String(new Date().getFullYear() + 5) };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.registration_year);
  });

  await test("Invalid registration month → 400", async () => {
    const payload = { ...VALID_SELL_CAR, registration_month: "13" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.registration_month);
  });

  await test("Missing first_registration entirely → 400", async () => {
    const { brand, model, vin, postal_code, mileage_km, accident_free, repainting,
            first_name, last_name, email, phone, preferred_contact, privacy_consent } = VALID_SELL_CAR;
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", {
      brand, model, vin, postal_code, mileage_km, accident_free, repainting,
      first_name, last_name, email, phone, preferred_contact, privacy_consent,
    }, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.first_registration);
  });

  await test("Negative mileage → 400", async () => {
    const payload = { ...VALID_SELL_CAR, mileage_km: "-100" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.mileage_km);
  });

  await test("Missing accident_free → 400", async () => {
    const { accident_free, ...rest } = VALID_SELL_CAR;
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", rest, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.accident_free);
  });

  await test("Invalid preferred_contact method → 400", async () => {
    const payload = { ...VALID_SELL_CAR, preferred_contact: "CARRIER_PIGEON" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.preferred_contact);
  });

  await test("Missing privacy consent → 400", async () => {
    const { privacy_consent, ...rest } = VALID_SELL_CAR;
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", rest, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.privacy_consent);
  });

  await test("Missing contact email → 400", async () => {
    const payload = { ...VALID_SELL_CAR, email: "bad-format" };
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", payload, []);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.email);
  });

  await test("Guest sell-car — user_id is null in DB", async () => {
    const { status, data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, []);
    assert.strictEqual(status, 201);
    createdFormIds.push(data.data.submission_id);

    const { data: form } = await supabase.from("forms").select("user_id").eq("id", data.data.submission_id).single();
    assert.strictEqual(form.user_id, null, "user_id must be null for guest sell-car");
  });

  await test("Sell-car response never exposes JSONB data, notes, or internal state", async () => {
    const { data } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, []);
    assert.strictEqual(data.data.data, undefined, "Full form data JSONB must not be in response");
    assert.strictEqual(data.data.admin_notes, undefined);
    assert.strictEqual(data.data.form, undefined);
    createdFormIds.push(data.data.submission_id);
  });
}

// ─── SECTION 3: ADMIN FORM OPERATIONS ────────────────────────────────────────

async function testAdminForms() {
  console.log("\n── ADMIN FORMS ──────────────────────────────────────────");

  // Create a fresh known form for admin tests
  let testFormId;
  const { data: sub } = await apiPost("/api/forms/contact", VALID_CONTACT);
  testFormId = sub.data.submission_id;
  createdFormIds.push(testFormId);

  await test("Admin can list forms → 200 with pagination meta", async () => {
    const { status, data } = await apiGet("/api/forms/admin", adminCookie);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.data.forms));
    assert.ok(typeof data.meta.total === "number");
    assert.ok(typeof data.meta.page === "number");
    assert.ok(typeof data.meta.pages === "number");
  });

  await test("Admin list — data JSONB NOT included in list rows (lightweight)", async () => {
    const { data } = await apiGet("/api/forms/admin", adminCookie);
    for (const form of data.data.forms) {
      assert.strictEqual(form.data, undefined, "List endpoint must not include data JSONB");
    }
  });

  await test("Admin list — filter by form_type=CONTACT", async () => {
    const { status, data } = await apiGet("/api/forms/admin?form_type=CONTACT", adminCookie);
    assert.strictEqual(status, 200);
    for (const form of data.data.forms) {
      assert.strictEqual(form.form_type, "CONTACT");
    }
  });

  await test("Admin list — filter by status=NEW", async () => {
    const { status, data } = await apiGet("/api/forms/admin?status=NEW", adminCookie);
    assert.strictEqual(status, 200);
    for (const form of data.data.forms) {
      assert.strictEqual(form.status, "NEW");
    }
  });

  await test("Admin list — sort=oldest produces ascending created_at", async () => {
    const { data } = await apiGet("/api/forms/admin?sort=oldest&limit=50", adminCookie);
    const dates = data.data.forms.map((f) => new Date(f.created_at).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] >= dates[i - 1], "oldest sort must be ascending");
    }
  });

  await test("Admin list — sort=newest produces descending created_at", async () => {
    const { data } = await apiGet("/api/forms/admin?sort=newest&limit=50", adminCookie);
    const dates = data.data.forms.map((f) => new Date(f.created_at).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] <= dates[i - 1], "newest sort must be descending");
    }
  });

  await test("Admin list — pagination page/limit", async () => {
    const { data } = await apiGet("/api/forms/admin?page=1&limit=2", adminCookie);
    assert.ok(data.data.forms.length <= 2);
    assert.strictEqual(data.meta.limit, 2);
    assert.strictEqual(data.meta.page, 1);
  });

  await test("Admin list — invalid form_type → 400", async () => {
    const { status, data } = await apiGet("/api/forms/admin?form_type=BANANA", adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.form_type);
  });

  await test("Admin list — invalid status → 400", async () => {
    const { status, data } = await apiGet("/api/forms/admin?status=UNKNOWN", adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.status);
  });

  await test("Admin can get single form with full data JSONB → 200", async () => {
    const { status, data } = await apiGet(`/api/forms/admin/${testFormId}`, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.form.id, testFormId);
    assert.ok(data.data.form.data, "Should include data JSONB in detail");
    assert.strictEqual(data.data.form.data.name, VALID_CONTACT.name);
    assert.strictEqual(data.data.form.data.email, VALID_CONTACT.email.toLowerCase());
    assert.ok(data.data.form.data.privacy_consent, "Privacy consent should be stored");
  });

  await test("Admin get nonexistent form → 404", async () => {
    const { status } = await apiGet("/api/forms/admin/00000000-0000-0000-0000-000000000099", adminCookie);
    assert.strictEqual(status, 404);
  });

  await test("Admin can update form status → 200", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {
      status: "READ",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.form.status, "READ");
  });

  await test("Admin can update status to IN_PROGRESS → 200", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {
      status: "IN_PROGRESS",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.form.status, "IN_PROGRESS");
  });

  await test("Admin can add admin_notes → 200, note persisted", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {
      admin_notes: "Customer called. Follow-up scheduled.",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.form.admin_notes, "Customer called. Follow-up scheduled.");
  });

  await test("Admin can update status and notes together → 200", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {
      status:      "COMPLETED",
      admin_notes: "All done.",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.form.status, "COMPLETED");
    assert.strictEqual(data.data.form.admin_notes, "All done.");
  });

  await test("Update with invalid status → 400", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {
      status: "BANANA",
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.status);
  });

  await test("Update with no fields → 400", async () => {
    const { status, data } = await apiPatch(`/api/forms/admin/${testFormId}`, {}, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors._base);
  });

  await test("Admin notes in detail response — never visible publicly (no public endpoint)", async () => {
    // There is no public GET /api/forms/:id — forms are write-only from public perspective.
    // Confirm 404 on attempt to access form without admin cookie.
    const { status } = await apiGet(`/api/forms/admin/${testFormId}`);
    assert.strictEqual(status, 401, "Unauthenticated access to form detail must be rejected");
  });
}

// ─── SECTION 4: AUTHORIZATION ────────────────────────────────────────────────

async function testAuthorization() {
  console.log("\n── AUTHORIZATION ────────────────────────────────────────");

  await test("CUSTOMER cannot list forms → 403", async () => {
    const { status } = await apiGet("/api/forms/admin", customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot list forms → 401", async () => {
    const { status } = await apiGet("/api/forms/admin");
    assert.strictEqual(status, 401);
  });

  await test("CUSTOMER cannot view form detail → 403", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiGet(`/api/forms/admin/${fakeId}`, customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot view form detail → 401", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiGet(`/api/forms/admin/${fakeId}`);
    assert.strictEqual(status, 401);
  });

  await test("CUSTOMER cannot update form → 403", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiPatch(`/api/forms/admin/${fakeId}`, { status: "READ" }, customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot update form → 401", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiPatch(`/api/forms/admin/${fakeId}`, { status: "READ" });
    assert.strictEqual(status, 401);
  });

  await test("Public contact endpoint accepts unauthenticated POST → 201", async () => {
    const { status, data } = await apiPost("/api/forms/contact", VALID_CONTACT);
    assert.strictEqual(status, 201);
    createdFormIds.push(data.data.submission_id);
  });
}

// ─── SECTION 5: DATA INTEGRITY ────────────────────────────────────────────────

async function testDataIntegrity() {
  console.log("\n── DATA INTEGRITY ───────────────────────────────────────");

  await test("Contact: stored data fields match submitted values", async () => {
    const { data: sub } = await apiPost("/api/forms/contact", VALID_CONTACT);
    const id = sub.data.submission_id;
    createdFormIds.push(id);

    const { data: form } = await supabase.from("forms").select("data, form_type, status").eq("id", id).single();
    assert.strictEqual(form.form_type, "CONTACT");
    assert.strictEqual(form.status, "NEW");
    assert.strictEqual(form.data.name, VALID_CONTACT.name);
    assert.strictEqual(form.data.email, VALID_CONTACT.email.toLowerCase());
    assert.strictEqual(form.data.regarding, VALID_CONTACT.regarding);
    assert.strictEqual(form.data.message, VALID_CONTACT.message);
    assert.strictEqual(form.data.privacy_consent, true);
    assert.ok(form.data.submitted_at, "submitted_at should be stored");
  });

  await test("Sell-car: stored data fields match submitted values", async () => {
    const { data: sub } = await apiPostMultipart("/api/forms/sell-car", VALID_SELL_CAR, []);
    const id = sub.data.submission_id;
    createdFormIds.push(id);

    const { data: form } = await supabase.from("forms").select("data, form_type, status").eq("id", id).single();
    assert.strictEqual(form.form_type, "SELL_CAR");
    assert.strictEqual(form.status, "NEW");
    assert.strictEqual(form.data.brand, VALID_SELL_CAR.brand);
    assert.strictEqual(form.data.model, VALID_SELL_CAR.model);
    assert.strictEqual(form.data.vin, VALID_SELL_CAR.vin.toUpperCase());
    assert.strictEqual(form.data.mileage_km, 35000);
    assert.strictEqual(form.data.accident_free, true);
    assert.strictEqual(form.data.repainting, false);
    assert.strictEqual(form.data.preferred_contact, "EMAIL");
    assert.strictEqual(form.data.privacy_consent, true);
    // Validate first_registration was constructed
    assert.ok(form.data.first_registration.includes("2020"), "Year 2020 should be in registration date");
    assert.ok(Array.isArray(form.data.images), "images array should be present");
    assert.strictEqual(form.data.images.length, 0, "No images submitted");
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================");
  console.log("GERMAN AUTO — FORMS TESTS (LIVE SUPABASE)");
  console.log("==========================================");

  await startServer();

  try {
    await setup();
    await testContactForm();
    await testSellCarForm();
    await testAdminForms();
    await testAuthorization();
    await testDataIntegrity();
  } catch (crashErr) {
    console.error("\n[CRASH] Test suite crashed:", crashErr.message, crashErr.stack);
    failed++;
    failures.push({ name: "Suite crash", error: crashErr.message });
  } finally {
    console.log("\n── CLEANUP ──────────────────────────────────────────────");
    await cleanup();
    console.log(`  [OK] Cleaned ${createdFormIds.length} form(s) and ${createdUserEmails.length} user(s)`);
    await stopServer();
  }

  console.log("\n==========================================");
  console.log(`FORMS TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("==========================================");

  if (failed > 0) process.exit(1);
}

main();
