/**
 * Carmuca Import Service
 * Handles server-side dry-run preview and controlled single-vehicle import
 * from Carmuca's public JSON API into German Auto's database and storage.
 *
 * Rules:
 * - Server-side only; protected for authorized admins.
 * - Dry-run does NOT write to database or storage.
 * - Media copied into persistent storage with host validation, retries, and cleanup on failure.
 * - Imports saved strictly as drafts (status: "HIDDEN", is_visible: false).
 * - Duplicate imports are detected and safely skipped/returned without overwriting local edits.
 */

const supabase = require("../config/supabase");
const storageService = require("./storage.service");

const CARMUCA_CONFIG = {
  baseUrl: "https://app.carmuca.de",
  dealershipSlug: "koenigautomobilerheinberg",
  maxImageSizeBytes: 15 * 1024 * 1024, // 15 MB
  downloadTimeoutMs: 15000, // 15s per photo
  maxRetries: 2,
};

// Allowed media host domains to prevent SSRF
const ALLOWED_MEDIA_HOSTS = [
  "nbg1.your-objectstorage.com",
  "your-objectstorage.com",
  "amazonaws.com",
  "app.carmuca.de",
];

// Equipment dictionary for Carmuca boolean flags (German & English)
const EQUIPMENT_DICTIONARY = {
  ledHeadlights: { de: "LED-Scheinwerfer", en: "LED Headlights" },
  xenonHeadlights: { de: "Xenon-Scheinwerfer", en: "Xenon Headlights" },
  bendingLights: { de: "Kurvenlicht", en: "Adaptive Bending Lights" },
  frontFogLights: { de: "Nebelscheinwerfer", en: "Front Fog Lights" },
  daytimeRunningLights: { de: "Tagfahrlicht", en: "Daytime Running Lights" },
  highBeamAssist: { de: "Fernlichtassistent", en: "High-Beam Assistant" },
  headlightWasherSystem: { de: "Scheinwerferreinigung", en: "Headlight Washers" },
  ambientLighting: { de: "Ambiente-Beleuchtung", en: "Ambient Lighting" },
  automaticRainSensor: { de: "Regensensor", en: "Rain Sensor" },
  lightSensor: { de: "Lichtsensor", en: "Light Sensor" },
  tintedWindows: { de: "Abgedunkelte Scheiben", en: "Tinted Windows" },
  heatedWindshield: { de: "Beheizbare Frontscheibe", en: "Heated Windshield" },
  dimmingInteriorMirror: { de: "Automatisch abblendender Innenspiegel", en: "Auto-dimming Rearview Mirror" },
  electricHeatedSeats: { de: "Sitzheizung vorn", en: "Heated Front Seats" },
  electricHeatedRearSeats: { de: "Sitzheizung hinten", en: "Heated Rear Seats" },
  heatedSteeringWheel: { de: "Beheizbares Lenkrad", en: "Heated Steering Wheel" },
  electricAdjustableSeats: { de: "Elektrisch verstellbare Sitze", en: "Power Adjustable Seats" },
  sportSeats: { de: "Sportsitze", en: "Sport Seats" },
  leatherSteeringWheel: { de: "Lederlenkrad", en: "Leather Steering Wheel" },
  multifunctionalWheel: { de: "Multifunktionslenkrad", en: "Multifunction Steering Wheel" },
  paddleShifters: { de: "Schaltwippen", en: "Paddle Shifters" },
  armRest: { de: "Mittelarmlehne", en: "Center Armrest" },
  electricWindows: { de: "Elektrische Fensterheber", en: "Power Windows" },
  electricExteriorMirrors: { de: "Elektrische Außenspiegel", en: "Power Side Mirrors" },
  foldingExteriorMirrors: { de: "Elektrisch anklappbare Außenspiegel", en: "Power Folding Mirrors" },
  keylessEntry: { de: "Keyless Entry / Start", en: "Keyless Entry / Start" },
  electricTailgate: { de: "Elektrische Heckklappe", en: "Power Tailgate" },
  sunroof: { de: "Schiebedach", en: "Sunroof" },
  panoramicGlassRoof: { de: "Panorama-Glasdach", en: "Panoramic Glass Roof" },
  foldingRoof: { de: "Faltdach", en: "Folding Roof" },
  auxiliaryHeating: { de: "Standheizung", en: "Auxiliary Heating" },
  abs: { de: "Antiblockiersystem (ABS)", en: "Anti-lock Braking System (ABS)" },
  esp: { de: "Elektronisches Stabilitätsprogramm (ESP)", en: "Electronic Stability Control (ESP)" },
  tractionControlSystem: { de: "Traktionskontrolle", en: "Traction Control" },
  hillStartAssist: { de: "Berganfahrassistent", en: "Hill-Start Assist" },
  collisionAvoidance: { de: "Auffahrwarnsystem", en: "Forward Collision Warning" },
  emergencyCallSystem: { de: "Notrufsystem", en: "Emergency Call System" },
  blindSpotMonitor: { de: "Totwinkel-Assistent", en: "Blind Spot Monitor" },
  laneDepartureWarning: { de: "Spurhalteassistent", en: "Lane Departure Warning" },
  distanceWarningSystem: { de: "Abstandswarner", en: "Distance Warning System" },
  trafficSignRecognition: { de: "Verkehrszeichenerkennung", en: "Traffic Sign Recognition" },
  fatigueWarningSystem: { de: "Müdigkeitserkennung", en: "Driver Fatigue Monitor" },
  tirePressureMonitoring: { de: "Reifendruckkontrollsystem", en: "Tire Pressure Monitoring" },
  isofix: { de: "Isofix-Kindersitzbefestigung", en: "Isofix Child Seat Mounts" },
  immobilizer: { de: "Elektronische Wegfahrsperre", en: "Immobilizer" },
  alarmSystem: { de: "Alarmanlage", en: "Alarm System" },
  airbag: { de: "Frontairbags", en: "Front Airbags" },
  sideAirbag: { de: "Seitenairbags", en: "Side Airbags" },
  speedLimiter: { de: "Geschwindigkeitsbegrenzer", en: "Speed Limiter" },
  navigationSystem: { de: "Navigationssystem", en: "Navigation System" },
  bluetooth: { de: "Bluetooth Freisprecheinrichtung", en: "Bluetooth Handsfree" },
  handsFreePhoneSystem: { de: "Freisprecheinrichtung", en: "Handsfree Phone System" },
  appleCarplay: { de: "Apple CarPlay", en: "Apple CarPlay" },
  carplay: { de: "Apple CarPlay", en: "Apple CarPlay" },
  androidAuto: { de: "Android Auto", en: "Android Auto" },
  touchscreen: { de: "Touchscreen-Display", en: "Touchscreen Display" },
  digitalCockpit: { de: "Volldigitales Kombiinstrument", en: "Digital Cockpit" },
  onBoardComputer: { de: "Bordcomputer", en: "On-Board Computer" },
  soundSystem: { de: "Premium Soundsystem", en: "Premium Sound System" },
  cdPlayer: { de: "CD-Player", en: "CD Player" },
  usb: { de: "USB-Anschluss", en: "USB Port" },
  voiceControl: { de: "Sprachsteuerung", en: "Voice Control" },
  alloyWheels: { de: "Leichtmetallfelgen", en: "Alloy Wheels" },
  steelWheels: { de: "Stahlfelgen", en: "Steel Wheels" },
  allSeasonTires: { de: "Allwetterreifen", en: "All-Season Tires" },
  winterTires: { de: "Winterreifen", en: "Winter Tires" },
  summerTires: { de: "Sommerreifen", en: "Summer Tires" },
  winterPackage: { de: "Winter-Paket", en: "Winter Package" },
  sportPackage: { de: "Sportpaket", en: "Sport Package" },
  roofRails: { de: "Dachreling", en: "Roof Rails" },
  startStopSystem: { de: "Start/Stopp-Automatik", en: "Start/Stop System" },
  powerAssistedSteering: { de: "Servolenkung", en: "Power Steering" },
  centralLocking: { de: "Zentralverriegelung", en: "Central Locking" },
  performanceHandlingSystem: { de: "Sportfahrwerk", en: "Sport Suspension" },
};

const FUEL_MAP = {
  gasoline: "PETROL",
  petrol: "PETROL",
  diesel: "DIESEL",
  electric: "ELECTRIC",
  hybrid: "HYBRID",
  "hybrid-gasoline": "HYBRID",
  "hybrid-diesel": "HYBRID",
  "plug-in-hybrid": "PLUGIN_HYBRID",
  lpg: "LPG",
  cng: "LPG",
  hydrogen: "HYDROGEN",
  other: "OTHER",
};

const TRANSMISSION_MAP = {
  manual: "MANUAL",
  automatic: "AUTOMATIC",
  cvt: "AUTOMATIC",
};

const BODY_TYPE_MAP = {
  sedan: "SEDAN",
  wagon: "WAGON",
  hatchback: "HATCHBACK",
  coupe: "COUPE",
  convertible: "CONVERTIBLE",
  suv: "SUV",
  van: "VAN",
  pickup: "TRUCK",
  other: "OTHER",
};

/**
 * Clean duplicate brand prefix from title/name
 */
function cleanVehicleName(rawTitle, make, model) {
  const brand = (make || "").trim();
  let candidate = (rawTitle || model || "").trim();

  if (brand && candidate) {
    const brandRegex = new RegExp(`^${brand}\\s+`, "i");
    if (brandRegex.test(candidate)) {
      candidate = candidate.replace(brandRegex, "").trim();
    }
  }

  if (!candidate || candidate.toLowerCase() === brand.toLowerCase()) {
    candidate = (model || rawTitle || "").trim();
  }

  return candidate || brand || "Fahrzeug";
}

/**
 * Extract clean equipment list from Carmuca vehicle details
 */
function extractEquipment(details) {
  if (!details || typeof details !== "object") return [];

  const list = [];

  for (const [key, mapping] of Object.entries(EQUIPMENT_DICTIONARY)) {
    if (details[key] === true) {
      list.push(mapping.de);
    }
  }

  if (Array.isArray(details.parkingAssistants) && details.parkingAssistants.length > 0) {
    const hasFront = details.parkingAssistants.includes("FRONT_SENSORS");
    const hasRear = details.parkingAssistants.includes("REAR_SENSORS");
    const hasAuto = details.parkingAssistants.includes("AUTOMATIC_PARKING");

    if (hasFront && hasRear && hasAuto) {
      list.push("Parkassistent vorn & hinten + selbstlenkend");
    } else if (hasFront && hasRear) {
      list.push("Einparkhilfe vorn und hinten (PDC)");
    } else if (hasRear) {
      list.push("Einparkhilfe hinten (PDC)");
    } else if (hasFront) {
      list.push("Einparkhilfe vorn (PDC)");
    }
  }

  if (details.climatisation) {
    const clim = String(details.climatisation).toLowerCase();
    if (clim.includes("automatic2zone") || clim.includes("automatic_2_zone")) {
      list.push("2-Zonen Klimaautomatik");
    } else if (clim.includes("automatic3zone") || clim.includes("automatic_3_zone")) {
      list.push("3-Zonen Klimaautomatik");
    } else if (clim.includes("automatic")) {
      list.push("Klimaautomatik");
    } else if (clim.includes("manual")) {
      list.push("Klimaanlage");
    }
  }

  if (Array.isArray(details.radio) && details.radio.includes("DAB")) {
    list.push("DAB+ Digitalradio");
  }

  if (details.speedControl) {
    const sc = String(details.speedControl).toLowerCase();
    if (sc.includes("adaptive") || sc.includes("acc")) {
      list.push("Abstandstempomat (ACC)");
    } else if (sc.includes("cruise")) {
      list.push("Tempomat (Geschwindigkeitsregelanlage)");
    }
  }

  if (details.fullServiceHistory === true) list.push("Scheckheftgepflegt");
  if (details.nonSmokerVehicle === true) list.push("Nichtraucher-Fahrzeug");
  if (details.newHuAu === true) list.push("TÜV / AU neu bei Auslieferung");

  return Array.from(new Set(list));
}

/**
 * Validate that remote image URL host belongs to an allowed domain
 */
function validateMediaHost(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = ALLOWED_MEDIA_HOSTS.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
    if (!isAllowed) {
      throw new Error(`Untrusted media host: ${hostname}. Allowed domains: ${ALLOWED_MEDIA_HOSTS.join(", ")}`);
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid media URL: ${err.message}`);
  }
}

/**
 * Turn a raw string into a URL-safe slug component.
 */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate a unique slug for imported vehicle
 */
async function generateUniqueSlug(brand, model, title) {
  const base = slugify(`${brand}-${model}-${title}`).substring(0, 200);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const { data } = await supabase
      .from("cars")
      .select("id")
      .eq("slug", candidate)
      .limit(1);

    if (!data || data.length === 0) break;
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  return candidate;
}

class CarmucaImportService {
  /**
   * Check if the 'cars' table has a top-level 'source' column
   */
  async _hasSourceColumn() {
    try {
      const { error } = await supabase.from("cars").select("source").limit(1);
      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Find an existing imported car by source="carmuca" and external_id.
   * Checks both top-level columns (if migration applied) and custom_fields JSONB.
   */
  async findExistingImport(externalVehicleId) {
    const hasSource = await this._hasSourceColumn();

    if (hasSource) {
      const { data, error } = await supabase
        .from("cars")
        .select("*")
        .eq("source", "carmuca")
        .eq("external_id", externalVehicleId)
        .maybeSingle();

      if (!error && data) return data;
    }

    // Always check custom_fields for resilient tracking
    const { data, error } = await supabase
      .from("cars")
      .select("*")
      .contains("custom_fields", { source: "carmuca", external_id: externalVehicleId })
      .maybeSingle();

    if (!error && data) return data;
    return null;
  }

  /**
   * Fetch vehicle data directly from Carmuca's public embed endpoint
   */
  async fetchRemoteVehicle(vehicleId) {
    if (!vehicleId || typeof vehicleId !== "string" || !vehicleId.trim()) {
      const err = new Error("Vehicle ID is required.");
      err.statusCode = 400;
      throw err;
    }

    const cleanId = vehicleId.trim();
    const url = `${CARMUCA_CONFIG.baseUrl}/api/public/embed/vehicle/${CARMUCA_CONFIG.dealershipSlug}/${encodeURIComponent(cleanId)}`;

    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000), // 10s timeout
      });
    } catch (netErr) {
      const err = new Error(`Failed to reach Carmuca API: ${netErr.message}`);
      err.statusCode = 502;
      throw err;
    }

    if (response.status === 404) {
      const err = new Error(`Vehicle "${cleanId}" was not found in Carmuca dealership "${CARMUCA_CONFIG.dealershipSlug}".`);
      err.statusCode = 404;
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`Carmuca API responded with error status ${response.status} (${response.statusText}).`);
      err.statusCode = 502;
      throw err;
    }

    const vehicle = await response.json();
    if (!vehicle || typeof vehicle !== "object") {
      const err = new Error("Invalid response format received from Carmuca API.");
      err.statusCode = 502;
      throw err;
    }

    return vehicle;
  }

  /**
   * Add a dry-run preview for one selected Carmuca vehicle:
   * - Fetch current full details.
   * - Show proposed field mapping, image count, missing fields, and unmapped data.
   * - Do NOT write to DB or storage.
   * - Preserve unmapped useful source data in metadata preview.
   * - Do not fabricate specifications, VAT info, or translations.
   */
  async previewImport(vehicleId) {
    const raw = await this.fetchRemoteVehicle(vehicleId);
    const existing = await this.findExistingImport(raw.id || vehicleId);

    const make = raw.make ? String(raw.make).trim() : null;
    const model = raw.model ? String(raw.model).trim() : null;
    const rawTitle = raw.title ? String(raw.title).trim() : null;
    const cleanName = cleanVehicleName(rawTitle, make, model);

    // Pricing & VAT
    const grossPrice = raw.grossPrice !== null && raw.grossPrice !== undefined && raw.grossPrice !== ""
      ? Number(raw.grossPrice)
      : null;
    const netPrice = raw.netPrice !== null && raw.netPrice !== undefined && raw.netPrice !== ""
      ? Number(raw.netPrice)
      : null;
    const price = grossPrice ?? netPrice;

    // Mileage
    const mileageKm = raw.mileage !== null && raw.mileage !== undefined && raw.mileage !== ""
      ? Number(raw.mileage)
      : null;

    // Fuel & Transmission
    const rawFuel = raw.fuelType ? String(raw.fuelType).toLowerCase().trim() : null;
    const fuelType = rawFuel && FUEL_MAP[rawFuel] ? FUEL_MAP[rawFuel] : (rawFuel ? "OTHER" : null);

    const rawTrans = raw.transmission ? String(raw.transmission).toLowerCase().trim() : null;
    const transmission = rawTrans && TRANSMISSION_MAP[rawTrans] ? TRANSMISSION_MAP[rawTrans] : null;

    // Body type / category
    const rawBody = raw.bodyType ? String(raw.bodyType).toLowerCase().trim() : null;
    const category = rawBody && BODY_TYPE_MAP[rawBody] ? BODY_TYPE_MAP[rawBody] : null;

    // Power
    const performanceHp = raw.powerPs !== null && raw.powerPs !== undefined && raw.powerPs !== ""
      ? Number(raw.powerPs)
      : null;

    // First Registration
    const firstRegistration = raw.firstRegistrationDate || (raw.year ? `${raw.year}-01-01` : null);

    // Displacement
    const engineDisplacementCc = raw.engineDisplacement !== null && raw.engineDisplacement !== undefined && raw.engineDisplacement !== ""
      ? Number(raw.engineDisplacement)
      : null;

    // Seats & Owners
    const seats = raw.numberOfSeats !== null && raw.numberOfSeats !== undefined && raw.numberOfSeats !== ""
      ? Number(raw.numberOfSeats)
      : null;
    const vehicleOwners = raw.previousOwners !== null && raw.previousOwners !== undefined && raw.previousOwners !== ""
      ? Number(raw.previousOwners)
      : null;

    // Equipment
    const equipment = extractEquipment(raw.details);

    // Images
    const rawImages = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];

    // Descriptions
    const descriptionDe = raw.description || raw.details?.description || null;
    const descriptionEn = null; // Do not fabricate translations

    // Proposed target schema mapping
    const proposedMapping = {
      brand: make,
      model: model || cleanName,
      title: cleanName,
      status: "HIDDEN", // Excluded from public pages
      is_visible: false,
      is_featured: false,
      condition: raw.condition || "USED",
      price,
      old_price: null,
      fuel_type: fuelType,
      transmission,
      category,
      mileage_km: mileageKm,
      first_registration: firstRegistration,
      performance_hp: performanceHp,
      engine_displacement_cc: engineDisplacementCc,
      seats,
      vehicle_owners: vehicleOwners,
      interior_design: raw.details?.interiorType || null,
      interior_color: raw.interiorColor || null,
      air_conditioning: Boolean(raw.details?.climatisation),
      camera: Array.isArray(raw.details?.parkingAssistants) &&
        (raw.details.parkingAssistants.includes("REAR_VIEW_CAMERA") || raw.details.parkingAssistants.includes("CAMERA_360")),
      equipment,
      description_de: descriptionDe,
      description_en: descriptionEn,
    };

    // Identify missing or unpopulated target fields
    const missingFields = [];
    if (!proposedMapping.brand) missingFields.push("brand");
    if (!proposedMapping.price) missingFields.push("price");
    if (!proposedMapping.fuel_type) missingFields.push("fuel_type");
    if (!proposedMapping.transmission) missingFields.push("transmission");
    if (!proposedMapping.mileage_km) missingFields.push("mileage_km");
    if (!proposedMapping.first_registration) missingFields.push("first_registration");
    if (!proposedMapping.performance_hp) missingFields.push("performance_hp");
    if (!proposedMapping.engine_displacement_cc) missingFields.push("engine_displacement_cc");
    if (!proposedMapping.seats) missingFields.push("seats");
    if (!proposedMapping.vehicle_owners) missingFields.push("vehicle_owners");
    if (!proposedMapping.interior_design) missingFields.push("interior_design");
    if (!proposedMapping.interior_color) missingFields.push("interior_color");
    if (!proposedMapping.description_de) missingFields.push("description_de");
    if (!proposedMapping.description_en) missingFields.push("description_en");

    // Preserve unmapped useful data in metadata
    const metadataPreview = {
      source: "carmuca",
      dealership_slug: CARMUCA_CONFIG.dealershipSlug,
      external_id: raw.id,
      stock_number: raw.stockNumber || null,
      vin: raw.vin || null,
      gross_price: grossPrice,
      net_price: netPrice,
      vat_eligible: typeof raw.vatEligible === "boolean" ? raw.vatEligible : null,
      currency: "EUR",
      co2_emission: raw.co2Emission ?? raw.wltpCo2Emission ?? null,
      emission_class: raw.emissionClass || null,
      co2_class: raw.co2Class || null,
      general_inspection: raw.generalInspection || null,
      power_kw: raw.powerKw !== undefined ? Number(raw.powerKw) : null,
      power_ps: raw.powerPs !== undefined ? Number(raw.powerPs) : null,
      number_of_doors: raw.numberOfDoors ?? null,
      color: raw.color || null,
      manufacturer_color_name: raw.manufacturerColorName || null,
      metallic: raw.metallic ?? null,
      matte_color: raw.matteColor ?? null,
      hsn: raw.details?.hsn || null,
      tsn: raw.details?.tsn || null,
      weight: raw.details?.weight ?? null,
      trailer_load_braked: raw.details?.trailerLoadBraked ?? null,
      trailer_load_unbraked: raw.details?.trailerLoadUnbraked ?? null,
      drive_type: raw.details?.driveType || null,
      full_service_history: raw.details?.fullServiceHistory ?? null,
      non_smoker_vehicle: raw.details?.nonSmokerVehicle ?? null,
      new_hu_au: raw.details?.newHuAu ?? null,
      warranty: raw.details?.warranty ?? null,
    };

    return {
      dryRun: true,
      alreadyImported: Boolean(existing),
      existingCarId: existing?.id || null,
      source: {
        externalId: raw.id,
        dealershipSlug: CARMUCA_CONFIG.dealershipSlug,
        rawMake: raw.make,
        rawModel: raw.model,
        rawTitle: raw.title,
        vatEligible: typeof raw.vatEligible === "boolean" ? raw.vatEligible : null,
      },
      proposedMapping,
      imageCount: rawImages.length,
      sampleImageUrl: rawImages[0] || null,
      missingFields,
      metadataPreview,
      notice: "Dry-run preview completed. No records or media files were written to the database or storage.",
    };
  }

  /**
   * Download a single photo from Carmuca with host validation, timeouts, and size check
   */
  async _downloadPhoto(urlStr) {
    validateMediaHost(urlStr);

    let lastError = null;
    for (let attempt = 1; attempt <= CARMUCA_CONFIG.maxRetries; attempt++) {
      try {
        const response = await fetch(urlStr, {
          signal: AbortSignal.timeout(CARMUCA_CONFIG.downloadTimeoutMs),
          redirect: "follow",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = (response.headers.get("content-type") || "image/jpeg").toLowerCase();
        const contentLength = Number(response.headers.get("content-length") || 0);

        if (contentLength > CARMUCA_CONFIG.maxImageSizeBytes) {
          throw new Error(`Image size exceeds limit of ${CARMUCA_CONFIG.maxImageSizeBytes} bytes.`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > CARMUCA_CONFIG.maxImageSizeBytes) {
          throw new Error(`Downloaded image size (${buffer.length} bytes) exceeds limit.`);
        }

        // Determine clean extension
        let ext = "jpg";
        if (contentType.includes("png")) ext = "png";
        else if (contentType.includes("webp")) ext = "webp";
        else if (contentType.includes("avif")) ext = "avif";

        return { buffer, mimeType: contentType.split(";")[0], ext };
      } catch (err) {
        lastError = err;
        if (attempt < CARMUCA_CONFIG.maxRetries) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
    }

    throw new Error(`Failed to download photo after ${CARMUCA_CONFIG.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Download and copy vehicle photos into existing media storage:
   * - Preserves photo order and cover selection (first image is cover/thumbnail).
   * - Validates hosts, redirects, file types, sizes, timeouts.
   * - Bounded retries.
   * - Cleans up only newly created assets on failure.
   */
  async _copyVehicleMedia(vehicleId, imageUrls) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return { durableUrls: [], uploadedPaths: [] };
    }

    const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
    const uploadedPaths = [];
    const durableUrls = new Array(imageUrls.length);

    try {
      const CONCURRENCY = 4;
      for (let i = 0; i < imageUrls.length; i += CONCURRENCY) {
        const chunk = imageUrls.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (urlStr, chunkIdx) => {
            const index = i + chunkIdx;
            const { buffer, mimeType, ext } = await this._downloadPhoto(urlStr);

            const fileName = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
            const filePath = `cars/images/carmuca-${vehicleId.substring(0, 8)}-${fileName}`;

            const uploadRes = await storageService.uploadFile({
              bucket: BUCKET,
              filePath,
              fileBuffer: buffer,
              mimeType,
            });

            uploadedPaths.push(filePath);
            durableUrls[index] = uploadRes.publicUrl;
          })
        );
      }

      return { durableUrls: durableUrls.filter(Boolean), uploadedPaths };
    } catch (err) {
      // CLEANUP: Delete only files uploaded during this failed operation
      if (uploadedPaths.length > 0) {
        console.warn(`[CarmucaImport] Cleaning up ${uploadedPaths.length} uploaded files after failure: ${err.message}`);
        await storageService.deleteFiles({ bucket: BUCKET, filePaths: uploadedPaths }).catch((cleanErr) => {
          console.error("[CarmucaImport] Cleanup error:", cleanErr.message);
        });
      }
      throw err;
    }
  }

  /**
   * Execute controlled single-vehicle import:
   * 1. Check if already imported; if so, safely return existing record.
   * 2. Fetch fresh vehicle details from Carmuca (ensuring fresh signed photo URLs).
   * 3. Copy vehicle photos into media storage (with validation, durable links, and failure cleanup).
   * 4. Save vehicle as draft (status: "HIDDEN", is_visible: false).
   * 5. Preserve Brand + Name, specs, equipment, accurate VAT, metadata.
   */
  async executeImport(vehicleId) {
    // 1. Check if already imported
    const existing = await this.findExistingImport(vehicleId);
    if (existing) {
      return {
        success: true,
        already_imported: true,
        car: existing,
        message: "Vehicle has already been imported. Existing record preserved without overwriting.",
      };
    }

    // 2. Fetch fresh Carmuca details immediately before download
    const raw = await this.fetchRemoteVehicle(vehicleId);

    // Double check with resolved Carmuca UUID in case stockNumber was provided
    if (raw.id && raw.id !== vehicleId) {
      const existingByUuid = await this.findExistingImport(raw.id);
      if (existingByUuid) {
        return {
          success: true,
          already_imported: true,
          car: existingByUuid,
          message: "Vehicle has already been imported. Existing record preserved without overwriting.",
        };
      }
    }

    const rawVehicleId = raw.id || vehicleId;
    const rawImages = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];

    // 3. Copy photos to persistent media storage
    const { durableUrls, uploadedPaths } = await this._copyVehicleMedia(rawVehicleId, rawImages);

    // 4. Map fields
    const make = raw.make ? String(raw.make).trim() : "Unbekannt";
    const model = raw.model ? String(raw.model).trim() : "";
    const rawTitle = raw.title ? String(raw.title).trim() : "";
    const cleanName = cleanVehicleName(rawTitle, make, model);

    const grossPrice = raw.grossPrice !== null && raw.grossPrice !== undefined && raw.grossPrice !== ""
      ? Number(raw.grossPrice)
      : null;
    const netPrice = raw.netPrice !== null && raw.netPrice !== undefined && raw.netPrice !== ""
      ? Number(raw.netPrice)
      : null;
    const price = grossPrice ?? netPrice ?? 0;

    const mileageKm = raw.mileage !== null && raw.mileage !== undefined && raw.mileage !== ""
      ? Number(raw.mileage)
      : null;

    const rawFuel = raw.fuelType ? String(raw.fuelType).toLowerCase().trim() : null;
    const fuelType = rawFuel && FUEL_MAP[rawFuel] ? FUEL_MAP[rawFuel] : (rawFuel ? "OTHER" : null);

    const rawTrans = raw.transmission ? String(raw.transmission).toLowerCase().trim() : null;
    const transmission = rawTrans && TRANSMISSION_MAP[rawTrans] ? TRANSMISSION_MAP[rawTrans] : null;

    const rawBody = raw.bodyType ? String(raw.bodyType).toLowerCase().trim() : null;
    const category = rawBody && BODY_TYPE_MAP[rawBody] ? BODY_TYPE_MAP[rawBody] : null;

    const performanceHp = raw.powerPs !== null && raw.powerPs !== undefined && raw.powerPs !== ""
      ? Number(raw.powerPs)
      : null;

    const firstRegistration = raw.firstRegistrationDate || (raw.year ? `${raw.year}-01-01` : null);

    const engineDisplacementCc = raw.engineDisplacement !== null && raw.engineDisplacement !== undefined && raw.engineDisplacement !== ""
      ? Number(raw.engineDisplacement)
      : null;

    const seats = raw.numberOfSeats !== null && raw.numberOfSeats !== undefined && raw.numberOfSeats !== ""
      ? Number(raw.numberOfSeats)
      : null;

    const vehicleOwners = raw.previousOwners !== null && raw.previousOwners !== undefined && raw.previousOwners !== ""
      ? Number(raw.previousOwners)
      : null;

    const equipment = extractEquipment(raw.details);
    const descriptionDe = raw.description || raw.details?.description || null;

    const slug = await generateUniqueSlug(make, model || cleanName, cleanName);

    // Durable media object
    const media = {
      thumbnail: durableUrls[0] || null,
      gallery: durableUrls,
      video: null,
      images_360: [],
      model_3d: null,
    };

    // Metadata preservation in custom_fields
    const customFields = {
      source: "carmuca",
      dealership_slug: CARMUCA_CONFIG.dealershipSlug,
      external_id: rawVehicleId,
      stock_number: raw.stockNumber || null,
      vin: raw.vin || null,
      gross_price: grossPrice,
      net_price: netPrice,
      vat_eligible: typeof raw.vatEligible === "boolean" ? raw.vatEligible : null,
      currency: "EUR",
      co2_emission: raw.co2Emission ?? raw.wltpCo2Emission ?? null,
      emission_class: raw.emissionClass || null,
      co2_class: raw.co2Class || null,
      general_inspection: raw.generalInspection || null,
      power_kw: raw.powerKw !== undefined ? Number(raw.powerKw) : null,
      power_ps: raw.powerPs !== undefined ? Number(raw.powerPs) : null,
      number_of_doors: raw.numberOfDoors ?? null,
      color: raw.color || null,
      manufacturer_color_name: raw.manufacturerColorName || null,
      metallic: raw.metallic ?? null,
      matte_color: raw.matteColor ?? null,
      hsn: raw.details?.hsn || null,
      tsn: raw.details?.tsn || null,
      weight: raw.details?.weight ?? null,
      trailer_load_braked: raw.details?.trailerLoadBraked ?? null,
      trailer_load_unbraked: raw.details?.trailerLoadUnbraked ?? null,
      drive_type: raw.details?.driveType || null,
      full_service_history: raw.details?.fullServiceHistory ?? null,
      non_smoker_vehicle: raw.details?.nonSmokerVehicle ?? null,
      new_hu_au: raw.details?.newHuAu ?? null,
      warranty: raw.details?.warranty ?? null,
    };

    const hasSource = await this._hasSourceColumn();

    // Insert payload
    const insertPayload = {
      brand: make,
      model: model || cleanName,
      title: cleanName,
      slug,
      price,
      // Draft state: excluded from public listings
      status: "HIDDEN",
      is_visible: false,
      is_featured: false,
      condition: raw.condition || "USED",
      fuel_type: fuelType,
      transmission,
      category,
      mileage_km: mileageKm,
      first_registration: firstRegistration,
      performance_hp: performanceHp,
      engine_displacement_cc: engineDisplacementCc,
      seats,
      vehicle_owners: vehicleOwners,
      interior_design: raw.details?.interiorType || null,
      interior_color: raw.interiorColor || null,
      air_conditioning: Boolean(raw.details?.climatisation),
      camera: Array.isArray(raw.details?.parkingAssistants) &&
        (raw.details.parkingAssistants.includes("REAR_VIEW_CAMERA") || raw.details.parkingAssistants.includes("CAMERA_360")),
      equipment,
      description_de: descriptionDe,
      description_en: null,
      media,
      custom_fields: customFields,
    };

    if (hasSource) {
      insertPayload.source = "carmuca";
      insertPayload.dealership_slug = CARMUCA_CONFIG.dealershipSlug;
      insertPayload.external_id = rawVehicleId;
    }

    // 5. Insert into database
    let createdCar = null;
    try {
      const { data, error } = await supabase
        .from("cars")
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        throw new Error(`Database insert failed: ${error.message}`);
      }
      createdCar = data;
    } catch (dbErr) {
      // CLEANUP: If DB insert fails, clean up uploaded storage assets
      const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
      if (uploadedPaths.length > 0) {
        console.warn(`[CarmucaImport] Cleaning up ${uploadedPaths.length} storage files due to DB failure: ${dbErr.message}`);
        await storageService.deleteFiles({ bucket: BUCKET, filePaths: uploadedPaths }).catch((cleanErr) => {
          console.error("[CarmucaImport] DB error cleanup failed:", cleanErr.message);
        });
      }
      throw dbErr;
    }

    return {
      success: true,
      already_imported: false,
      car: createdCar,
      image_count: durableUrls.length,
      message: `Vehicle "${createdCar.title}" successfully imported as draft with ${durableUrls.length} photos.`,
    };
  }
}

module.exports = new CarmucaImportService();
