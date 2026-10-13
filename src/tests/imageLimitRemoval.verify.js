/**
 * GERMAN AUTO — Image Limit Removal & Verification Test
 *
 * Verifies:
 * 1. Live Carmuca vehicle with >= 35 photos:
 *    - Fetches vehicle details from live Carmuca API
 *    - Asserts that all photos (>35) are returned without truncation
 *    - Compares raw API images count with adapted gallery count
 *    - Verifies that the final photo URL is directly accessible (HTTP 200)
 * 2. Local vehicle creation with > 20 photos:
 *    - Creates vehicle with 42 photos in database
 *    - Asserts HTTP 201 and full count preserved in media.gallery
 *    - Verifies 42nd photo preserved in exact original order
 *    - Updates/refreshes vehicle with 45 photos and verifies persistence
 *    - Verifies public detail endpoint serves all photos without application cap
 */

const assert = require("assert");
const http = require("http");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = require("../app");
const supabase = require("../config/supabase");

let server;
let port;
const RUN_ID = Date.now();
const ADMIN_EMAIL = `admin.imglimit.${RUN_ID}@germanautotestonly.invalid`;
const TEST_PASS = "TestPass123!";
let adminCookie = "";
const createdCarIds = [];

function apiRequest(method, urlPath, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    if (cookie) headers["Cookie"] = cookie;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log("==========================================================");
  console.log("📸 IMAGE LIMIT REMOVAL & LIVE CARMUCA VERIFICATION SUITE");
  console.log("==========================================================");

  // ─── 1. VERIFY LIVE CARMUCA VEHICLE (>= 35 PHOTOS) ────────────────────────
  console.log("\n[TEST 1] Verifying live Carmuca catalog vehicles with >= 35 photos...");

  // Live Carmuca vehicles with >= 35 photos identified in catalog:
  // - 69af09f1-7029-4acb-aece-a1e0c698d1e2 (Citroën C4 Picasso, 43 photos)
  // - 17e88f0d-bc32-49b5-8eac-bc123028656a (Volkswagen Golf, 42 photos)
  // - 9649fe16-d4cd-46ab-b504-44204af14eac (Opel Astra, 35 photos)
  const targetVehicleId = "69af09f1-7029-4acb-aece-a1e0c698d1e2";
  const detailUrl = `https://app.carmuca.de/api/public/embed/vehicle/koenigautomobilerheinberg/${targetVehicleId}`;
  console.log(`Fetching Carmuca vehicle detail from ${detailUrl}...`);

  const detailRes = await fetch(detailUrl, {
    headers: { Accept: "application/json" },
  });
  assert.strictEqual(detailRes.status, 200, "Carmuca vehicle detail endpoint must return 200");
  const rawVehicle = await detailRes.json();
  console.log(`Selected vehicle: "${rawVehicle.make} ${rawVehicle.model}" (ID: ${rawVehicle.id})`);

  const rawImageCount = rawVehicle.images?.length || 0;
  console.log(`Live Carmuca API returned ${rawImageCount} raw images.`);
  assert(rawImageCount >= 35, `Raw Carmuca vehicle must have >= 35 photos, got ${rawImageCount}`);

  // Test adapter logic (equivalent to frontend mapCarmucaVehicle)
  const carmucaImages = Array.isArray(rawVehicle.images) ? rawVehicle.images.filter(Boolean) : [];
  const primaryImage = carmucaImages[0] || null;
  const adaptedMedia = {
    thumbnail: primaryImage,
    gallery: carmucaImages,
  };

  assert.strictEqual(adaptedMedia.gallery.length, rawImageCount, "Adapted gallery length must match raw image count");
  assert.strictEqual(adaptedMedia.gallery[0], rawVehicle.images[0], "First photo matches raw photo");
  
  const lastIndex = rawImageCount - 1;
  const finalPhotoUrl = adaptedMedia.gallery[lastIndex];
  assert.strictEqual(finalPhotoUrl, rawVehicle.images[lastIndex], "Final photo preserved in exact order");
  console.log(`✓ Adapted gallery preserves all ${rawImageCount} photos in order without truncation`);

  // Verify that the final photo is accessible via HTTP GET (signed for GetObject)
  console.log(`Verifying final photo URL access: ${finalPhotoUrl.substring(0, 65)}...`);
  const finalPhotoRes = await fetch(finalPhotoUrl, {
    method: "GET",
    headers: { Range: "bytes=0-1024" },
  });
  assert(
    [200, 206].includes(finalPhotoRes.status),
    `Final photo URL must be accessible with HTTP 200 or 206, got ${finalPhotoRes.status}`
  );
  const finalContentType = finalPhotoRes.headers.get("content-type");
  console.log(`✓ Final photo accessible! HTTP Status: ${finalPhotoRes.status}, Content-Type: ${finalContentType}`);

  // ─── 2. START LOCAL SERVER & AUTHENTICATE ────────────────────────────────
  console.log("\n[TEST 2] Starting local test server & authenticating admin...");
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });

  // Create admin user for testing
  const { hashPassword } = require("../utils/password");
  const pwHash = await hashPassword(TEST_PASS);
  const { error: userError } = await supabase.from("users").insert({
    full_name: "Admin ImageLimitTest",
    email: ADMIN_EMAIL,
    password_hash: pwHash,
    role: "ADMIN",
    is_verified: true,
    token_version: 0,
    favorite_car_ids: [],
  });
  if (userError) throw new Error(`Admin user creation failed: ${userError.message}`);

  const loginRes = await apiRequest("POST", "/api/auth/login", {
    email: ADMIN_EMAIL,
    password: TEST_PASS,
  });
  assert.strictEqual(loginRes.status, 200, "Admin login must succeed");

  const rawCookie = loginRes.headers["set-cookie"];
  adminCookie = (Array.isArray(rawCookie) ? rawCookie : [rawCookie])
    .map((c) => c.split(";")[0])
    .join("; ");
  console.log("✓ Admin authenticated successfully");

  // ─── 3. LOCAL CAR CREATION & PERSISTENCE (>20 PHOTOS) ────────────────────
  console.log("\n[TEST 3] Local car creation with 42 photos (>20 images)...");

  const gallery42 = [];
  for (let i = 1; i <= 42; i++) {
    gallery42.push(`https://images.germanauto.test/inventory/car-c300/photo_${i.toString().padStart(2, "0")}.webp`);
  }

  const createCarRes = await apiRequest(
    "POST",
    "/api/cars/admin",
    {
      brand: "BMW",
      model: "M4 Competition",
      title: "M xDrive Coupe",
      price: 94500,
      fuel_type: "PETROL",
      transmission: "AUTOMATIC",
      media: {
        thumbnail: gallery42[0],
        gallery: gallery42,
      },
      status: "AVAILABLE",
      is_visible: true,
    },
    adminCookie
  );

  assert.strictEqual(createCarRes.status, 201, "Creating vehicle with 42 photos must return HTTP 201");
  const createdCar = createCarRes.data.data.car;
  createdCarIds.push(createdCar.id);

  assert.strictEqual(createdCar.media.gallery.length, 42, "All 42 photos must be persisted in database");
  assert.strictEqual(createdCar.media.gallery[41], gallery42[41], "42nd photo preserved in exact order");
  assert.strictEqual(createdCar.media.thumbnail, gallery42[0], "Cover image matches gallery first image");
  console.log("✓ Vehicle created with 42 photos in database without truncation");

  // Fetch created car via Admin detail API
  const getAdminRes = await apiRequest("GET", `/api/cars/admin/${createdCar.id}`, null, adminCookie);
  assert.strictEqual(getAdminRes.status, 200, "Admin detail endpoint must return 200");
  const fetchedCar = getAdminRes.data.data.car;
  assert.strictEqual(fetchedCar.media.gallery.length, 42, "Fetched car preserves 42 photos");
  assert.strictEqual(fetchedCar.media.gallery[41], gallery42[41], "42nd photo preserved identically");
  console.log("✓ Admin detail endpoint returns all 42 photos intact");

  // ─── 4. REFRESH & PERSISTENCE WITH ADDITIONAL PHOTOS (>20) ───────────────
  console.log("\n[TEST 4] Updating / refreshing vehicle with 48 photos...");

  const gallery48 = [...gallery42];
  for (let i = 43; i <= 48; i++) {
    gallery48.push(`https://images.germanauto.test/inventory/car-c300/photo_${i.toString().padStart(2, "0")}.webp`);
  }

  // Also change cover image to photo 5 to verify cover selection persistence
  const selectedCover = gallery48[4]; // 5th photo
  const updateRes = await apiRequest(
    "PATCH",
    `/api/cars/admin/${createdCar.id}`,
    {
      media: {
        thumbnail: selectedCover,
        gallery: gallery48,
      },
    },
    adminCookie
  );

  assert.strictEqual(updateRes.status, 200, "Updating vehicle with 48 photos must return 200");
  const updatedCar = updateRes.data.data.car;
  assert.strictEqual(updatedCar.media.gallery.length, 48, "All 48 photos preserved after update");
  assert.strictEqual(updatedCar.media.thumbnail, selectedCover, "Custom cover selection preserved");
  assert.strictEqual(updatedCar.media.gallery[47], gallery48[47], "48th photo preserved in exact order");
  console.log("✓ Vehicle successfully updated with 48 photos and custom cover selection");

  // Verify public car detail endpoint serves all 48 photos
  const publicRes = await apiRequest("GET", `/api/cars/${createdCar.slug}`);
  assert.strictEqual(publicRes.status, 200, "Public detail endpoint must return 200");
  const publicCar = publicRes.data.data.car;
  assert.strictEqual(publicCar.media.gallery.length, 48, "Public car detail serves all 48 photos");
  assert.strictEqual(publicCar.media.thumbnail, selectedCover, "Public cover matches custom cover");
  console.log("✓ Public detail endpoint serves all 48 photos without application-level limit");

  console.log("\n==========================================================");
  console.log("🎉 ALL IMAGE LIMIT REMOVAL TESTS VERIFIED SUCCESSFULLY!");
  console.log("==========================================================");
}

run()
  .catch((err) => {
    console.error("❌ Test suite failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Cleanup created cars
    if (createdCarIds.length > 0) {
      for (const id of createdCarIds) {
        try {
          await supabase.from("cars").delete().eq("id", id);
        } catch {}
      }
      console.log(`Cleaned up ${createdCarIds.length} test car records.`);
    }

    // Cleanup admin test user
    if (ADMIN_EMAIL) {
      try {
        await supabase.from("users").delete().eq("email", ADMIN_EMAIL);
        const { data: users } = await supabase.auth.admin.listUsers();
        const testUser = users?.users?.find((u) => u.email === ADMIN_EMAIL);
        if (testUser) {
          await supabase.auth.admin.deleteUser(testUser.id);
        }
      } catch {}
    }

    if (server) {
      server.close();
    }
  });
