/**
 * Form validators — Contact and Sell Your Car submission validation,
 * plus admin list/update validators.
 *
 * All field values are stored in the forms.data JSONB column.
 * No business-specific regarding options are hard-coded here.
 */

// ─── Shared helpers ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// International phone: optional +, digits, spaces, dashes, parentheses, 7–20 chars total
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

// Basic VIN: 17 alphanumeric characters (standard global VIN)
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

// UK/EU postal code pattern — permissive (digits, letters, spaces/hyphens, 3–10 chars)
const POSTAL_RE = /^[A-Z0-9][A-Z0-9\s\-]{1,8}[A-Z0-9]$/i;

const isStr = (v) => typeof v === "string";
const isNonEmpty = (v) => isStr(v) && v.trim().length > 0;

const VALID_STATUSES = ["NEW", "READ", "IN_PROGRESS", "COMPLETED", "ARCHIVED"];
const VALID_FORM_TYPES = ["CONTACT", "SELL_CAR"];
const VALID_CONTACT_METHODS = ["EMAIL", "WHATSAPP", "PHONE"];
const VALID_YES_NO = ["yes", "no", true, false, "true", "false"];

// ─── Contact form ──────────────────────────────────────────────────────────────

/**
 * Validate CONTACT form submission body.
 */
const contactFormValidator = (req) => {
  const b = req.body || {};
  const errors = {};

  if (!isNonEmpty(b.name) || b.name.trim().length < 2 || b.name.trim().length > 120) {
    errors.name = "Name must be between 2 and 120 characters.";
  }

  if (!isNonEmpty(b.email) || !EMAIL_RE.test(b.email.trim())) {
    errors.email = "A valid email address is required.";
  }

  if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
    if (!isStr(b.phone) || !PHONE_RE.test(b.phone.trim())) {
      errors.phone = "Please provide a valid phone number (7–20 digits).";
    }
  }

  if (!isNonEmpty(b.regarding) || b.regarding.trim().length > 200) {
    errors.regarding = "Please select a topic (max 200 chars).";
  }

  if (!isNonEmpty(b.message) || b.message.trim().length < 10 || b.message.trim().length > 5000) {
    errors.message = "Message must be between 10 and 5000 characters.";
  }

  if (b.privacy_consent !== true && b.privacy_consent !== "true") {
    errors.privacy_consent = "You must accept the privacy policy to proceed.";
  }

  return errors;
};

// ─── Sell Your Car form ────────────────────────────────────────────────────────

/**
 * Validate SELL_CAR form submission body.
 * Images are validated separately in the service (multipart).
 */
const sellCarFormValidator = (req) => {
  const b = req.body || {};
  const errors = {};

  // ── Vehicle data ─────────────────────────────────────────────────────────────
  if (!isNonEmpty(b.brand) || b.brand.trim().length > 100) {
    errors.brand = "Vehicle brand is required (max 100 chars).";
  }

  if (!isNonEmpty(b.model) || b.model.trim().length > 100) {
    errors.model = "Vehicle model is required (max 100 chars).";
  }

  // First registration: accept day/month/year separately OR as a date string
  if (b.registration_day !== undefined || b.registration_month !== undefined || b.registration_year !== undefined) {
    const day   = parseInt(b.registration_day, 10);
    const month = parseInt(b.registration_month, 10);
    const year  = parseInt(b.registration_year, 10);
    const now   = new Date();

    if (!day || day < 1 || day > 31) errors.registration_day = "Day must be between 1 and 31.";
    if (!month || month < 1 || month > 12) errors.registration_month = "Month must be between 1 and 12.";
    if (!year || year < 1900 || year > now.getFullYear()) {
      errors.registration_year = `Year must be between 1900 and ${now.getFullYear()}.`;
    }
    if (!errors.registration_day && !errors.registration_month && !errors.registration_year) {
      const d = new Date(year, month - 1, day);
      if (d > now) errors.registration_day = "First registration date cannot be in the future.";
    }
  } else if (isNonEmpty(b.first_registration)) {
    const d = new Date(b.first_registration);
    if (isNaN(d.getTime()) || d.getFullYear() < 1900 || d > new Date()) {
      errors.first_registration = "First registration must be a valid past date.";
    }
  } else {
    errors.first_registration = "First registration date is required.";
  }

  // VIN: required, must match standard 17-char format
  if (!isNonEmpty(b.vin)) {
    errors.vin = "VIN is required.";
  } else if (!VIN_RE.test(b.vin.trim())) {
    errors.vin = "VIN must be exactly 17 alphanumeric characters (I, O, Q not allowed).";
  }

  // ── Vehicle details ───────────────────────────────────────────────────────────
  if (!isNonEmpty(b.postal_code) || !POSTAL_RE.test(b.postal_code.trim())) {
    errors.postal_code = "A valid postal code is required.";
  }

  if (b.mileage_km === undefined || b.mileage_km === null || b.mileage_km === "") {
    errors.mileage_km = "Mileage in km is required.";
  } else {
    const mileage = Number(b.mileage_km);
    if (!isFinite(mileage) || mileage < 0 || mileage > 9999999) {
      errors.mileage_km = "Mileage must be a non-negative number (max 9,999,999 km).";
    }
  }

  const boolCheck = (field) => {
    const v = b[field];
    return v === true || v === false || v === "true" || v === "false" || v === "yes" || v === "no";
  };
  if (!boolCheck("accident_free")) {
    errors.accident_free = "Please specify if the vehicle is accident-free (yes/no).";
  }
  if (!boolCheck("repainting")) {
    errors.repainting = "Please specify if the vehicle has been repainted (yes/no).";
  }

  if (b.additional_info !== undefined && b.additional_info !== null) {
    if (!isStr(b.additional_info) || b.additional_info.length > 2000) {
      errors.additional_info = "Additional information must be a string (max 2000 chars).";
    }
  }

  if (b.min_price !== undefined && b.min_price !== null && b.min_price !== "") {
    const p = Number(b.min_price);
    if (!isFinite(p) || p < 0) {
      errors.min_price = "Minimum price must be a non-negative number.";
    }
  }

  // ── Contact information ───────────────────────────────────────────────────────
  if (!isNonEmpty(b.first_name) || b.first_name.trim().length > 80) {
    errors.first_name = "First name is required (max 80 chars).";
  }

  if (!isNonEmpty(b.last_name) || b.last_name.trim().length > 80) {
    errors.last_name = "Last name is required (max 80 chars).";
  }

  if (!isNonEmpty(b.email) || !EMAIL_RE.test(b.email.trim())) {
    errors.email = "A valid email address is required.";
  }

  if (!isNonEmpty(b.phone) || !PHONE_RE.test(b.phone.trim())) {
    errors.phone = "A valid phone number is required (7–20 digits).";
  }

  if (!b.preferred_contact || !VALID_CONTACT_METHODS.includes(String(b.preferred_contact).toUpperCase())) {
    errors.preferred_contact = `Preferred contact must be one of: ${VALID_CONTACT_METHODS.join(", ")}.`;
  }

  if (b.privacy_consent !== true && b.privacy_consent !== "true") {
    errors.privacy_consent = "You must accept the privacy policy to proceed.";
  }

  return errors;
};

// ─── Admin list query ──────────────────────────────────────────────────────────

const adminListFormsValidator = (req) => {
  const q = req.query || {};
  const errors = {};

  if (q.form_type && !VALID_FORM_TYPES.includes(q.form_type)) {
    errors.form_type = `form_type must be one of: ${VALID_FORM_TYPES.join(", ")}.`;
  }

  if (q.status && !VALID_STATUSES.includes(q.status)) {
    errors.status = `status must be one of: ${VALID_STATUSES.join(", ")}.`;
  }

  if (q.page !== undefined) {
    const p = Number(q.page);
    if (!Number.isInteger(p) || p < 1) errors.page = "Page must be a positive integer.";
  }

  if (q.limit !== undefined) {
    const l = Number(q.limit);
    if (!Number.isInteger(l) || l < 1 || l > 100) errors.limit = "Limit must be between 1 and 100.";
  }

  const VALID_SORT = ["newest", "oldest"];
  if (q.sort && !VALID_SORT.includes(q.sort)) {
    errors.sort = `sort must be one of: ${VALID_SORT.join(", ")}.`;
  }

  return errors;
};

// ─── Admin update form ─────────────────────────────────────────────────────────

const adminUpdateFormValidator = (req) => {
  const b = req.body || {};
  const errors = {};

  if (b.status !== undefined && !VALID_STATUSES.includes(b.status)) {
    errors.status = `status must be one of: ${VALID_STATUSES.join(", ")}.`;
  }

  if (b.admin_notes !== undefined && b.admin_notes !== null) {
    if (!isStr(b.admin_notes) || b.admin_notes.length > 10000) {
      errors.admin_notes = "Admin notes must be a string (max 10,000 chars).";
    }
  }

  // Must provide at least one updatable field
  if (b.status === undefined && b.admin_notes === undefined) {
    errors._base = "Must provide at least one field to update: status or admin_notes.";
  }

  return errors;
};

module.exports = {
  contactFormValidator,
  sellCarFormValidator,
  adminListFormsValidator,
  adminUpdateFormValidator,
  VALID_STATUSES,
  VALID_FORM_TYPES,
};
