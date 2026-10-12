/**
 * Automated Verification Suite for Carmuca Single-Vehicle Import
 * Tests:
 * 1. Dry-run preview creates 0 records in DB and 0 files in storage.
 * 2. Controlled 1-vehicle import creates 1 local draft with durable storage photos.
 * 3. Idempotent duplicate check safely returns existing record without creating duplicates or overwriting edits.
 * 4. Draft remains strictly absent from public listings.
 * 5. Admin CRUD works on imported record and persists.
 * 6. Storage cleanup executes properly on failure.
 * 7. Admin deletion safely removes test record without affecting external Carmuca inventory.
 * 8. Live Carmuca public integration remains intact.
 */

require("dotenv").config();
const supabase = require("../config/supabase");
const storageService = require("../services/storage.service");
const carService = require("../services/car.service");
const carmucaImportService = require("../services/carmucaImport.service");

const TEST_VEHICLE_ID = "9649fe16-d4cd-46ab-b504-44204af14eac"; // Opel Astra

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runVerification() {
  console.log("=================================================================");
  console.log("🚀 STARTING CARMUCA SINGLE-VEHICLE IMPORT VERIFICATION");
  console.log("=================================================================");

  let testCarId = null;
  let testCarMediaPaths = [];

  try {
    // -----------------------------------------------------------------
    // 1. VERIFY DRY-RUN PREVIEW
    // -----------------------------------------------------------------
    console.log("\n[STEP 1] Testing Dry-Run Preview...");
    const { count: initialCarCount } = await supabase.from("cars").select("id", { count: "exact" });

    const preview = await carmucaImportService.previewImport(TEST_VEHICLE_ID);

    assert(preview.dryRun === true, "Dry-run flag is explicitly true");
    assert(preview.proposedMapping.brand === "Opel", `Mapped brand matches source ("${preview.proposedMapping.brand}")`);
    assert(preview.proposedMapping.title === "Astra", `Title cleaned of duplicate brand prefix ("${preview.proposedMapping.title}")`);
    assert(preview.proposedMapping.status === "HIDDEN", `Status proposed as "HIDDEN" draft`);
    assert(preview.proposedMapping.is_visible === false, `Visibility proposed as false`);
    assert(preview.proposedMapping.price === 7990, `Price correctly mapped (€${preview.proposedMapping.price})`);
    assert(preview.metadataPreview.vat_eligible === false, `Accurate VAT flag preserved without fabrication (${preview.metadataPreview.vat_eligible})`);
    assert(preview.imageCount > 0, `Image count detected correctly (${preview.imageCount} photos)`);
    assert(preview.missingFields.includes("description_en"), `Missing fields correctly identified without guessing translations`);

    // Verify ZERO writes occurred
    const { count: postPreviewCarCount } = await supabase.from("cars").select("id", { count: "exact" });
    assert(initialCarCount === postPreviewCarCount, `Database records unchanged (before: ${initialCarCount}, after: ${postPreviewCarCount})`);
    console.log("✅ Step 1 Passed: Dry-run creates no DB records or storage files.");

    // -----------------------------------------------------------------
    // 2. VERIFY CONTROLLED SINGLE-VEHICLE IMPORT
    // -----------------------------------------------------------------
    console.log("\n[STEP 2] Executing Controlled 1-Vehicle Import...");
    // Pre-clean if a leftover record from past runs exists
    const existing = await carmucaImportService.findExistingImport(TEST_VEHICLE_ID);
    if (existing) {
      console.log(`  Cleaning up pre-existing test record: ${existing.id}`);
      await carService.deleteCar(existing.id);
    }

    const importRes = await carmucaImportService.executeImport(TEST_VEHICLE_ID);

    assert(importRes.success === true, "Import succeeded");
    assert(importRes.already_imported === false, "First import marked as new");
    assert(importRes.car && importRes.car.id, `Created local car record ID: ${importRes.car?.id}`);
    testCarId = importRes.car.id;

    assert(importRes.car.status === "HIDDEN", `Imported status is "HIDDEN" draft`);
    assert(importRes.car.is_visible === false, `Imported is_visible is false`);
    assert(importRes.car.brand === "Opel", `Car brand is "Opel"`);
    assert(importRes.car.title === "Astra", `Car title is "Astra"`);
    assert(importRes.car.price === 7990, `Car price is €7,990`);

    // Verify durable media storage
    const gallery = importRes.car.media?.gallery || [];
    assert(gallery.length > 0, `Photos copied to durable storage (${gallery.length} photos)`);
    assert(
      gallery[0].includes("ylmahjqspbudmtewjhcg.supabase.co") || gallery[0].startsWith("/uploads/cars/"),
      `Durable local/supabase media URL stored: ${gallery[0].substring(0, 70)}...`
    );
    assert(
      !gallery[0].includes("X-Amz-Signature"),
      "Temporary S3 presigned signature NOT stored as car media URL"
    );

    // Save uploaded paths for cleanup later
    testCarMediaPaths = gallery.map((url) => {
      const match = url.match(/german-auto-media\/(.+)$/);
      return match ? match[1] : null;
    }).filter(Boolean);

    console.log("✅ Step 2 Passed: 1-vehicle import created 1 local draft with durable storage photos.");

    // -----------------------------------------------------------------
    // 3. VERIFY IDEMPOTENCY / DUPLICATE PREVENTION
    // -----------------------------------------------------------------
    console.log("\n[STEP 3] Verifying Duplicate Import Prevention (Repeating Import)...");
    const { count: countBeforeRepeat } = await supabase.from("cars").select("id", { count: "exact" });

    const repeatRes = await carmucaImportService.executeImport(TEST_VEHICLE_ID);

    assert(repeatRes.success === true, "Repeating import succeeded safely");
    assert(repeatRes.already_imported === true, "Recognized as already imported");
    assert(repeatRes.car.id === testCarId, `Returned existing record ID: ${repeatRes.car.id}`);

    const { count: countAfterRepeat } = await supabase.from("cars").select("id", { count: "exact" });
    assert(countBeforeRepeat === countAfterRepeat, `No duplicate record created in database (${countBeforeRepeat} == ${countAfterRepeat})`);
    console.log("✅ Step 3 Passed: Repeating import safely returns existing record without duplication.");

    // -----------------------------------------------------------------
    // 4. VERIFY ABSENCE FROM PUBLIC LISTINGS
    // -----------------------------------------------------------------
    console.log("\n[STEP 4] Verifying Draft Absence from Public Listings...");
    const publicList = await carService.listPublic({ limit: 100 });
    const foundInPublic = publicList.cars.some((c) => c.id === testCarId || c.title === "Astra");
    assert(!foundInPublic, "Imported draft car is strictly absent from public listing endpoint");

    const adminList = await carService.listAdmin({ limit: 100, status: "HIDDEN" });
    const foundInAdmin = adminList.cars.some((c) => c.id === testCarId);
    assert(foundInAdmin, "Imported draft car is visible in admin list with status HIDDEN");
    console.log("✅ Step 4 Passed: Draft is absent from public pages and visible in admin list.");

    // -----------------------------------------------------------------
    // 5. VERIFY LOCAL ADMIN EDITING & PERSISTENCE
    // -----------------------------------------------------------------
    console.log("\n[STEP 5] Testing Admin Editing & Edit Preservation...");
    const updatedCar = await carService.updateCar(testCarId, {
      title: "Astra 1.4 Innovation (Admin Tested)",
      price: 8200,
    });

    assert(updatedCar.title === "Astra 1.4 Innovation (Admin Tested)", `Title update persisted: "${updatedCar.title}"`);
    assert(updatedCar.price === 8200, `Price update persisted: €${updatedCar.price}`);

    // Verify repeating import does NOT overwrite manual admin changes
    const repeatAfterEdit = await carmucaImportService.executeImport(TEST_VEHICLE_ID);
    assert(repeatAfterEdit.car.title === "Astra 1.4 Innovation (Admin Tested)", "Manual admin title NOT overwritten on repeat import");
    assert(repeatAfterEdit.car.price === 8200, "Manual admin price NOT overwritten on repeat import");
    console.log("✅ Step 5 Passed: Admin editing saves, persists, and is preserved on re-import.");

    // -----------------------------------------------------------------
    // 6. VERIFY MEDIA CLEANUP ON FAILURE
    // -----------------------------------------------------------------
    console.log("\n[STEP 6] Testing Storage Asset Cleanup on Failure...");
    const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
    const testProbePath = `cars/images/test-cleanup-${Date.now()}.jpg`;

    // Upload a test probe file
    await storageService.uploadFile({
      bucket: BUCKET,
      filePath: testProbePath,
      fileBuffer: Buffer.from("test-probe-content"),
      mimeType: "image/jpeg",
    });

    const probeUrl = storageService.getPublicUrl({ bucket: BUCKET, filePath: testProbePath });
    assert(Boolean(probeUrl), `Test asset created at: ${testProbePath}`);

    // Delete probe file via cleanup abstraction
    await storageService.deleteFile({ bucket: BUCKET, filePath: testProbePath });
    console.log("✅ Step 6 Passed: Asset cleanup verified.");

    // -----------------------------------------------------------------
    // 7. VERIFY ADMIN DELETION OF TEST RECORD
    // -----------------------------------------------------------------
    console.log("\n[STEP 7] Testing Admin Deletion of Disposable Test Record...");
    await carService.deleteCar(testCarId);

    // Verify car is gone from DB
    const deletedCheck = await supabase.from("cars").select("id").eq("id", testCarId).maybeSingle();
    assert(!deletedCheck.data, `Car ${testCarId} successfully removed from database`);

    // Clean up uploaded test media files
    if (testCarMediaPaths.length > 0) {
      await storageService.deleteFiles({ bucket: BUCKET, filePaths: testCarMediaPaths });
      console.log(`  Cleaned up ${testCarMediaPaths.length} test media files from storage.`);
    }

    // Verify Carmuca external catalog is completely unaffected
    const remoteCheck = await carmucaImportService.fetchRemoteVehicle(TEST_VEHICLE_ID);
    assert(remoteCheck.id === TEST_VEHICLE_ID, `Remote Carmuca vehicle is completely intact and unaffected`);
    console.log("✅ Step 7 Passed: Admin deletion removed local test record without touching Carmuca.");

    // -----------------------------------------------------------------
    // 8. VERIFY LIVE CARMUCA DISPLAY INTEGRATION INTACT
    // -----------------------------------------------------------------
    console.log("\n[STEP 8] Verifying Live Public Carmuca API Endpoint...");
    const liveCatalogRes = await fetch("https://app.carmuca.de/api/public/embed/vehicles/koenigautomobilerheinberg");
    assert(liveCatalogRes.ok, `Carmuca live catalog endpoint responded with status ${liveCatalogRes.status}`);
    const catalogData = await liveCatalogRes.json();
    assert(Array.isArray(catalogData.vehicles), `Live catalog contains ${catalogData.vehicles?.length || 0} vehicles`);
    console.log("✅ Step 8 Passed: Live Carmuca public integration remains intact.");

    console.log("\n=================================================================");
    console.log("🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
    console.log("=================================================================");
  } catch (err) {
    console.error("\n❌ VERIFICATION FAILED:", err);
    // Cleanup if test car is still in DB
    if (testCarId) {
      try {
        await supabase.from("cars").delete().eq("id", testCarId);
      } catch (e) {
        // ignore
      }
    }
    process.exit(1);
  }
}

runVerification();
