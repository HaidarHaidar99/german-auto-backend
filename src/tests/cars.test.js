/**
 * GERMAN AUTO — Cars Module Test Suite
 * Tests all car endpoints against live Supabase.
 * Creates temporary test records; cleans up all of them completely.
 * No fake/demo cars are left in the database.
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

const RUN_ID = Date.now();
// Track all test car IDs created so we can clean up even on crash
const createdCarIds = [];
const createdUserEmails = [];

// Test credentials
const ADMIN_EMAIL    = `admin.cars.${RUN_ID}@germanautotestonly.invalid`;
const CUSTOMER_EMAIL = `customer.cars.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS      = "TestPass123!";

let adminCookie    = "";
let customerCookie = "";
let testCarId      = "";
let testCarSlug    = "";

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
  // Delete test cars
  if (createdCarIds.length > 0) {
    await supabase.from("cars").delete().in("id", createdCarIds);
  }
  // Delete test users
  for (const email of createdUserEmails) {
    await supabase.from("users").delete().eq("email", email.toLowerCase());
  }
}

async function createAdminUser() {
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  const { data } = await supabase
    .from("users")
    .insert({
      full_name: "Admin Cars Test",
      email: ADMIN_EMAIL,
      password_hash: pwHash,
      is_verified: true,
      role: "ADMIN",
      token_version: 0,
      favorite_car_ids: [],
      notification_preferences: { forms: true, reviews: true, push: true, sound: true },
      push_subscriptions: [],
    })
    .select("id")
    .single();
  createdUserEmails.push(ADMIN_EMAIL);
  return data;
}

async function createCustomerUser() {
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  const { data } = await supabase
    .from("users")
    .insert({
      full_name: "Customer Cars Test",
      email: CUSTOMER_EMAIL,
      password_hash: pwHash,
      is_verified: true,
      role: "CUSTOMER",
      token_version: 0,
      favorite_car_ids: [],
      notification_preferences: { forms: true, reviews: true, push: true, sound: true },
      push_subscriptions: [],
    })
    .select("id")
    .single();
  createdUserEmails.push(CUSTOMER_EMAIL);
  return data;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiGet(path, cookie = "") {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}) },
  });
  const data = await res.json();
  return { status: res.status, data };
}

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

async function apiDelete(path, cookie = "", body = null) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

// ─── SETUP ────────────────────────────────────────────────────────────────────

async function setup() {
  console.log("\n── SETUP ────────────────────────────────────────────────");

  await createAdminUser();
  await createCustomerUser();

  // Login admin
  const { data: adminData, headers: adminHeaders } = await apiPost("/api/auth/login", {
    email: ADMIN_EMAIL,
    password: TEST_PASS,
  });
  assert.strictEqual(adminData.success, true, "Admin login should succeed");
  adminCookie = extractCookie(adminHeaders);

  // Login customer
  const { data: custData, headers: custHeaders } = await apiPost("/api/auth/login", {
    email: CUSTOMER_EMAIL,
    password: TEST_PASS,
  });
  assert.strictEqual(custData.success, true, "Customer login should succeed");
  customerCookie = extractCookie(custHeaders);

  console.log("  [OK] Admin and customer sessions established");
}

// ─── SECTION 1: VALIDATION ────────────────────────────────────────────────────

async function testValidation() {
  console.log("\n── VALIDATION ───────────────────────────────────────────");

  await test("Create car — missing required fields → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {}, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.brand, "Should flag brand");
    assert.ok(data.errors.title, "Should flag title");
    assert.ok(data.errors.price, "Should flag price");
  });

  await test("Create car — negative price → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: -100,
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.price);
  });

  await test("Create car — invalid status enum → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: 50000, status: "BANANA",
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.status);
  });

  await test("Create car — invalid fuel_type enum → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: 50000, fuel_type: "MAGIC",
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.fuel_type);
  });

  await test("Create car — seats 0 → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: 50000, seats: 0,
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.seats);
  });

  await test("Create car — media.gallery >20 images → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: 50000,
      media: { gallery: new Array(21).fill("path/to/img.jpg") },
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.media);
  });

  await test("Create car — invalid date format → 400", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test M3", price: 50000,
      first_registration: "not-a-date",
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.first_registration);
  });

  await test("List cars — invalid sort value → 400", async () => {
    const { status, data } = await apiGet("/api/cars?sort=invalid_sort");
    assert.strictEqual(status, 400);
    assert.ok(data.errors.sort);
  });

  await test("List cars — limit > 100 → 400", async () => {
    const { status, data } = await apiGet("/api/cars?limit=999");
    assert.strictEqual(status, 400);
    assert.ok(data.errors.limit);
  });
}

// ─── SECTION 2: AUTHORIZATION ─────────────────────────────────────────────────

async function testAuthorization() {
  console.log("\n── AUTHORIZATION ────────────────────────────────────────");

  await test("CUSTOMER cannot create car → 403", async () => {
    const { status } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test", price: 50000,
    }, customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot create car → 401", async () => {
    const { status } = await apiPost("/api/cars/admin", {
      brand: "BMW", model: "M3", title: "Test", price: 50000,
    });
    assert.strictEqual(status, 401);
  });

  await test("CUSTOMER cannot access admin list → 403", async () => {
    const { status } = await apiGet("/api/cars/admin/list", customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot access admin list → 401", async () => {
    const { status } = await apiGet("/api/cars/admin/list");
    assert.strictEqual(status, 401);
  });

  await test("CUSTOMER cannot update car → 403", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiPatch(`/api/cars/admin/${fakeId}`, { price: 999 }, customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("CUSTOMER cannot delete car → 403", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiDelete(`/api/cars/admin/${fakeId}`, customerCookie);
    assert.strictEqual(status, 403);
  });

  await test("Unauthenticated cannot add to favorites → 401", async () => {
    const { status } = await apiPost("/api/cars/favorites", { car_id: "anything" });
    assert.strictEqual(status, 401);
  });

  await test("Unauthenticated cannot view favorites → 401", async () => {
    const { status } = await apiGet("/api/cars/favorites");
    assert.strictEqual(status, 401);
  });
}

// ─── SECTION 3: ADMIN CRUD ────────────────────────────────────────────────────

async function testAdminCRUD() {
  console.log("\n── ADMIN CRUD ───────────────────────────────────────────");

  await test("Admin creates car → 201 with full car data", async () => {
    const { status, data } = await apiPost("/api/cars/admin", {
      brand: "BMW",
      model: "M3",
      title: "Competition xDrive",
      description_de: "Hochleistungs-Limousine",
      description_en: "High performance sedan",
      price: 98500,
      old_price: 105000,
      condition: "USED",
      fuel_type: "PETROL",
      transmission: "AUTOMATIC",
      mileage_km: 12000,
      first_registration: "2023-03-15",
      engine_displacement_cc: 2993,
      performance_hp: 510,
      seats: 5,
      vehicle_owners: 1,
      air_conditioning: true,
      camera: true,
      interior_design: "LEATHER",
      interior_color: "Merino Black",
      equipment: ["Panoramic Roof", "M Sport Differential", "HUD"],
      custom_fields: { colour_exterior: "Brooklyn Grey", carbon_package: true },
      media: {
        thumbnail: "cars/bmw-m3/thumb.jpg",
        gallery: ["cars/bmw-m3/01.jpg", "cars/bmw-m3/02.jpg"],
        video: "cars/bmw-m3/tour.mp4",
      },
      is_featured: true,
      is_visible: true,
      category: "SEDAN",
      status: "AVAILABLE",
    }, adminCookie);

    assert.strictEqual(status, 201);
    assert.ok(data.data.car.id, "Car should have an id");
    assert.ok(data.data.car.slug, "Car should have a generated slug");
    assert.strictEqual(data.data.car.brand, "BMW");
    assert.strictEqual(data.data.car.model, "M3");
    assert.strictEqual(data.data.car.price, 98500);
    assert.strictEqual(data.data.car.is_featured, true);
    assert.strictEqual(data.data.car.status, "AVAILABLE");
    assert.strictEqual(data.data.car.password_hash, undefined, "Never expose user secrets");

    testCarId   = data.data.car.id;
    testCarSlug = data.data.car.slug;
    createdCarIds.push(testCarId);
    console.log(`      Car ID: ${testCarId}, Slug: ${testCarSlug}`);
  });

  await test("Admin can get car by ID (admin endpoint)", async () => {
    const { status, data } = await apiGet(`/api/cars/admin/${testCarId}`, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.id, testCarId);
    assert.ok(data.data.car.description_de, "Should include description_de");
    assert.ok(data.data.car.description_en, "Should include description_en");
    assert.ok(data.data.car.custom_fields, "Should include custom_fields");
    assert.ok(data.data.car.media, "Should include media");
  });

  await test("Admin can get car by slug (admin endpoint)", async () => {
    const { status, data } = await apiGet(`/api/cars/admin/${testCarSlug}`, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.id, testCarId);
  });

  await test("Admin update car — partial update", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}`, {
      price: 95000,
      mileage_km: 15000,
      interior_color: "Merino Cognac",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.price, 95000);
    assert.strictEqual(data.data.car.mileage_km, 15000);
    assert.strictEqual(data.data.car.interior_color, "Merino Cognac");
    // Unchanged fields still present
    assert.strictEqual(data.data.car.brand, "BMW");
  });

  await test("Updating brand/model/title regenerates slug", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}`, {
      title: "Competition xDrive Refreshed",
    }, adminCookie);
    assert.strictEqual(status, 200);
    const newSlug = data.data.car.slug;
    assert.ok(newSlug !== testCarSlug || newSlug.includes("refreshed"), "Slug should reflect new title");
    testCarSlug = newSlug;
  });

  await test("Update with invalid data → 400", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}`, {
      price: -1,
    }, adminCookie);
    assert.strictEqual(status, 400);
    assert.ok(data.errors.price);
  });

  await test("Get nonexistent car → 404", async () => {
    const { status } = await apiGet("/api/cars/admin/00000000-0000-0000-0000-000000000099", adminCookie);
    assert.strictEqual(status, 404);
  });

  await test("Admin list includes test car", async () => {
    const { status, data } = await apiGet("/api/cars/admin/list", adminCookie);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.data.cars));
    assert.ok(data.meta.total >= 1);
    const found = data.data.cars.find((c) => c.id === testCarId);
    assert.ok(found, "Test car should appear in admin list");
  });
}

// ─── SECTION 4: HIDE / SHOW / FEATURED / STATUS ───────────────────────────────

async function testAdminActions() {
  console.log("\n── HIDE / SHOW / FEATURED / STATUS ─────────────────────");

  await test("Admin can hide car (set is_visible=false)", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/visibility`, {
      is_visible: false,
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.is_visible, false);
  });

  await test("Hidden car does NOT appear in public listing", async () => {
    const { data } = await apiGet("/api/cars");
    const found = (data.data?.cars || []).find((c) => c.id === testCarId);
    assert.strictEqual(found, undefined, "Hidden car must not appear in public listing");
  });

  await test("Hidden car is NOT accessible via public detail endpoint", async () => {
    const { status } = await apiGet(`/api/cars/${testCarSlug}`);
    assert.strictEqual(status, 404, "Hidden car should 404 on public endpoint");
  });

  await test("Admin can show car (set is_visible=true)", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/visibility`, {
      is_visible: true,
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.is_visible, true);
  });

  await test("Visibility endpoint rejects missing boolean → 400", async () => {
    const { status } = await apiPatch(`/api/cars/admin/${testCarId}/visibility`, {
      is_visible: "yes",
    }, adminCookie);
    assert.strictEqual(status, 400);
  });

  await test("Admin can mark car as featured", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/featured`, {
      is_featured: true,
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.is_featured, true);
  });

  await test("Admin can unmark featured", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/featured`, {
      is_featured: false,
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.is_featured, false);
  });

  await test("Admin can change status to RESERVED", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/status`, {
      status: "RESERVED",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.status, "RESERVED");
  });

  await test("Admin can change status to SOLD", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/status`, {
      status: "SOLD",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.status, "SOLD");
  });

  await test("Admin can change status to HIDDEN", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/status`, {
      status: "HIDDEN",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.status, "HIDDEN");
  });

  await test("HIDDEN status car does NOT appear in public listing (even if is_visible=true)", async () => {
    const { data } = await apiGet("/api/cars");
    const found = (data.data?.cars || []).find((c) => c.id === testCarId);
    assert.strictEqual(found, undefined, "HIDDEN status car must not appear publicly");
  });

  await test("Admin can restore status to AVAILABLE", async () => {
    const { status, data } = await apiPatch(`/api/cars/admin/${testCarId}/status`, {
      status: "AVAILABLE",
    }, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.status, "AVAILABLE");
  });

  await test("Invalid status value → 400", async () => {
    const { status } = await apiPatch(`/api/cars/admin/${testCarId}/status`, {
      status: "BANANA",
    }, adminCookie);
    assert.strictEqual(status, 400);
  });
}

// ─── SECTION 5: PUBLIC LISTING & FILTERS ─────────────────────────────────────

async function testPublicListing() {
  console.log("\n── PUBLIC LISTING & FILTERS ─────────────────────────────");

  await test("Public list returns cars array with pagination meta", async () => {
    const { status, data } = await apiGet("/api/cars");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.data.cars));
    assert.ok(typeof data.meta.total === "number");
    assert.ok(typeof data.meta.page === "number");
    assert.ok(typeof data.meta.limit === "number");
    assert.ok(typeof data.meta.pages === "number");
  });

  await test("Public list excludes hidden/invisible cars", async () => {
    const { data } = await apiGet("/api/cars");
    for (const car of data.data.cars) {
      assert.strictEqual(car.is_visible, true, "All public cars must be visible");
      assert.notStrictEqual(car.status, "HIDDEN", "HIDDEN status cars must not appear publicly");
    }
  });

  await test("Public list does not expose sensitive fields", async () => {
    const { data } = await apiGet("/api/cars");
    for (const car of data.data.cars) {
      assert.strictEqual(car.description_de, undefined, "description_de should not be in list");
      assert.strictEqual(car.description_en, undefined, "description_en should not be in list");
      assert.strictEqual(car.custom_fields, undefined, "custom_fields should not be in list");
    }
  });

  await test("Brand filter works (ilike)", async () => {
    const { status, data } = await apiGet("/api/cars?brand=BMW");
    assert.strictEqual(status, 200);
    for (const car of data.data.cars) {
      assert.ok(car.brand.toLowerCase().includes("bmw"), "All returned cars should have BMW brand");
    }
  });

  await test("Price min/max filter works", async () => {
    const { status, data } = await apiGet("/api/cars?min_price=50000&max_price=200000");
    assert.strictEqual(status, 200);
    for (const car of data.data.cars) {
      assert.ok(car.price >= 50000, `Price ${car.price} should be >= 50000`);
      assert.ok(car.price <= 200000, `Price ${car.price} should be <= 200000`);
    }
  });

  await test("Fuel type filter works", async () => {
    const { status, data } = await apiGet("/api/cars?fuel_type=PETROL");
    assert.strictEqual(status, 200);
    for (const car of data.data.cars) {
      assert.strictEqual(car.fuel_type, "PETROL");
    }
  });

  await test("Featured filter returns only featured cars", async () => {
    // First mark test car as featured
    await apiPatch(`/api/cars/admin/${testCarId}/featured`, { is_featured: true }, adminCookie);

    const { status, data } = await apiGet("/api/cars?featured=true");
    assert.strictEqual(status, 200);
    for (const car of data.data.cars) {
      assert.strictEqual(car.is_featured, true, "Featured filter should only return featured cars");
    }

    // Unmark after test
    await apiPatch(`/api/cars/admin/${testCarId}/featured`, { is_featured: false }, adminCookie);
  });

  await test("Pagination — page 2 returns different results than page 1", async () => {
    const { data: p1 } = await apiGet("/api/cars?page=1&limit=1");
    const { data: p2 } = await apiGet("/api/cars?page=2&limit=1");

    if (p1.meta.total > 1) {
      const p1Ids = p1.data.cars.map((c) => c.id);
      const p2Ids = p2.data.cars.map((c) => c.id);
      const overlap = p1Ids.filter((id) => p2Ids.includes(id));
      assert.strictEqual(overlap.length, 0, "Page 1 and page 2 should not overlap");
    } else {
      // Only 1 car in DB — p2 should be empty
      assert.strictEqual(p2.data.cars.length, 0, "Page 2 should be empty if only 1 car exists");
    }
  });

  await test("Pagination meta is correct", async () => {
    const { data } = await apiGet("/api/cars?page=1&limit=5");
    assert.strictEqual(data.meta.page, 1);
    assert.strictEqual(data.meta.limit, 5);
    assert.ok(data.meta.pages >= 1);
    assert.ok(data.meta.total >= data.data.cars.length);
  });
}

// ─── SECTION 6: SORTING ───────────────────────────────────────────────────────

async function testSorting() {
  console.log("\n── SORTING ──────────────────────────────────────────────");

  // Create a second car with a lower price to test sorting
  const { data: car2 } = await apiPost("/api/cars/admin", {
    brand: "Audi", model: "A4", title: "30 TDI",
    price: 35000, status: "AVAILABLE", is_visible: true,
  }, adminCookie);
  if (car2?.data?.car?.id) createdCarIds.push(car2.data.car.id);

  await test("Sort by price_asc — prices are non-decreasing", async () => {
    const { data } = await apiGet("/api/cars?sort=price_asc&limit=50");
    const prices = data.data.cars.map((c) => c.price);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i] >= prices[i - 1], `Price ${prices[i]} should be >= ${prices[i - 1]}`);
    }
  });

  await test("Sort by price_desc — prices are non-increasing", async () => {
    const { data } = await apiGet("/api/cars?sort=price_desc&limit=50");
    const prices = data.data.cars.map((c) => c.price);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i] <= prices[i - 1], `Price ${prices[i]} should be <= ${prices[i - 1]}`);
    }
  });

  await test("Sort by az — brands in ascending order", async () => {
    const { data } = await apiGet("/api/cars?sort=az&limit=50");
    const brands = data.data.cars.map((c) => c.brand.toLowerCase());
    for (let i = 1; i < brands.length; i++) {
      assert.ok(brands[i] >= brands[i - 1], `Brand "${brands[i]}" should come after "${brands[i - 1]}"`);
    }
  });

  await test("Sort by za — brands in descending order", async () => {
    const { data } = await apiGet("/api/cars?sort=za&limit=50");
    const brands = data.data.cars.map((c) => c.brand.toLowerCase());
    for (let i = 1; i < brands.length; i++) {
      assert.ok(brands[i] <= brands[i - 1], `Brand "${brands[i]}" should come before "${brands[i - 1]}"`);
    }
  });

  await test("Sort by newest — created_at descending", async () => {
    const { data } = await apiGet("/api/cars?sort=newest&limit=50");
    const dates = data.data.cars.map((c) => new Date(c.created_at).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] <= dates[i - 1], "Newest sort should be descending by created_at");
    }
  });

  await test("Sort by oldest — created_at ascending", async () => {
    const { data } = await apiGet("/api/cars?sort=oldest&limit=50");
    const dates = data.data.cars.map((c) => new Date(c.created_at).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] >= dates[i - 1], "Oldest sort should be ascending by created_at");
    }
  });
}

// ─── SECTION 7: PUBLIC DETAIL ─────────────────────────────────────────────────

async function testPublicDetail() {
  console.log("\n── PUBLIC DETAIL ────────────────────────────────────────");

  await test("Get public car by slug — returns full details", async () => {
    const { status, data } = await apiGet(`/api/cars/${testCarSlug}`);
    assert.strictEqual(status, 200);
    const car = data.data.car;
    assert.strictEqual(car.id, testCarId);
    assert.ok(car.description_de !== undefined, "description_de should be present in detail");
    assert.ok(car.description_en !== undefined, "description_en should be present in detail");
    assert.ok(car.equipment !== undefined, "equipment should be present");
    assert.ok(car.custom_fields !== undefined, "custom_fields should be present");
    assert.ok(car.media !== undefined, "media should be present");
    assert.ok(car.engine_displacement_cc !== undefined, "technical specs should be present");
  });

  await test("Get public car by UUID", async () => {
    const { status, data } = await apiGet(`/api/cars/${testCarId}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(data.data.car.id, testCarId);
  });

  await test("Get nonexistent car by slug → 404", async () => {
    const { status } = await apiGet("/api/cars/this-car-does-not-exist-xyz-999");
    assert.strictEqual(status, 404);
  });

  await test("Get nonexistent car by UUID → 404", async () => {
    const { status } = await apiGet("/api/cars/00000000-0000-0000-0000-000000000099");
    assert.strictEqual(status, 404);
  });
}

// ─── SECTION 8: SLUG UNIQUENESS ───────────────────────────────────────────────

async function testSlugUniqueness() {
  console.log("\n── SLUG UNIQUENESS ──────────────────────────────────────");

  await test("Two cars with same brand/model/title get unique slugs", async () => {
    const payload = { brand: "Test", model: "Brand", title: "Slug Test", price: 1000, is_visible: true, status: "AVAILABLE" };

    const { data: r1 } = await apiPost("/api/cars/admin", payload, adminCookie);
    const { data: r2 } = await apiPost("/api/cars/admin", payload, adminCookie);

    const id1 = r1?.data?.car?.id;
    const id2 = r2?.data?.car?.id;
    if (id1) createdCarIds.push(id1);
    if (id2) createdCarIds.push(id2);

    assert.ok(id1 && id2, "Both cars should be created");
    assert.notStrictEqual(r1.data.car.slug, r2.data.car.slug, "Slugs should be unique");
    console.log(`      Slugs: "${r1.data.car.slug}" and "${r2.data.car.slug}"`);
  });

  await test("Manually provided slug that is already in use → 409", async () => {
    const { status } = await apiPost("/api/cars/admin", {
      brand: "X", model: "Y", title: "Z", price: 999, slug: testCarSlug,
    }, adminCookie);
    assert.strictEqual(status, 409);
  });
}

// ─── SECTION 9: FAVORITES ─────────────────────────────────────────────────────

async function testFavorites() {
  console.log("\n── FAVORITES ────────────────────────────────────────────");

  await test("Customer can view empty favorites list", async () => {
    const { status, data } = await apiGet("/api/cars/favorites", customerCookie);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data.data.cars));
    assert.ok(Array.isArray(data.data.favorite_car_ids));
  });

  await test("Customer can add a car to favorites", async () => {
    const { status, data } = await apiPost("/api/cars/favorites", { car_id: testCarId }, customerCookie);
    assert.strictEqual(status, 200);
    assert.ok(data.data.favorite_car_ids.includes(testCarId));
  });

  await test("Duplicate favorite → 409", async () => {
    const { status } = await apiPost("/api/cars/favorites", { car_id: testCarId }, customerCookie);
    assert.strictEqual(status, 409);
  });

  await test("Favorites list now includes the car", async () => {
    const { status, data } = await apiGet("/api/cars/favorites", customerCookie);
    assert.strictEqual(status, 200);
    assert.ok(data.data.favorite_car_ids.includes(testCarId));
    const found = data.data.cars.find((c) => c.id === testCarId);
    assert.ok(found, "Favorited car should appear in the cars list");
  });

  await test("Cannot favorite a nonexistent car → 404", async () => {
    const { status } = await apiPost("/api/cars/favorites", {
      car_id: "00000000-0000-0000-0000-000000000099",
    }, customerCookie);
    assert.strictEqual(status, 404);
  });

  await test("Cannot favorite a hidden car → 404", async () => {
    // Create a separate hidden car
    const { data: hiddenCar } = await apiPost("/api/cars/admin", {
      brand: "Hidden", model: "Car", title: "Not Public", price: 0,
      is_visible: false, status: "AVAILABLE",
    }, adminCookie);
    const hiddenId = hiddenCar?.data?.car?.id;
    if (hiddenId) createdCarIds.push(hiddenId);

    const { status } = await apiPost("/api/cars/favorites", { car_id: hiddenId }, customerCookie);
    assert.strictEqual(status, 404);
  });

  await test("Customer can remove a car from favorites", async () => {
    const { status, data } = await apiDelete(`/api/cars/favorites/${testCarId}`, customerCookie);
    assert.strictEqual(status, 200);
    assert.ok(!data.data.favorite_car_ids.includes(testCarId));
  });

  await test("Remove already-removed favorite → 404", async () => {
    const { status } = await apiDelete(`/api/cars/favorites/${testCarId}`, customerCookie);
    assert.strictEqual(status, 404);
  });

  await test("Add favorite without car_id → 400", async () => {
    const { status } = await apiPost("/api/cars/favorites", {}, customerCookie);
    assert.strictEqual(status, 400);
  });
}

// ─── SECTION 10: ADMIN DELETE ─────────────────────────────────────────────────

async function testAdminDelete() {
  console.log("\n── ADMIN DELETE ─────────────────────────────────────────");

  // Create a throwaway car to delete
  const { data: delCar } = await apiPost("/api/cars/admin", {
    brand: "Delete", model: "Me", title: "Throwaway Car",
    price: 1, is_visible: true, status: "AVAILABLE",
  }, adminCookie);
  const delId = delCar?.data?.car?.id;
  assert.ok(delId, "Throwaway car should be created");

  await test("Admin deletes car → 200", async () => {
    const { status, data } = await apiDelete(`/api/cars/admin/${delId}`, adminCookie);
    assert.strictEqual(status, 200);
    assert.ok(data.message.toLowerCase().includes("deleted"));
  });

  await test("Deleted car is gone from public listing", async () => {
    const { data } = await apiGet("/api/cars");
    const found = (data.data?.cars || []).find((c) => c.id === delId);
    assert.strictEqual(found, undefined, "Deleted car must not appear in public listing");
  });

  await test("Deleted car 404 on admin endpoint", async () => {
    const { status } = await apiGet(`/api/cars/admin/${delId}`, adminCookie);
    assert.strictEqual(status, 404);
  });

  await test("Delete nonexistent car → 404", async () => {
    const { status } = await apiDelete("/api/cars/admin/00000000-0000-0000-0000-000000000099", adminCookie);
    assert.strictEqual(status, 404);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================");
  console.log("GERMAN AUTO — CARS TEST SUITE (LIVE DB)");
  console.log("==========================================");

  await startServer();

  try {
    await setup();
    await testValidation();
    await testAuthorization();
    await testAdminCRUD();
    await testAdminActions();
    await testPublicListing();
    await testSorting();
    await testPublicDetail();
    await testSlugUniqueness();
    await testFavorites();
    await testAdminDelete();
  } catch (crashErr) {
    console.error("\n[CRASH] Test suite crashed:", crashErr.message);
    failed++;
    failures.push({ name: "Suite crash", error: crashErr.message });
  } finally {
    console.log("\n── CLEANUP ──────────────────────────────────────────────");
    await cleanup();
    console.log(`  [OK] Removed ${createdCarIds.length} test car(s) and ${createdUserEmails.length} test user(s)`);
    await stopServer();
  }

  console.log("\n==========================================");
  console.log(`CARS TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  console.log("==========================================");

  if (failed > 0) process.exit(1);
}

main();
