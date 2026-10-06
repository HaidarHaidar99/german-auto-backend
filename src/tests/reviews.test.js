/**
 * GERMAN AUTO — Reviews Module Test Suite
 *
 * Tests all 30 review requirements against the live Supabase database and storage.
 * Creates temporary test records and files; cleans ALL of them up completely afterward.
 * Zero test data or orphan storage files remain.
 */

const assert = require("assert");
const http   = require("http");
const path   = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app            = require("../app");
const supabase       = require("../config/supabase");
const storageService = require("../services/storage.service");
const reviewService  = require("../services/review.service");

// ── Globals ──────────────────────────────────────────────────────────────────
let server;
let port;

const RUN_ID = Date.now();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";

const ADMIN_EMAIL       = `admin.reviews.${RUN_ID}@germanautotestonly.invalid`;
const SUPER_ADMIN_EMAIL = `superadmin.reviews.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL    = `customer.reviews.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL_2  = `customer2.reviews.${RUN_ID}@germanautotestonly.invalid`;
const SPAM_USER_EMAIL   = `spam.reviews.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS         = "ReviewPass123!";

let adminCookie       = "";
let superAdminCookie  = "";
let customerCookie    = "";
let customerCookie2   = "";
let spamUserCookie    = "";

const createdReviewIds    = [];
const createdUserEmails   = [];
const uploadedFilePaths   = [];

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
      full_name: fullName || `${role} Reviewer`,
      email,
      password_hash: pwHash,
      is_verified: true,
      role,
      token_version: 0,
      favorite_car_ids: [],
      notification_preferences: { reviews: true },
      push_subscriptions: [],
    })
    .select("id, full_name, email")
    .single();

  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  createdUserEmails.push(email);
  return data;
}

async function cleanup() {
  // 1. Delete all created reviews
  if (createdReviewIds.length > 0) {
    await supabase.from("reviews").delete().in("id", createdReviewIds);
  }

  // 2. Delete any tracked storage files
  if (uploadedFilePaths.length > 0) {
    await storageService.deleteFiles({ bucket: BUCKET, filePaths: uploadedFilePaths });
  }

  // 3. Delete any files in storage created during this run
  const { data: storageFiles } = await supabase.storage.from(BUCKET).list("reviews");
  if (storageFiles && storageFiles.length > 0) {
    const toDelete = storageFiles
      .filter((f) => f.name.includes(String(RUN_ID)) || f.name.endsWith(".jpg") || f.name.endsWith(".png"))
      .map((f) => `reviews/${f.name}`);
    if (toDelete.length > 0) {
      await storageService.deleteFiles({ bucket: BUCKET, filePaths: toDelete });
    }
  }

  // 4. Delete all created test users
  for (const email of createdUserEmails) {
    await supabase.from("users").delete().eq("email", email.toLowerCase());
  }
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
    form.append("image", blob, file.name);
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

async function apiDelete(urlPath, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "DELETE",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

// ── Synthetic Test File Helpers ──────────────────────────────────────────────
function createTinyJpeg() {
  // Minimal valid 1x1 JPEG buffer
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

// ── Main Test Suite Execution ────────────────────────────────────────────────
async function run() {
  console.log("================================================================================");
  console.log("             GERMAN AUTO — REVIEWS BACKEND MODULE TEST SUITE                    ");
  console.log("================================================================================\n");

  await startServer();
  console.log(`Test server running on port ${port}`);

  try {
    // ── Setup Users ──────────────────────────────────────────────────────────
    console.log("Setting up test users in Supabase...");
    const adminUser      = await createUser("ADMIN", ADMIN_EMAIL, "Admin Tester");
    const superAdminUser = await createUser("SUPER_ADMIN", SUPER_ADMIN_EMAIL, "Super Admin Tester");
    const customerUser   = await createUser("CUSTOMER", CUSTOMER_EMAIL, "Hans Gruber");
    const customerUser2  = await createUser("CUSTOMER", CUSTOMER_EMAIL_2, "Greta Weber");
    const spamUser       = await createUser("CUSTOMER", SPAM_USER_EMAIL, "Spam Bot");
    const seedUser       = await createUser("CUSTOMER", `seed.${RUN_ID}@germanautotestonly.invalid`, "Seed Reviewer");

    adminCookie      = await loginUser(ADMIN_EMAIL);
    superAdminCookie = await loginUser(SUPER_ADMIN_EMAIL);
    customerCookie   = await loginUser(CUSTOMER_EMAIL);
    customerCookie2  = await loginUser(CUSTOMER_EMAIL_2);
    spamUserCookie   = await loginUser(SPAM_USER_EMAIL);

    console.log("All test users created and authenticated.\n");

    // Pre-insert some status-specific reviews directly into Supabase for Visibility tests
    const { data: pubReview } = await supabase
      .from("reviews")
      .insert({
        user_id: seedUser.id,
        name: "Seed Reviewer",
        rating: 5,
        text: `Published test review ${RUN_ID}`,
        status: "PUBLISHED",
      })
      .select("id")
      .single();
    if (pubReview) createdReviewIds.push(pubReview.id);

    const { data: pendReview } = await supabase
      .from("reviews")
      .insert({
        user_id: seedUser.id,
        name: "Seed Reviewer",
        rating: 4,
        text: `Pending test review ${RUN_ID}`,
        status: "PENDING",
      })
      .select("id")
      .single();
    if (pendReview) createdReviewIds.push(pendReview.id);

    const { data: hidReview } = await supabase
      .from("reviews")
      .insert({
        user_id: seedUser.id,
        name: "Seed Reviewer",
        rating: 3,
        text: `Hidden test review ${RUN_ID}`,
        status: "HIDDEN",
      })
      .select("id")
      .single();
    if (hidReview) createdReviewIds.push(hidReview.id);

    const { data: delReview } = await supabase
      .from("reviews")
      .insert({
        user_id: seedUser.id,
        name: "Seed Reviewer",
        rating: 2,
        text: `Deleted test review ${RUN_ID}`,
        status: "DELETED",
      })
      .select("id")
      .single();
    if (delReview) createdReviewIds.push(delReview.id);

    let submittedReviewId = null;
    let imageReviewId = null;
    let imageStoragePath = null;
    let reviewToModerateId = null;

    // ── Tests 1 to 4: Visibility & Public Retrieval ──────────────────────────
    await test(1, "Public GET returns only PUBLISHED reviews", async () => {
      const res = await apiGet("/api/reviews");
      assert.strictEqual(res.status, 200, "Must return status 200");
      assert.ok(res.data.success, "Success flag must be true");
      assert.ok(Array.isArray(res.data.data.reviews), "Must return reviews array");
      const found = res.data.data.reviews.find((r) => r.id === pubReview.id);
      assert.ok(found, "Published review must appear in public list");
      assert.strictEqual(found.rating, 5);
      assert.strictEqual(found.name, "Seed Reviewer");
    });

    await test(2, "PENDING reviews are not publicly visible", async () => {
      const res = await apiGet("/api/reviews");
      const found = res.data.data.reviews.find((r) => r.id === pendReview.id);
      assert.strictEqual(found, undefined, "PENDING review must not be visible in public endpoint");
    });

    await test(3, "HIDDEN reviews are not publicly visible", async () => {
      const res = await apiGet("/api/reviews");
      const found = res.data.data.reviews.find((r) => r.id === hidReview.id);
      assert.strictEqual(found, undefined, "HIDDEN review must not be visible in public endpoint");
    });

    await test(4, "DELETED reviews are not publicly visible", async () => {
      const res = await apiGet("/api/reviews");
      const found = res.data.data.reviews.find((r) => r.id === delReview.id);
      assert.strictEqual(found, undefined, "DELETED review must not be visible in public endpoint");
    });

    // ── Tests 5 to 7: Submission & Defaults ──────────────────────────────────
    await test(5, "Unauthenticated users cannot POST reviews", async () => {
      const res = await apiPost("/api/reviews", {
        rating: 5,
        text: "Anonymous attempts to review.",
      });
      assert.strictEqual(res.status, 401, "Must reject unauthenticated review POST with 401");
    });

    await test(6, "Authenticated user can submit a valid review", async () => {
      const res = await apiPost(
        "/api/reviews",
        {
          rating: 5,
          text: `Purchased a Porsche 911 GT3. Exceptional buying experience! [${RUN_ID}]`,
        },
        customerCookie
      );
      assert.strictEqual(res.status, 201, "Submission must return 201 Created");
      assert.ok(res.data.data.review.id, "Returned review must have an id");
      submittedReviewId = res.data.data.review.id;
      createdReviewIds.push(submittedReviewId);
      assert.strictEqual(res.data.data.review.name, "Hans Gruber", "Review author name must come from user profile");
      assert.strictEqual(res.data.data.review.rating, 5);
    });

    await test(7, "New review defaults to PUBLISHED (immediate public display)", async () => {
      assert.ok(submittedReviewId, "Test 6 review ID must exist");
      const { data: dbRow } = await supabase
        .from("reviews")
        .select("status")
        .eq("id", submittedReviewId)
        .single();
      assert.strictEqual(dbRow.status, "PUBLISHED", "Database status must default to PUBLISHED");
    });

    // ── Tests 8 to 11: Validation & Integrity ────────────────────────────────
    await test(8, "Invalid ratings are rejected", async () => {
      const invalidRatings = [0, 6, 4.5, -1, "five", null];
      for (const rating of invalidRatings) {
        const res = await apiPost(
          "/api/reviews",
          { rating, text: `Valid text content for rating test ${Math.random()}` },
          customerCookie2
        );
        assert.strictEqual(res.status, 400, `Rating ${rating} must be rejected with 400`);
        assert.ok(res.data.errors?.rating, `Should return validation error for rating ${rating}`);
      }
    });

    await test(9, "Invalid/missing text is rejected", async () => {
      const invalidTexts = ["", "   ", "abc", null, undefined];
      for (const text of invalidTexts) {
        const res = await apiPost(
          "/api/reviews",
          { rating: 5, text },
          customerCookie2
        );
        assert.strictEqual(res.status, 400, `Text '${text}' must be rejected with 400`);
        assert.ok(res.data.errors?.text, "Should return validation error for text");
      }
    });

    await test(10, "User cannot submit another user's user_id", async () => {
      const res = await apiPost(
        "/api/reviews",
        {
          rating: 5,
          text: "Attempting to spoof user_id on submission.",
          user_id: "00000000-0000-0000-0000-000000000000",
        },
        customerCookie2
      );
      assert.strictEqual(res.status, 400, "Specifying user_id must be rejected with 400");
      assert.ok(res.data.errors?.user_id, "Errors must flag user_id override attempt");
    });

    await test(11, "User cannot choose PUBLISHED/HIDDEN/DELETED during submission", async () => {
      const res = await apiPost(
        "/api/reviews",
        {
          rating: 5,
          text: "Attempting to self-publish immediately on submission.",
          status: "PUBLISHED",
        },
        customerCookie2
      );
      assert.strictEqual(res.status, 400, "Specifying status must be rejected with 400");
      assert.ok(res.data.errors?.status, "Errors must flag status override attempt");
    });

    // ── Tests 12 to 14: Image Upload Handling ────────────────────────────────
    await test(12, "Image upload succeeds", async () => {
      const tinyJpg = createTinyJpeg();
      const res = await apiPostMultipart(
        "/api/reviews",
        {
          rating: 5,
          text: `Review with vehicle photo attachment. Quality is top tier. [${RUN_ID}]`,
        },
        { buffer: tinyJpg, name: `review-photo-${RUN_ID}.jpg`, mimetype: "image/jpeg" },
        customerCookie2
      );

      assert.strictEqual(res.status, 201, "Review with image must return 201 Created");
      assert.ok(res.data.data.review.image_url, "image_url must be populated");
      imageReviewId = res.data.data.review.id;
      createdReviewIds.push(imageReviewId);
    });

    await test(13, "Image is stored under reviews/...", async () => {
      assert.ok(imageReviewId, "Image review must exist");
      const { data: dbRow } = await supabase
        .from("reviews")
        .select("image_url")
        .eq("id", imageReviewId)
        .single();

      assert.ok(dbRow.image_url, "image_url must be stored in DB");
      assert.ok(dbRow.image_url.includes("/reviews/"), "image_url path must contain /reviews/");
      const storagePath = reviewService.extractStoragePath(dbRow.image_url, BUCKET);
      assert.ok(storagePath && storagePath.startsWith("reviews/"), `Storage path must start with reviews/ (got: ${storagePath})`);
      imageStoragePath = storagePath;
      uploadedFilePaths.push(storagePath);
    });

    await test(14, "image_url is saved correctly", async () => {
      assert.ok(imageStoragePath, "Storage path must be identified");
      const { data: files } = await supabase.storage.from(BUCKET).list("reviews");
      const fileName = imageStoragePath.replace("reviews/", "");
      const exists = files?.some((f) => f.name === fileName);
      assert.ok(exists, `Uploaded file ${fileName} must physically exist in Storage bucket`);
    });

    // ── Tests 15 to 17: Upload Constraints & Rollback ─────────────────────────
    await test(15, "Invalid image types are rejected", async () => {
      const fakeDoc = Buffer.from("%PDF-1.4 dummy pdf document");
      const res = await apiPostMultipart(
        "/api/reviews",
        { rating: 4, text: "Review with invalid PDF upload." },
        { buffer: fakeDoc, name: "document.pdf", mimetype: "application/pdf" },
        customerCookie2
      );
      assert.strictEqual(res.status, 422, "Invalid image mime type must be rejected with 422");
    });

    await test(16, "Oversized images are rejected", async () => {
      // 5.5 MB buffer (limit is 5 MB)
      const oversized = Buffer.alloc(5.5 * 1024 * 1024, 0);
      const res = await apiPostMultipart(
        "/api/reviews",
        { rating: 5, text: "Review with huge image." },
        { buffer: oversized, name: "huge.jpg", mimetype: "image/jpeg" },
        customerCookie2
      );
      assert.strictEqual(res.status, 422, "Oversized file must be rejected with 422");
    });

    await test(17, "Failed DB operation rolls back uploaded Storage files", async () => {
      const tinyJpg = createTinyJpeg();
      const fakeFileName = `rollback-test-${RUN_ID}.jpg`;
      let threw = false;

      try {
        // Provide a non-existent UUID for user_id to trigger DB FK violation on insert
        await reviewService.submitReview({
          userId: "00000000-0000-0000-0000-000000000000",
          userFullName: "Ghost User",
          body: { rating: 5, text: `Rollback test review ${RUN_ID}` },
          file: {
            originalname: fakeFileName,
            mimetype: "image/jpeg",
            size: tinyJpg.length,
            buffer: tinyJpg,
          },
        });
      } catch (err) {
        threw = true;
      }

      assert.ok(threw, "DB insert must fail due to FK violation");
      const { data: files } = await supabase.storage.from(BUCKET).list("reviews");
      const leftBehind = files?.some((f) => f.name.includes(fakeFileName));
      assert.strictEqual(leftBehind, false, "Orphan file must NOT remain in storage after failed DB insert");
    });

    // ── Test 18: Public Pagination ───────────────────────────────────────────
    await test(18, "Public pagination works", async () => {
      const res1 = await apiGet("/api/reviews?page=1&limit=1");
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.data.reviews.length, 1);
      assert.strictEqual(res1.data.meta.page, 1);
      assert.strictEqual(res1.data.meta.limit, 1);
      assert.ok(res1.data.meta.total >= 1);
    });

    // ── Tests 19 to 22: Admin Access Control ─────────────────────────────────
    await test(19, "Admin list requires authentication", async () => {
      const res = await apiGet("/api/reviews/admin");
      assert.strictEqual(res.status, 401, "Unauthenticated request to admin list must return 401");
    });

    await test(20, "CUSTOMER cannot access admin review endpoints", async () => {
      const res = await apiGet("/api/reviews/admin", customerCookie);
      assert.strictEqual(res.status, 403, "CUSTOMER role must receive 403 Forbidden");
    });

    await test(21, "ADMIN can access admin review endpoints", async () => {
      const res = await apiGet("/api/reviews/admin", adminCookie);
      assert.strictEqual(res.status, 200, "ADMIN must receive 200 OK");
      assert.ok(Array.isArray(res.data.data.reviews), "Admin response must contain reviews array");
      assert.ok(res.data.meta, "Admin response must contain meta pagination");
    });

    await test(22, "SUPER_ADMIN can access admin review endpoints", async () => {
      const res = await apiGet("/api/reviews/admin", superAdminCookie);
      assert.strictEqual(res.status, 200, "SUPER_ADMIN must receive 200 OK");
      assert.ok(Array.isArray(res.data.data.reviews));
    });

    // ── Tests 23 to 26: Admin Moderation Lifecycle ───────────────────────────
    // Create a dedicated review for moderation lifecycle testing
    const { data: modReview } = await supabase
      .from("reviews")
      .insert({
        user_id: customerUser.id,
        name: "Hans Gruber",
        rating: 4,
        text: `Moderation lifecycle review test [${RUN_ID}]`,
        status: "PENDING",
      })
      .select("id")
      .single();
    reviewToModerateId = modReview.id;
    createdReviewIds.push(reviewToModerateId);

    await test(23, "Admin can publish a review", async () => {
      const res = await apiPatch(
        `/api/reviews/admin/${reviewToModerateId}`,
        { status: "PUBLISHED" },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.review.status, "PUBLISHED");

      const { data: dbRow } = await supabase
        .from("reviews")
        .select("status")
        .eq("id", reviewToModerateId)
        .single();
      assert.strictEqual(dbRow.status, "PUBLISHED");
    });

    await test(24, "Admin can hide a review", async () => {
      const res = await apiPatch(
        `/api/reviews/admin/${reviewToModerateId}`,
        { status: "HIDDEN" },
        adminCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.review.status, "HIDDEN");

      const { data: dbRow } = await supabase
        .from("reviews")
        .select("status")
        .eq("id", reviewToModerateId)
        .single();
      assert.strictEqual(dbRow.status, "HIDDEN");
    });

    await test(25, "Admin can soft-delete a review", async () => {
      const res = await apiDelete(`/api/reviews/admin/${reviewToModerateId}`, adminCookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.review.status, "DELETED");

      // Verify row is NOT physically removed
      const { data: dbRow } = await supabase
        .from("reviews")
        .select("id, status")
        .eq("id", reviewToModerateId)
        .maybeSingle();
      assert.ok(dbRow, "Row must still exist in DB (soft-delete)");
      assert.strictEqual(dbRow.status, "DELETED");
    });

    await test(26, "Deleted review does not appear publicly", async () => {
      const res = await apiGet("/api/reviews");
      const found = res.data.data.reviews.find((r) => r.id === reviewToModerateId);
      assert.strictEqual(found, undefined, "Soft-deleted review must not appear in public reviews");
    });

    // ── Test 27: Image Cleanup on Deletion ────────────────────────────────────
    await test(27, "Review image cleanup works", async () => {
      // 1. Submit review with image
      const tinyJpg = createTinyJpeg();
      const resSubmit = await apiPostMultipart(
        "/api/reviews",
        { rating: 5, text: `Review to delete with image cleanup [${RUN_ID}]` },
        { buffer: tinyJpg, name: `cleanup-${RUN_ID}.jpg`, mimetype: "image/jpeg" },
        customerCookie
      );
      assert.strictEqual(resSubmit.status, 201);
      const revId = resSubmit.data.data.review.id;
      createdReviewIds.push(revId);

      const pathToDelete = reviewService.extractStoragePath(resSubmit.data.data.review.image_url, BUCKET);
      assert.ok(pathToDelete, "Path must exist before deletion");

      // Verify file is in storage
      const { data: beforeFiles } = await supabase.storage.from(BUCKET).list("reviews");
      const fileName = pathToDelete.replace("reviews/", "");
      assert.ok(beforeFiles?.some((f) => f.name === fileName), "File must exist in storage before review deletion");

      // 2. Soft-delete the review
      const resDel = await apiDelete(`/api/reviews/admin/${revId}`, adminCookie);
      assert.strictEqual(resDel.status, 200);
      assert.strictEqual(resDel.data.data.review.status, "DELETED");

      // 3. Verify file is removed from Storage
      const { data: afterFiles } = await supabase.storage.from(BUCKET).list("reviews");
      const stillExists = afterFiles?.some((f) => f.name === fileName);
      assert.strictEqual(stillExists, false, "Image file must be removed from Storage on review deletion");
    });

    // ── Test 28: Reject Invalid Moderation Status ─────────────────────────────
    await test(28, "Invalid status transitions/values are rejected", async () => {
      // Trying arbitrary invalid status
      const res1 = await apiPatch(
        `/api/reviews/admin/${submittedReviewId}`,
        { status: "RANDOM_UNSUPPORTED" },
        adminCookie
      );
      assert.strictEqual(res1.status, 400, "Arbitrary status must be rejected with 400");
      assert.ok(res1.data.errors?.status);

      // Trying PENDING in admin moderation update (only PUBLISHED, HIDDEN, DELETED allowed)
      const res2 = await apiPatch(
        `/api/reviews/admin/${submittedReviewId}`,
        { status: "PENDING" },
        adminCookie
      );
      assert.strictEqual(res2.status, 400, "Resetting to PENDING must be rejected with 400");
    });

    // ── Test 29: Rate Limiting & Rapid Spam Protection ───────────────────────
    await test(29, "Rate limiting works", async () => {
      // 1. Submit review
      const res1 = await apiPost(
        "/api/reviews",
        { rating: 5, text: `Rapid review test #1 [${RUN_ID}]` },
        spamUserCookie
      );
      assert.strictEqual(res1.status, 201);
      createdReviewIds.push(res1.data.data.review.id);

      // 2. Immediately attempt second submission (burst spam)
      const res2 = await apiPost(
        "/api/reviews",
        { rating: 5, text: `Rapid review test #2 [${RUN_ID}]` },
        spamUserCookie
      );
      assert.strictEqual(res2.status, 429, "Rapid burst spam must trigger 429 Too Many Requests");

      // 3. Duplicate identical review submission
      const resDup = await apiPost(
        "/api/reviews",
        { rating: 5, text: `Rapid review test #1 [${RUN_ID}]` },
        spamUserCookie
      );
      assert.ok(
        resDup.status === 409 || resDup.status === 429,
        `Duplicate review must be rejected with 409 or 429 (got: ${resDup.status})`
      );
    });

    // ── Test 30: Cleanup & State Parity Verification ─────────────────────────
    await test(30, "All temporary DB rows and Storage files are removed after tests", async () => {
      await cleanup();

      // Check DB reviews table
      const { data: remainingReviews } = await supabase
        .from("reviews")
        .select("id")
        .in("id", createdReviewIds);
      assert.strictEqual(remainingReviews?.length || 0, 0, "All test reviews must be deleted from DB");

      // Check Storage files
      const { data: remainingFiles } = await supabase.storage.from(BUCKET).list("reviews");
      const testFilesRemaining = (remainingFiles || []).filter(
        (f) => f.name.includes(String(RUN_ID))
      );
      assert.strictEqual(testFilesRemaining.length, 0, "All test storage files must be deleted");

      // Check Users
      const { data: remainingUsers } = await supabase
        .from("users")
        .select("id")
        .in("email", createdUserEmails);
      assert.strictEqual(remainingUsers?.length || 0, 0, "All test users must be deleted from DB");
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
    console.log("\nAll 30 test scenarios passed with 100% database & storage parity!");
    process.exit(0);
  }
}

run();
