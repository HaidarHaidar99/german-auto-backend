/**
 * Cars validator — validates car create/update request bodies
 * All checks are defensive and reject clearly invalid data.
 */

// ─── Enums from DB schema ────────────────────────────────────────────────────
const VALID_STATUS = ["AVAILABLE", "RESERVED", "SOLD", "HIDDEN"];
const VALID_CONDITION = ["NEW", "USED", "CERTIFIED"];
const VALID_FUEL = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID", "PLUGIN_HYBRID", "LPG", "HYDROGEN", "OTHER"];
const VALID_TRANSMISSION = ["MANUAL", "AUTOMATIC", "SEMI_AUTOMATIC"];
const VALID_CATEGORY = ["SEDAN", "SUV", "COUPE", "CONVERTIBLE", "WAGON", "HATCHBACK", "VAN", "TRUCK", "MOTORCYCLE", "OTHER"];
const VALID_INTERIOR = ["LEATHER", "FABRIC", "ALCANTARA", "MIXED", "OTHER"];

// Max sensible string lengths
const MAX_SHORT = 200;
const MAX_LONG = 20000;
const MAX_SLUG = 300;

const isString = (v) => typeof v === "string";
const isNonEmpty = (v) => isString(v) && v.trim().length > 0;
const isPositiveNum = (v) => typeof v === "number" && isFinite(v) && v >= 0;

/**
 * Validate fields for car creation (all required fields must be present)
 */
const createCarValidator = (req) => {
  const b = req.body || {};
  const errors = {};

  // Required string fields
  if (!isNonEmpty(b.brand) || b.brand.trim().length > MAX_SHORT) {
    errors.brand = "Brand is required (max 200 chars).";
  }
  if (!isNonEmpty(b.model) || b.model.trim().length > MAX_SHORT) {
    errors.model = "Model is required (max 200 chars).";
  }
  if (!isNonEmpty(b.title) || b.title.trim().length > MAX_SHORT) {
    errors.title = "Title is required (max 200 chars).";
  }

  // Price — required, >= 0
  if (b.price === undefined || b.price === null || !isPositiveNum(Number(b.price))) {
    errors.price = "Price must be a non-negative number.";
  }

  // Optional numeric fields with bounds
  if (b.old_price !== undefined && b.old_price !== null && !isPositiveNum(Number(b.old_price))) {
    errors.old_price = "Old price must be a non-negative number.";
  }
  if (b.mileage_km !== undefined && b.mileage_km !== null && !isPositiveNum(Number(b.mileage_km))) {
    errors.mileage_km = "Mileage must be a non-negative number.";
  }
  if (b.engine_displacement_cc !== undefined && b.engine_displacement_cc !== null && !isPositiveNum(Number(b.engine_displacement_cc))) {
    errors.engine_displacement_cc = "Engine displacement must be a non-negative number.";
  }
  if (b.performance_hp !== undefined && b.performance_hp !== null && !isPositiveNum(Number(b.performance_hp))) {
    errors.performance_hp = "Horsepower must be a non-negative number.";
  }
  if (b.seats !== undefined && b.seats !== null) {
    const s = Number(b.seats);
    if (!Number.isInteger(s) || s < 1 || s > 100) {
      errors.seats = "Seats must be a positive integer (1–100).";
    }
  }
  if (b.vehicle_owners !== undefined && b.vehicle_owners !== null) {
    const o = Number(b.vehicle_owners);
    if (!Number.isInteger(o) || o < 0 || o > 100) {
      errors.vehicle_owners = "Vehicle owners must be a non-negative integer (0–100).";
    }
  }

  // Enum fields
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    errors.status = `Status must be one of: ${VALID_STATUS.join(", ")}.`;
  }
  if (b.condition !== undefined && !VALID_CONDITION.includes(b.condition)) {
    errors.condition = `Condition must be one of: ${VALID_CONDITION.join(", ")}.`;
  }
  if (b.fuel_type !== undefined && !VALID_FUEL.includes(b.fuel_type)) {
    errors.fuel_type = `Fuel type must be one of: ${VALID_FUEL.join(", ")}.`;
  }
  if (b.transmission !== undefined && !VALID_TRANSMISSION.includes(b.transmission)) {
    errors.transmission = `Transmission must be one of: ${VALID_TRANSMISSION.join(", ")}.`;
  }
  if (b.category !== undefined && !VALID_CATEGORY.includes(b.category)) {
    errors.category = `Category must be one of: ${VALID_CATEGORY.join(", ")}.`;
  }
  if (b.interior_design !== undefined && !VALID_INTERIOR.includes(b.interior_design)) {
    errors.interior_design = `Interior design must be one of: ${VALID_INTERIOR.join(", ")}.`;
  }

  // Date field
  if (b.first_registration !== undefined && b.first_registration !== null) {
    const d = new Date(b.first_registration);
    if (isNaN(d.getTime())) {
      errors.first_registration = "First registration must be a valid date string.";
    } else if (d.getFullYear() < 1900 || d > new Date()) {
      errors.first_registration = "First registration must be between 1900 and today.";
    }
  }

  // Long text strings
  if (b.description_de !== undefined && isString(b.description_de) && b.description_de.length > MAX_LONG) {
    errors.description_de = `German description too long (max ${MAX_LONG} chars).`;
  }
  if (b.description_en !== undefined && isString(b.description_en) && b.description_en.length > MAX_LONG) {
    errors.description_en = `English description too long (max ${MAX_LONG} chars).`;
  }

  // Slug (optional on create — auto-generated if missing)
  if (b.slug !== undefined && isString(b.slug) && b.slug.length > MAX_SLUG) {
    errors.slug = `Slug too long (max ${MAX_SLUG} chars).`;
  }

  // Boolean fields
  for (const flag of ["is_featured", "is_visible", "air_conditioning", "camera"]) {
    if (b[flag] !== undefined && typeof b[flag] !== "boolean" && b[flag] !== "true" && b[flag] !== "false") {
      errors[flag] = `${flag} must be a boolean.`;
    }
  }

  // JSON / array fields
  if (b.equipment !== undefined && !Array.isArray(b.equipment)) {
    errors.equipment = "Equipment must be an array.";
  }
  if (b.custom_fields !== undefined && (typeof b.custom_fields !== "object" || Array.isArray(b.custom_fields) || b.custom_fields === null)) {
    errors.custom_fields = "Custom fields must be a plain object.";
  }
  if (b.media !== undefined) {
    if (typeof b.media !== "object" || Array.isArray(b.media) || b.media === null) {
      errors.media = "Media must be a plain object.";
    } else {
      // Validate gallery array length
      if (b.media.gallery !== undefined) {
        if (!Array.isArray(b.media.gallery)) {
          errors.media = "media.gallery must be an array.";
        } else if (b.media.gallery.length > 20) {
          errors.media = "media.gallery cannot exceed 20 images.";
        }
      }
    }
  }

  return errors;
};

/**
 * Validate fields for car update (all fields optional but validated if present)
 */
const updateCarValidator = (req) => {
  // Reuse the same rules — they all guard with `if (b.field !== undefined)` for optional fields.
  // For updates, brand/model/title/price are also optional.
  const b = req.body || {};
  const errors = {};

  if (b.brand !== undefined && (!isNonEmpty(b.brand) || b.brand.trim().length > MAX_SHORT)) {
    errors.brand = "Brand must be a non-empty string (max 200 chars).";
  }
  if (b.model !== undefined && (!isNonEmpty(b.model) || b.model.trim().length > MAX_SHORT)) {
    errors.model = "Model must be a non-empty string (max 200 chars).";
  }
  if (b.title !== undefined && (!isNonEmpty(b.title) || b.title.trim().length > MAX_SHORT)) {
    errors.title = "Title must be a non-empty string (max 200 chars).";
  }
  if (b.price !== undefined && !isPositiveNum(Number(b.price))) {
    errors.price = "Price must be a non-negative number.";
  }
  if (b.old_price !== undefined && b.old_price !== null && !isPositiveNum(Number(b.old_price))) {
    errors.old_price = "Old price must be a non-negative number.";
  }
  if (b.mileage_km !== undefined && b.mileage_km !== null && !isPositiveNum(Number(b.mileage_km))) {
    errors.mileage_km = "Mileage must be a non-negative number.";
  }
  if (b.engine_displacement_cc !== undefined && b.engine_displacement_cc !== null && !isPositiveNum(Number(b.engine_displacement_cc))) {
    errors.engine_displacement_cc = "Engine displacement must be a non-negative number.";
  }
  if (b.performance_hp !== undefined && b.performance_hp !== null && !isPositiveNum(Number(b.performance_hp))) {
    errors.performance_hp = "Horsepower must be a non-negative number.";
  }
  if (b.seats !== undefined && b.seats !== null) {
    const s = Number(b.seats);
    if (!Number.isInteger(s) || s < 1 || s > 100) errors.seats = "Seats must be a positive integer (1–100).";
  }
  if (b.vehicle_owners !== undefined && b.vehicle_owners !== null) {
    const o = Number(b.vehicle_owners);
    if (!Number.isInteger(o) || o < 0 || o > 100) errors.vehicle_owners = "Vehicle owners must be a non-negative integer.";
  }
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    errors.status = `Status must be one of: ${VALID_STATUS.join(", ")}.`;
  }
  if (b.condition !== undefined && !VALID_CONDITION.includes(b.condition)) {
    errors.condition = `Condition must be one of: ${VALID_CONDITION.join(", ")}.`;
  }
  if (b.fuel_type !== undefined && !VALID_FUEL.includes(b.fuel_type)) {
    errors.fuel_type = `Fuel type must be one of: ${VALID_FUEL.join(", ")}.`;
  }
  if (b.transmission !== undefined && !VALID_TRANSMISSION.includes(b.transmission)) {
    errors.transmission = `Transmission must be one of: ${VALID_TRANSMISSION.join(", ")}.`;
  }
  if (b.category !== undefined && !VALID_CATEGORY.includes(b.category)) {
    errors.category = `Category must be one of: ${VALID_CATEGORY.join(", ")}.`;
  }
  if (b.interior_design !== undefined && !VALID_INTERIOR.includes(b.interior_design)) {
    errors.interior_design = `Interior design must be one of: ${VALID_INTERIOR.join(", ")}.`;
  }
  if (b.first_registration !== undefined && b.first_registration !== null) {
    const d = new Date(b.first_registration);
    if (isNaN(d.getTime()) || d.getFullYear() < 1900 || d > new Date()) {
      errors.first_registration = "First registration must be a valid date between 1900 and today.";
    }
  }
  if (b.description_de !== undefined && isString(b.description_de) && b.description_de.length > MAX_LONG) {
    errors.description_de = `German description too long (max ${MAX_LONG} chars).`;
  }
  if (b.description_en !== undefined && isString(b.description_en) && b.description_en.length > MAX_LONG) {
    errors.description_en = `English description too long (max ${MAX_LONG} chars).`;
  }
  if (b.slug !== undefined && isString(b.slug) && b.slug.length > MAX_SLUG) {
    errors.slug = `Slug too long (max ${MAX_SLUG} chars).`;
  }
  for (const flag of ["is_featured", "is_visible", "air_conditioning", "camera"]) {
    if (b[flag] !== undefined && typeof b[flag] !== "boolean" && b[flag] !== "true" && b[flag] !== "false") {
      errors[flag] = `${flag} must be a boolean.`;
    }
  }
  if (b.equipment !== undefined && !Array.isArray(b.equipment)) {
    errors.equipment = "Equipment must be an array.";
  }
  if (b.custom_fields !== undefined && (typeof b.custom_fields !== "object" || Array.isArray(b.custom_fields) || b.custom_fields === null)) {
    errors.custom_fields = "Custom fields must be a plain object.";
  }
  if (b.media !== undefined) {
    if (typeof b.media !== "object" || Array.isArray(b.media) || b.media === null) {
      errors.media = "Media must be a plain object.";
    } else if (b.media.gallery !== undefined) {
      if (!Array.isArray(b.media.gallery)) {
        errors.media = "media.gallery must be an array.";
      } else if (b.media.gallery.length > 20) {
        errors.media = "media.gallery cannot exceed 20 images.";
      }
    }
  }

  return errors;
};

/**
 * Validate query parameters for public car listing
 */
const listCarsQueryValidator = (req) => {
  const q = req.query || {};
  const errors = {};

  const VALID_SORT = ["price_asc", "price_desc", "mileage_asc", "mileage_desc", "az", "za", "newest", "oldest"];
  if (q.sort && !VALID_SORT.includes(q.sort)) {
    errors.sort = `Sort must be one of: ${VALID_SORT.join(", ")}.`;
  }

  if (q.page !== undefined) {
    const p = Number(q.page);
    if (!Number.isInteger(p) || p < 1) errors.page = "Page must be a positive integer.";
  }
  if (q.limit !== undefined) {
    const l = Number(q.limit);
    if (!Number.isInteger(l) || l < 1 || l > 100) errors.limit = "Limit must be between 1 and 100.";
  }
  if (q.min_price !== undefined && isNaN(Number(q.min_price))) {
    errors.min_price = "min_price must be a number.";
  }
  if (q.max_price !== undefined && isNaN(Number(q.max_price))) {
    errors.max_price = "max_price must be a number.";
  }
  if (q.min_mileage !== undefined && isNaN(Number(q.min_mileage))) {
    errors.min_mileage = "min_mileage must be a number.";
  }
  if (q.max_mileage !== undefined && isNaN(Number(q.max_mileage))) {
    errors.max_mileage = "max_mileage must be a number.";
  }
  if (q.fuel_type && !VALID_FUEL.includes(q.fuel_type)) {
    errors.fuel_type = `fuel_type must be one of: ${VALID_FUEL.join(", ")}.`;
  }
  if (q.transmission && !VALID_TRANSMISSION.includes(q.transmission)) {
    errors.transmission = `transmission must be one of: ${VALID_TRANSMISSION.join(", ")}.`;
  }
  if (q.condition && !VALID_CONDITION.includes(q.condition)) {
    errors.condition = `condition must be one of: ${VALID_CONDITION.join(", ")}.`;
  }
  if (q.category && !VALID_CATEGORY.includes(q.category)) {
    errors.category = `category must be one of: ${VALID_CATEGORY.join(", ")}.`;
  }

  return errors;
};

module.exports = {
  createCarValidator,
  updateCarValidator,
  listCarsQueryValidator,
  VALID_STATUS,
  VALID_CONDITION,
  VALID_FUEL,
  VALID_TRANSMISSION,
  VALID_CATEGORY,
};
