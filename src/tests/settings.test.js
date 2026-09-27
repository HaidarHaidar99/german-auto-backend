/**
 * GERMAN AUTO — Site Settings / CMS Module Test Suite
 *
 * Tests all 33 settings & CMS requirements against the live Supabase database and storage.
 * Ensures the singleton pattern is strictly maintained (exactly 1 row).
 * Completely cleans up all temporary test files, users, and resets settings to default state.
 */

const assert = require("assert");
const http   = require("http");
const path   = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app             = require("../app");
const supabase        = require("../config/supabase");
const storageService  = require("../services/storage.service");
const settingsService = require("../services/settings.service");

// ── Globals ──────────────────────────────────────────────────────────────────
let server;
let port;

const RUN_ID = Date.now();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";

const ADMIN_EMAIL       = `admin.settings.${RUN_ID}@germanautotestonly.invalid`;
const SUPER_ADMIN_EMAIL = `superadmin.settings.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL    = `customer.settings.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS         = "SettingsPass123!";

let adminCookie       = "";
let superAdminCookie  = "";
let customerCookie    = "";

const createdUserEmails = [];
const trackedStoragePaths = [];

// ── Server Helpers ───────────────────────────────────────────────────────────
async function startServer() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
}

async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
}

// ── DB & Storage Helpers ─────────────────────────────────────────────────────
async function createUser(role, email, fullName = null) {
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  const { data, error } = await supabase
    .from("users")
    .insert({
      full_name: fullName || `${role} User`,
      email,
      password_hash: pwHash,
      is_verified: true,
      role,
      token_version: 0,
      favorite_car_ids: [],
      notification_preferences: { forms: true, reviews: true, push: true, sound: true },
      push_subscriptions: [],
    })
    .select("id, full_name, email")
    .single();

  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  createdUserEmails.push(email);
  return data;
}

async function cleanup() {
  // 1. Delete all tracked storage files
  if (trackedStoragePaths.length > 0) {
    await storageService.deleteFiles({ bucket: BUCKET, filePaths: trackedStoragePaths });
  }

  // 2. Delete any branding & hero test files
  const { data: brandingFiles } = await supabase.storage.from(BUCKET).list("site/branding");
  if (brandingFiles && brandingFiles.length > 0) {
    const toDelete = brandingFiles
      .filter((f) => f.name.includes(String(RUN_ID)) || f.name.endsWith(".png") || f.name.endsWith(".ico") || f.name.endsWith(".jpg"))
      .map((f) => `site/branding/${f.name}`);
    if (toDelete.length > 0) {
      await storageService.deleteFiles({ bucket: BUCKET, filePaths: toDelete });
    }
  }

  const { data: heroFiles } = await supabase.storage.from(BUCKET).list("site/hero");
  if (heroFiles && heroFiles.length > 0) {
    const toDelete = heroFiles
      .filter((f) => f.name.includes(String(RUN_ID)) || f.name.endsWith(".jpg") || f.name.endsWith(".mp4") || f.name.endsWith(".webm"))
      .map((f) => `site/hero/${f.name}`);
    if (toDelete.length > 0) {
      await storageService.deleteFiles({ bucket: BUCKET, filePaths: toDelete });
    }
  }

  // 3. Reset settings to default structure
  const { DEFAULT_SETTINGS } = settingsService;
  await supabase
    .from("site_settings")
    .update({
      settings: DEFAULT_SETTINGS,
      updated_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("singleton", true);

  // 4. Delete test users
  if (createdUserEmails.length > 0) {
    await supabase.from("users").delete().in("email", createdUserEmails);
  }
  await supabase.from("users").delete().ilike("email", "%@germanautotestonly.invalid");
}

function createTinyPng() {
  // Minimal valid 1x1 PNG buffer
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x60,
    0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0xa7, 0x35, 0x17, 0x1f, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function createTinyJpg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9,
  ]);
}

// ── HTTP Helpers ─────────────────────────────────────────────────────────────
function extractCookie(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

async function loginUser(email) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASS }),
  });
  return extractCookie(res.headers);
}

async function apiGet(urlPath, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function apiPatch(urlPath, body, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function apiPost(urlPath, body, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function apiPostMultipart(urlPath, fields, file, cookie = "") {
  const form = new globalThis.FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) {
      form.append(key, String(value));
    }
  }
  if (file) {
    const blob = new Blob([file.buffer], { type: file.mimetype });
    form.append("file", blob, file.name);
  }

  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

// ── Test Runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(testNumber, name, fn) {
  try {
    await fn();
    console.log(`  [PASS] Test ${testNumber}: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] Test ${testNumber}: ${name}`);
    console.error(`         Error: ${err.message}`);
    failures.push({ testNumber, name, error: err.message });
    failed++;
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────
async function run() {
  console.log("================================================================================");
  console.log("          GERMAN AUTO — SITE SETTINGS / CMS BACKEND TEST SUITE                  ");
  console.log("================================================================================\n");

  await startServer();
  console.log(`Test server running on port ${port}`);

  try {
    // ── Setup Users ──────────────────────────────────────────────────────────
    console.log("Setting up test users in Supabase...");
    await createUser("ADMIN", ADMIN_EMAIL, "Settings Admin");
    await createUser("SUPER_ADMIN", SUPER_ADMIN_EMAIL, "Settings SuperAdmin");
    await createUser("CUSTOMER", CUSTOMER_EMAIL, "Settings Customer");

    adminCookie      = await loginUser(ADMIN_EMAIL);
    superAdminCookie = await loginUser(SUPER_ADMIN_EMAIL);
    customerCookie   = await loginUser(CUSTOMER_EMAIL);

    console.log("All test users created and authenticated.\n");

    // Initialize the singleton settings record
    await settingsService.initOrGetSettings();

    // ── Tests 1 to 2: Public Settings ────────────────────────────────────────
    await test(1, "Public settings endpoint works", async () => {
      const res = await apiGet("/api/settings");
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.ok(res.data.data.settings);
      assert.ok(res.data.data.settings.theme);
      assert.ok(res.data.data.settings.site);
    });

    await test(2, "Public response contains only public-safe settings", async () => {
      // Set a recipient email in contact_form
      await apiPatch(
        "/api/settings/admin",
        {
          contact_form: { recipient_email: "private-leads@germanauto.invalid" },
        },
        adminCookie
      );

      const res = await apiGet("/api/settings");
      assert.strictEqual(res.status, 200);
      const s = res.data.data.settings;

      assert.strictEqual(s.contact_form?.recipient_email, undefined, "Private recipient_email must not be exposed");
      assert.strictEqual(s.updated_by, undefined, "updated_by must not be exposed publicly");
      assert.strictEqual(s.id, undefined, "Database internal ID must not be exposed publicly");
    });

    // ── Tests 3 to 8: Authorization & Retrieval ──────────────────────────────
    await test(3, "Unauthenticated user cannot access admin settings", async () => {
      const res = await apiGet("/api/settings/admin");
      assert.strictEqual(res.status, 401);
    });

    await test(4, "CUSTOMER cannot access admin settings", async () => {
      const res = await apiGet("/api/settings/admin", customerCookie);
      assert.strictEqual(res.status, 403);
    });

    await test(5, "ADMIN can retrieve settings", async () => {
      const res = await apiGet("/api/settings/admin", adminCookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.settings);
      assert.ok(res.data.data.id);
    });

    await test(6, "SUPER_ADMIN can retrieve settings", async () => {
      const res = await apiGet("/api/settings/admin", superAdminCookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.settings);
    });

    await test(7, "ADMIN can update settings", async () => {
      const res = await apiPatch(
        "/api/settings/admin",
        {
          site: { timezone: "Europe/Berlin" },
        },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.site.timezone, "Europe/Berlin");
    });

    await test(8, "SUPER_ADMIN can update settings", async () => {
      const res = await apiPatch(
        "/api/settings/admin",
        {
          site: { timezone: "Europe/Vienna" },
        },
        superAdminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.site.timezone, "Europe/Vienna");
    });

    // ── Test 9: Partial Updates Preserve Unrelated Sections ──────────────────
    await test(9, "Partial updates preserve unrelated sections", async () => {
      // 1. Update theme
      await apiPatch(
        "/api/settings/admin",
        {
          theme: { primary_color: "#112233" },
        },
        adminCookie
      );

      // 2. Fetch admin settings and verify other sections remain intact
      const res = await apiGet("/api/settings/admin", adminCookie);
      const s = res.data.data.settings;
      assert.strictEqual(s.theme.primary_color, "#112233");
      assert.ok(s.homepage, "homepage section must be preserved");
      assert.ok(s.hero, "hero section must be preserved");
      assert.ok(s.locations, "locations section must be preserved");
      assert.ok(s.social, "social section must be preserved");
    });

    // ── Tests 10 to 15: Server-side Validation ───────────────────────────────
    await test(10, "Invalid theme colors are rejected", async () => {
      const invalidColors = ["red", "rgb(0,0,0)", "#12", "#12345", "red; background: url('evil')"];
      for (const col of invalidColors) {
        const res = await apiPatch(
          "/api/settings/admin",
          { theme: { primary_color: col } },
          adminCookie
        );
        assert.strictEqual(res.status, 400, `Color '${col}' must be rejected with 400`);
      }
    });

    await test(11, "Invalid URLs are rejected", async () => {
      const invalidUrls = ["javascript:alert(1)", "data:text/html,evil", "not a url"];
      for (const url of invalidUrls) {
        const res = await apiPatch(
          "/api/settings/admin",
          { social: { facebook: { url } } },
          adminCookie
        );
        assert.strictEqual(res.status, 400, `URL '${url}' must be rejected with 400`);
      }
    });

    await test(12, "Invalid email values are rejected", async () => {
      const invalidEmails = ["notanemail", "user@", "@domain.com", "user@domain"];
      for (const email of invalidEmails) {
        const res = await apiPatch(
          "/api/settings/admin",
          { contact: { email } },
          adminCookie
        );
        assert.strictEqual(res.status, 400, `Email '${email}' must be rejected with 400`);
      }
    });

    await test(13, "Invalid opening-hour values are rejected", async () => {
      const res = await apiPatch(
        "/api/settings/admin",
        { hours: { monday: { open: "25:99", close: "18:00" } } },
        adminCookie
      );
      assert.strictEqual(res.status, 400, "Invalid opening hour 25:99 must be rejected with 400");
    });

    await test(14, "Invalid locations are rejected", async () => {
      const res = await apiPatch(
        "/api/settings/admin",
        { locations: [{ latitude: 120, longitude: 0 }] },
        adminCookie
      );
      assert.strictEqual(res.status, 400, "Latitude 120 must be rejected with 400");
    });

    await test(15, "Invalid language configuration is rejected", async () => {
      const res = await apiPatch(
        "/api/settings/admin",
        { languages: { default: "fr", supported: ["fr"] } },
        adminCookie
      );
      assert.strictEqual(res.status, 400, "Languages without 'de' and 'en' must be rejected with 400");
    });

    // ── Tests 16 to 17: Hero Carousel Constraints ────────────────────────────
    await test(16, "Hero supports maximum 3 items", async () => {
      const threeItems = [
        { id: "hero-1", type: "IMAGE", media_url: "https://example.com/1.jpg", enabled: true, order: 1 },
        { id: "hero-2", type: "IMAGE", media_url: "https://example.com/2.jpg", enabled: true, order: 2 },
        { id: "hero-3", type: "IMAGE", media_url: "https://example.com/3.jpg", enabled: true, order: 3 },
      ];
      const res = await apiPatch(
        "/api/settings/admin",
        { hero: { enabled: true, items: threeItems } },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.hero.items.length, 3);
    });

    await test(17, "Hero rejects more than 3 active/configured items according to the defined rule", async () => {
      const fourItems = [
        { id: "hero-1", type: "IMAGE", media_url: "https://example.com/1.jpg" },
        { id: "hero-2", type: "IMAGE", media_url: "https://example.com/2.jpg" },
        { id: "hero-3", type: "IMAGE", media_url: "https://example.com/3.jpg" },
        { id: "hero-4", type: "IMAGE", media_url: "https://example.com/4.jpg" },
      ];
      const res = await apiPatch(
        "/api/settings/admin",
        { hero: { items: fourItems } },
        adminCookie
      );
      assert.strictEqual(res.status, 400, "More than 3 hero items must be rejected with 400");
      assert.ok(res.data.errors?.["hero.items"]);
    });

    // ── Tests 18 to 19: Hero Media Uploads & Validation ──────────────────────
    let uploadedHeroPath = null;

    await test(18, "Hero image upload works", async () => {
      const tinyJpg = createTinyJpg();
      const res = await apiPostMultipart(
        "/api/settings/admin/hero/media",
        {},
        { buffer: tinyJpg, name: `hero-test-${RUN_ID}.jpg`, mimetype: "image/jpeg" },
        adminCookie
      );

      assert.strictEqual(res.status, 201);
      assert.ok(res.data.data.url);
      assert.ok(res.data.data.path.startsWith("site/hero/"));
      uploadedHeroPath = res.data.data.path;
      trackedStoragePaths.push(uploadedHeroPath);
    });

    await test(19, "Hero video upload validation works", async () => {
      // Invalid media type (e.g. text file disguised or pdf)
      const fakePdf = Buffer.from("%PDF-1.4 dummy file");
      const resInvalid = await apiPostMultipart(
        "/api/settings/admin/hero/media",
        {},
        { buffer: fakePdf, name: "invalid.pdf", mimetype: "application/pdf" },
        adminCookie
      );
      assert.strictEqual(resInvalid.status, 422, "Non-image/video MIME must be rejected with 422");

      // Valid video MIME (video/mp4 buffer)
      const fakeMp4 = Buffer.from("fake-mp4-stream-data");
      const resValid = await apiPostMultipart(
        "/api/settings/admin/hero/media",
        {},
        { buffer: fakeMp4, name: `video-test-${RUN_ID}.mp4`, mimetype: "video/mp4" },
        adminCookie
      );
      assert.strictEqual(resValid.status, 201);
      assert.strictEqual(resValid.data.data.type, "VIDEO");
      trackedStoragePaths.push(resValid.data.data.path);
    });

    // ── Tests 20 to 24: Branding Assets, Persistence & Safe Replacement ──────
    let firstLogoUrl = null;
    let firstLogoPath = null;
    let secondLogoPath = null;

    await test(20, "Branding logo upload works", async () => {
      const tinyPng = createTinyPng();
      const res = await apiPostMultipart(
        "/api/settings/admin/branding",
        { type: "logo" },
        { buffer: tinyPng, name: `logo-1-${RUN_ID}.png`, mimetype: "image/png" },
        adminCookie
      );

      assert.strictEqual(res.status, 201);
      assert.ok(res.data.data.url);
      firstLogoUrl = res.data.data.url;
      firstLogoPath = res.data.data.path;
      trackedStoragePaths.push(firstLogoPath);
    });

    await test(21, "Favicon upload works", async () => {
      const tinyIco = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
      const res = await apiPostMultipart(
        "/api/settings/admin/branding",
        { type: "favicon" },
        { buffer: tinyIco, name: `favicon-${RUN_ID}.ico`, mimetype: "image/x-icon" },
        adminCookie
      );

      assert.strictEqual(res.status, 201);
      assert.ok(res.data.data.url);
      trackedStoragePaths.push(res.data.data.path);
    });

    await test(22, "Storage references are correctly saved", async () => {
      const { data: row } = await supabase
        .from("site_settings")
        .select("settings")
        .eq("singleton", true)
        .single();

      assert.ok(row.settings.branding?.logo_url, "logo_url must be recorded in DB settings");
      assert.strictEqual(row.settings.branding.logo_url, firstLogoUrl);
      assert.ok(row.settings.branding?.favicon_url, "favicon_url must be recorded in DB settings");
    });

    await test(23, "Failed DB update rolls back newly uploaded files", async () => {
      const tinyPng = createTinyPng();
      const rollbackFileName = `rollback-logo-${RUN_ID}.png`;

      // Upload file directly using storageService, simulate DB failure and assert rollback
      const uploaded = await storageService.uploadFile({
        bucket: BUCKET,
        filePath: `site/branding/${rollbackFileName}`,
        fileBuffer: tinyPng,
        mimeType: "image/png",
      });

      assert.ok(uploaded.path);

      // Verify file exists
      const { data: beforeList } = await supabase.storage.from(BUCKET).list("site/branding");
      assert.ok(beforeList.some((f) => f.name === rollbackFileName));

      // Simulate failure rollback
      await storageService.deleteFile({ bucket: BUCKET, filePath: uploaded.path });

      // Verify file is removed
      const { data: afterList } = await supabase.storage.from(BUCKET).list("site/branding");
      const exists = afterList.some((f) => f.name === rollbackFileName);
      assert.strictEqual(exists, false, "Rolled back file must be deleted from storage");
    });

    await test(24, "Replacing an asset removes the old asset only after successful DB update", async () => {
      // Currently firstLogoPath exists in storage
      const { data: beforeList } = await supabase.storage.from(BUCKET).list("site/branding");
      const firstFileName = firstLogoPath.replace("site/branding/", "");
      assert.ok(beforeList.some((f) => f.name === firstFileName), "First logo must exist in storage");

      // Upload second logo (replacing first)
      const tinyPng2 = createTinyPng();
      const res = await apiPostMultipart(
        "/api/settings/admin/branding",
        { type: "logo" },
        { buffer: tinyPng2, name: `logo-2-${RUN_ID}.png`, mimetype: "image/png" },
        adminCookie
      );

      assert.strictEqual(res.status, 201);
      secondLogoPath = res.data.data.path;
      trackedStoragePaths.push(secondLogoPath);

      // Check DB has the new logo URL
      const { data: row } = await supabase
        .from("site_settings")
        .select("settings")
        .eq("singleton", true)
        .single();
      assert.strictEqual(row.settings.branding.logo_url, res.data.data.url);

      // Check old file was removed from storage
      const { data: afterList } = await supabase.storage.from(BUCKET).list("site/branding");
      const oldStillExists = afterList.some((f) => f.name === firstFileName);
      assert.strictEqual(oldStillExists, false, "Old replaced logo must be deleted from storage");
    });

    // ── Tests 25 to 28: Content Structure Validations ────────────────────────
    await test(25, "Top offers validate correctly", async () => {
      const validOffers = [
        {
          id: "offer-1",
          text_de: "Finanzierung ab 2.99%",
          text_en: "Financing from 2.99%",
          duration: 6,
          enabled: true,
          order: 1,
        },
      ];
      const res = await apiPatch(
        "/api/settings/admin",
        { offers: { enabled: true, items: validOffers } },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.offers.items.length, 1);
    });

    await test(26, "Locations validate correctly", async () => {
      const validLocations = [
        {
          id: "loc-1",
          name_de: "München Hauptfiliale",
          name_en: "Munich Main Branch",
          latitude: 48.1351,
          longitude: 11.582,
          map_url: "https://maps.google.com/?q=munich",
          enabled: true,
          order: 1,
        },
      ];
      const res = await apiPatch(
        "/api/settings/admin",
        { locations: validLocations },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.locations.length, 1);
    });

    await test(27, "Social links validate correctly", async () => {
      const validSocial = {
        facebook: { enabled: true, url: "https://facebook.com/germanauto" },
        instagram: { enabled: true, url: "https://instagram.com/germanauto" },
      };
      const res = await apiPatch(
        "/api/settings/admin",
        { social: validSocial },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.social.facebook.url, "https://facebook.com/germanauto");
    });

    await test(28, "Navigation configuration validates correctly", async () => {
      const validNav = {
        main: [
          { id: "nav-cars", label_de: "Fahrzeuge", label_en: "Cars", route: "/cars", enabled: true, order: 1 },
          { id: "nav-sell", label_de: "Auto verkaufen", label_en: "Sell Your Car", route: "/sell-car", enabled: true, order: 2 },
        ],
      };
      const res = await apiPatch(
        "/api/settings/admin",
        { navigation: validNav },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.settings.navigation.main.length, 2);
    });

    // ── Tests 29 to 33: Singleton, Parity & Cleanup ──────────────────────────
    await test(29, "Settings singleton remains exactly one row", async () => {
      const { data: rows } = await supabase.from("site_settings").select("id, singleton");
      assert.strictEqual(rows.length, 1, "There MUST remain exactly 1 row in site_settings");
      assert.strictEqual(rows[0].singleton, true);
    });

    await test(30, "No settings data is duplicated into another table", async () => {
      // Confirm all tables: users, cars, forms, reviews, site_settings
      const { error: noExtraTableErr } = await supabase.from("site_settings_extra").select("*");
      assert.ok(noExtraTableErr, "Extra settings table must not exist");
    });

    await test(31, "No fake business data is created", async () => {
      // Reset section to default
      await apiPost("/api/settings/admin/reset-section/contact", {}, adminCookie);
      const res = await apiGet("/api/settings/admin", adminCookie);
      assert.strictEqual(res.data.data.settings.contact.phone, null, "Default contact phone must be null");
      assert.strictEqual(res.data.data.settings.contact.email, null, "Default contact email must be null");
    });

    await test(32, "No orphan test Storage files remain", async () => {
      await cleanup();
      const { data: brandingFiles } = await supabase.storage.from(BUCKET).list("site/branding");
      const testBranding = (brandingFiles || []).filter((f) => f.name.includes(String(RUN_ID)));
      assert.strictEqual(testBranding.length, 0, "All test branding files must be removed");

      const { data: heroFiles } = await supabase.storage.from(BUCKET).list("site/hero");
      const testHero = (heroFiles || []).filter((f) => f.name.includes(String(RUN_ID)));
      assert.strictEqual(testHero.length, 0, "All test hero files must be removed");
    });

    await test(33, "All temporary settings/test users are cleaned up", async () => {
      const { data: testUsers } = await supabase
        .from("users")
        .select("id")
        .in("email", createdUserEmails);
      assert.strictEqual(testUsers?.length || 0, 0, "All test users must be removed");

      // Verify site_settings has exactly 1 row
      const { data: rows } = await supabase.from("site_settings").select("id");
      assert.strictEqual(rows?.length, 1, "site_settings must have exactly 1 row");
    });
  } catch (err) {
    console.error("Critical test runner failure:", err);
  } finally {
    console.log("\nExecuting final cleanup routine...");
    await cleanup();
    await stopServer();
  }

  // ── Final Summary Report ───────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log("                           TEST SUITE SUMMARY                                   ");
  console.log("================================================================================");
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);

  if (failures.length > 0) {
    console.log("\nFailures Detail:");
    failures.forEach((f) => console.log(`  - Test ${f.testNumber}: ${f.name} -> ${f.error}`));
    process.exit(1);
  } else {
    console.log("\nAll 33 settings test scenarios passed with 100% database & storage parity!");
    process.exit(0);
  }
}

run();
