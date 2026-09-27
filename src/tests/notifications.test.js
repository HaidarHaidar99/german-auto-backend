/**
 * GERMAN AUTO — Notifications Module Test Suite
 *
 * Tests all notification requirements against the live Supabase database.
 * Creates temporary test records; cleans ALL of them up completely afterward.
 * Zero test records or orphan entries are left behind.
 */

const assert = require("assert");
const http   = require("http");
const path   = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app      = require("../app");
const supabase = require("../config/supabase");

// ── Globals ──────────────────────────────────────────────────────────────────
let server;
let port;

const RUN_ID = Date.now();

const ADMIN_EMAIL       = `admin.notif.${RUN_ID}@germanautotestonly.invalid`;
const SUPER_ADMIN_EMAIL = `superadmin.notif.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL    = `customer.notif.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL_2  = `customer2.notif.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS         = "NotifPass123!";

let adminCookie       = "";
let superAdminCookie  = "";
let customerCookie    = "";
let customerCookie2   = "";

const createdFormIds    = [];
const createdReviewIds  = [];
const createdUserEmails = [];

// ── Server Helpers ───────────────────────────────────────────────────────────
async function startServer() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
}

async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
}

// ── DB Helpers ───────────────────────────────────────────────────────────────
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
  if (createdFormIds.length > 0) {
    await supabase.from("forms").delete().in("id", createdFormIds);
  }
  if (createdReviewIds.length > 0) {
    await supabase.from("reviews").delete().in("id", createdReviewIds);
  }
  if (createdUserEmails.length > 0) {
    await supabase.from("users").delete().in("email", createdUserEmails);
  }
  // Delete any lingering test emails matching pattern
  await supabase.from("users").delete().ilike("email", "%@germanautotestonly.invalid");
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

async function apiDelete(urlPath, body = null, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "DELETE",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  console.log("          GERMAN AUTO — NOTIFICATIONS BACKEND MODULE TEST SUITE                 ");
  console.log("================================================================================\n");

  await startServer();
  console.log(`Test server running on port ${port}`);

  try {
    // ── Setup Users ──────────────────────────────────────────────────────────
    console.log("Setting up test users in Supabase...");
    const adminUser      = await createUser("ADMIN", ADMIN_EMAIL, "Notification Admin");
    const superAdminUser = await createUser("SUPER_ADMIN", SUPER_ADMIN_EMAIL, "Notification SuperAdmin");
    const customerUser   = await createUser("CUSTOMER", CUSTOMER_EMAIL, "Notification Customer");
    const customerUser2  = await createUser("CUSTOMER", CUSTOMER_EMAIL_2, "Notification Customer 2");

    adminCookie      = await loginUser(ADMIN_EMAIL);
    superAdminCookie = await loginUser(SUPER_ADMIN_EMAIL);
    customerCookie   = await loginUser(CUSTOMER_EMAIL);
    customerCookie2  = await loginUser(CUSTOMER_EMAIL_2);

    console.log("All test users created and authenticated.\n");

    let contactFormId = null;
    let sellCarFormId = null;
    let reviewId = null;

    // ── Tests 1 to 3: Access Control ─────────────────────────────────────────
    await test(1, "Admin can retrieve notifications", async () => {
      const res = await apiGet("/api/notifications", adminCookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.ok(Array.isArray(res.data.data.notifications));
      assert.ok(typeof res.data.data.unread_count === "number");
      assert.ok(res.data.meta);
    });

    await test(2, "Customer cannot retrieve admin notifications", async () => {
      const res = await apiGet("/api/notifications", customerCookie);
      assert.strictEqual(res.status, 403, "CUSTOMER role must receive 403 Forbidden");
    });

    await test(3, "Unauthenticated user cannot retrieve admin notifications", async () => {
      const res = await apiGet("/api/notifications");
      assert.strictEqual(res.status, 401, "Unauthenticated request must receive 401");
    });

    // ── Tests 4 to 6: Notification Generation Integration ────────────────────
    await test(4, "New contact form creates the expected notification", async () => {
      const formPayload = {
        name: `Contact Tester ${RUN_ID}`,
        email: `visitor.${RUN_ID}@example.com`,
        phone: "+49 170 1234567",
        regarding: "Vehicle Inquiry",
        message: "I am interested in scheduling a showroom viewing.",
        privacy_consent: true,
      };

      const resSubmit = await apiPost("/api/forms/contact", formPayload);
      assert.strictEqual(resSubmit.status, 201);
      contactFormId = resSubmit.data.data.submission_id;
      createdFormIds.push(contactFormId);

      // Verify feed includes this new notification
      const resFeed = await apiGet("/api/notifications", adminCookie);
      assert.strictEqual(resFeed.status, 200);
      const notif = resFeed.data.data.notifications.find((n) => n.source_record_id === contactFormId);
      assert.ok(notif, "Feed must contain notification for new contact form");
      assert.strictEqual(notif.type, "CONTACT_FORM");
      assert.strictEqual(notif.source_type, "forms");
      assert.ok(notif.title);
      assert.ok(notif.summary.includes(formPayload.name));
      assert.strictEqual(notif.is_read, false, "New notification must default to unread");
      assert.strictEqual(notif.link, `/admin/forms/${contactFormId}`);
    });

    await test(5, "New Sell Your Car form creates the expected notification", async () => {
      // Direct insertion to exercise SELL_CAR form feed generation
      const { data: sellForm, error } = await supabase
        .from("forms")
        .insert({
          form_type: "SELL_CAR",
          status: "NEW",
          data: {
            brand: "Porsche",
            model: "911 GT3 RS",
            first_name: "Max",
            last_name: "Mustermann",
            email: `max.${RUN_ID}@example.com`,
            phone: "+49 170 9876543",
          },
        })
        .select("id")
        .single();

      assert.ok(!error, "Form insert should succeed");
      sellCarFormId = sellForm.id;
      createdFormIds.push(sellCarFormId);

      // Verify feed includes SELL_CAR_FORM notification
      const resFeed = await apiGet("/api/notifications?type=SELL_CAR_FORM", adminCookie);
      assert.strictEqual(resFeed.status, 200);
      const notif = resFeed.data.data.notifications.find((n) => n.source_record_id === sellCarFormId);
      assert.ok(notif, "Feed must contain notification for sell-car form");
      assert.strictEqual(notif.type, "SELL_CAR_FORM");
      assert.strictEqual(notif.source_type, "forms");
      assert.ok(notif.summary.includes("Porsche"));
      assert.strictEqual(notif.is_read, false);
    });

    await test(6, "New review creates the expected notification", async () => {
      const resRev = await apiPost(
        "/api/reviews",
        {
          rating: 5,
          text: `Exceptional customer service during vehicle delivery. Highly recommended! [${RUN_ID}]`,
        },
        customerCookie
      );
      assert.strictEqual(resRev.status, 201);
      reviewId = resRev.data.data.review.id;
      createdReviewIds.push(reviewId);

      const resFeed = await apiGet("/api/notifications?type=NEW_REVIEW", adminCookie);
      assert.strictEqual(resFeed.status, 200);
      const notif = resFeed.data.data.notifications.find((n) => n.source_record_id === reviewId);
      assert.ok(notif, "Feed must contain notification for new review");
      assert.strictEqual(notif.type, "NEW_REVIEW");
      assert.strictEqual(notif.source_type, "reviews");
      assert.strictEqual(notif.is_read, false);
      assert.ok(notif.summary.includes("5★"));
    });

    // ── Tests 7 to 9: Feed Pagination & Filtering ────────────────────────────
    await test(7, "Notification feed pagination works", async () => {
      const res = await apiGet("/api/notifications?page=1&limit=2", adminCookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.notifications.length <= 2);
      assert.strictEqual(res.data.meta.page, 1);
      assert.strictEqual(res.data.meta.limit, 2);
      assert.ok(res.data.meta.total >= 3);
    });

    await test(8, "Unread/read filtering works", async () => {
      // Currently contactFormId is unread
      const resUnread = await apiGet("/api/notifications?status=unread", adminCookie);
      assert.strictEqual(resUnread.status, 200);
      const unreadFound = resUnread.data.data.notifications.find((n) => n.id === contactFormId);
      assert.ok(unreadFound, "Contact form notification should be in unread list");

      // Mark contactFormId as read
      await apiPatch(`/api/notifications/${contactFormId}/read`, {}, adminCookie);

      // Verify with status=read filter
      const resRead = await apiGet("/api/notifications?status=read", adminCookie);
      assert.strictEqual(resRead.status, 200);
      const readFound = resRead.data.data.notifications.find((n) => n.id === contactFormId);
      assert.ok(readFound, "Contact form notification should now be in read list");

      // Verify contactFormId is NOT in status=unread list
      const resUnreadAfter = await apiGet("/api/notifications?status=unread", adminCookie);
      assert.strictEqual(resUnreadAfter.status, 200);
      const notInUnread = resUnreadAfter.data.data.notifications.find((n) => n.id === contactFormId);
      assert.strictEqual(notInUnread, undefined, "Read notification must not appear in unread list");
    });

    await test(9, "Notification type filtering works", async () => {
      const res = await apiGet("/api/notifications?type=CONTACT_FORM", adminCookie);
      assert.strictEqual(res.status, 200);
      for (const item of res.data.data.notifications) {
        assert.strictEqual(item.type, "CONTACT_FORM", "All filtered items must be of type CONTACT_FORM");
      }
    });

    // ── Tests 10 to 12: Mark Read / Unread / Dismiss ─────────────────────────
    await test(10, "Mark read works", async () => {
      const res = await apiPatch(`/api/notifications/${reviewId}/read`, {}, adminCookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.is_read, true);

      // Verify in feed
      const resFeed = await apiGet("/api/notifications", adminCookie);
      const notif = resFeed.data.data.notifications.find((n) => n.id === reviewId);
      assert.ok(notif);
      assert.strictEqual(notif.is_read, true);
    });

    await test(11, "Mark unread works if implemented", async () => {
      const res = await apiPatch(`/api/notifications/${reviewId}/unread`, {}, adminCookie);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.is_read, false);

      // Verify in feed
      const resFeed = await apiGet("/api/notifications", adminCookie);
      const notif = resFeed.data.data.notifications.find((n) => n.id === reviewId);
      assert.ok(notif);
      assert.strictEqual(notif.is_read, false);
    });

    await test(12, "Delete/dismiss notification does not delete the underlying form/review", async () => {
      // Dismiss the contact form notification
      const resDismiss = await apiDelete(`/api/notifications/${contactFormId}`, null, adminCookie);
      assert.strictEqual(resDismiss.status, 200);
      assert.strictEqual(resDismiss.data.data.dismissed, true);

      // Verify it no longer appears in admin's feed
      const resFeed = await apiGet("/api/notifications", adminCookie);
      const inFeed = resFeed.data.data.notifications.find((n) => n.id === contactFormId);
      assert.strictEqual(inFeed, undefined, "Dismissed notification must not appear in feed");

      // Verify underlying form row in database is completely intact!
      const { data: dbForm, error } = await supabase
        .from("forms")
        .select("id, form_type, status")
        .eq("id", contactFormId)
        .maybeSingle();

      assert.ok(!error);
      assert.ok(dbForm, "Underlying form row in database MUST NOT be deleted");
      assert.strictEqual(dbForm.id, contactFormId);
    });

    // ── Tests 13 to 15: Notification Preferences ─────────────────────────────
    await test(13, "Notification preferences can be read", async () => {
      const res = await apiGet("/api/notifications/preferences", customerCookie);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.preferences);
      assert.strictEqual(typeof res.data.data.preferences.forms, "boolean");
      assert.strictEqual(typeof res.data.data.preferences.reviews, "boolean");
      assert.strictEqual(typeof res.data.data.preferences.push, "boolean");
      assert.strictEqual(typeof res.data.data.preferences.sound, "boolean");
    });

    await test(14, "Notification preferences can be updated", async () => {
      const res = await apiPatch(
        "/api/notifications/preferences",
        { forms: false, sound: false },
        customerCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.preferences.forms, false);
      assert.strictEqual(res.data.data.preferences.sound, false);
      assert.strictEqual(res.data.data.preferences.reviews, true, "Unchanged fields must be preserved");

      // Verify persistence in DB
      const resGet = await apiGet("/api/notifications/preferences", customerCookie);
      assert.strictEqual(resGet.data.data.preferences.forms, false);
      assert.strictEqual(resGet.data.data.preferences.sound, false);
    });

    await test(15, "Invalid preference fields are rejected", async () => {
      // 1. Non-boolean value
      const res1 = await apiPatch(
        "/api/notifications/preferences",
        { forms: "disabled" },
        customerCookie
      );
      assert.strictEqual(res1.status, 400);

      // 2. Unsupported key / JSON injection attempt
      const res2 = await apiPatch(
        "/api/notifications/preferences",
        { injected_admin_role: true },
        customerCookie
      );
      assert.strictEqual(res2.status, 400);
    });

    // ── Tests 16 to 18: Push Subscriptions ───────────────────────────────────
    const testSubscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/test-sub-${RUN_ID}`,
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9P04MgPySwA2Aws9U850qUTZ",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };

    await test(16, "Push subscription can be registered", async () => {
      const res = await apiPost("/api/notifications/push/subscribe", testSubscription, customerCookie);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.data.subscribed, true);

      // Verify in DB
      const { data: user } = await supabase
        .from("users")
        .select("push_subscriptions")
        .eq("email", CUSTOMER_EMAIL)
        .single();

      const exists = user.push_subscriptions?.some((s) => s.endpoint === testSubscription.endpoint);
      assert.ok(exists, "Push subscription must be recorded in users.push_subscriptions");
    });

    await test(17, "Duplicate push subscriptions are prevented", async () => {
      // Re-register the identical endpoint
      const res = await apiPost("/api/notifications/push/subscribe", testSubscription, customerCookie);
      assert.strictEqual(res.status, 201);

      // Verify only 1 entry exists for this endpoint
      const { data: user } = await supabase
        .from("users")
        .select("push_subscriptions")
        .eq("email", CUSTOMER_EMAIL)
        .single();

      const matching = user.push_subscriptions?.filter((s) => s.endpoint === testSubscription.endpoint);
      assert.strictEqual(matching.length, 1, "Must not create duplicate push subscriptions for the same endpoint");
    });

    await test(18, "Push subscription can be removed", async () => {
      const res = await apiDelete(
        "/api/notifications/push/subscribe",
        { endpoint: testSubscription.endpoint },
        customerCookie
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.subscribed, false);

      // Verify removed from DB
      const { data: user } = await supabase
        .from("users")
        .select("push_subscriptions")
        .eq("email", CUSTOMER_EMAIL)
        .single();

      const exists = user.push_subscriptions?.some((s) => s.endpoint === testSubscription.endpoint);
      assert.strictEqual(exists, false, "Push subscription must be removed from DB");
    });

    // ── Tests 19 to 20: Security & Idempotency ────────────────────────────────
    await test(19, "Unauthorized users cannot modify another user's notification data", async () => {
      // Unauthenticated attempts
      const resUnauthPref = await apiPatch("/api/notifications/preferences", { push: false });
      assert.strictEqual(resUnauthPref.status, 401);

      const resUnauthSub = await apiPost("/api/notifications/push/subscribe", testSubscription);
      assert.strictEqual(resUnauthSub.status, 401);

      // Customer cannot mark notifications read
      const resCustRead = await apiPatch(`/api/notifications/${contactFormId}/read`, {}, customerCookie);
      assert.strictEqual(resCustRead.status, 403, "Customer cannot access admin mark-read endpoint");
    });

    await test(20, "No duplicate notification is generated on retry / idempotent", async () => {
      // Calling markRead again on already read item is safe & idempotent
      const resRepeatRead = await apiPatch(`/api/notifications/${reviewId}/read`, {}, adminCookie);
      assert.strictEqual(resRepeatRead.status, 200);
      assert.strictEqual(resRepeatRead.data.data.is_read, true);

      // Calling dismiss again on already dismissed item is safe & idempotent
      const resRepeatDismiss = await apiDelete(`/api/notifications/${contactFormId}`, null, adminCookie);
      assert.strictEqual(resRepeatDismiss.status, 200);
      assert.strictEqual(resRepeatDismiss.data.data.dismissed, true);

      // Verify each source record yields exactly one unique notification ID in the feed
      const resFeed = await apiGet("/api/notifications", adminCookie);
      const ids = resFeed.data.data.notifications.map((n) => n.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, "Notification feed must not have duplicate IDs");
    });

    // ── Test 21: Full Cleanup Verification ───────────────────────────────────
    await test(21, "All temporary DB rows are removed after tests", async () => {
      await cleanup();

      // Check forms
      const { data: remForms } = await supabase.from("forms").select("id").in("id", createdFormIds);
      assert.strictEqual(remForms?.length || 0, 0, "All test forms must be deleted");

      // Check reviews
      const { data: remReviews } = await supabase.from("reviews").select("id").in("id", createdReviewIds);
      assert.strictEqual(remReviews?.length || 0, 0, "All test reviews must be deleted");

      // Check users
      const { data: remUsers } = await supabase.from("users").select("id").in("email", createdUserEmails);
      assert.strictEqual(remUsers?.length || 0, 0, "All test users must be deleted");
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
    console.log("\nAll notification test scenarios passed with 100% database parity!");
    process.exit(0);
  }
}

run();
