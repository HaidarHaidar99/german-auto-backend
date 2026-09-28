/**
 * Form service — all business logic for the forms module.
 *
 * Forms table columns: id, form_type, data (JSONB), status, admin_notes,
 *                      created_at, updated_at, user_id (FK → users.id, nullable)
 *
 * All submission payload goes into the `data` JSONB field.
 * Image references (Storage paths) are stored inside data.images — never binary in PG.
 */

const supabase = require("../config/supabase");
const storageService = require("./storage.service");
const notificationService = require("./notification.service");

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Maximum image uploads per Sell Your Car submission */
const MAX_SELL_IMAGES = 5;

/** Max file size for form-uploaded images: 10 MB */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Accepted MIME types for form image uploads */
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** Storage bucket for sell-your-car images */
const SELL_CAR_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
const SELL_CAR_PREFIX = "forms/sell-car";

// Columns exposed in admin list (lightweight — no data JSONB blob for performance)
const ADMIN_LIST_COLUMNS = "id, form_type, status, admin_notes, user_id, created_at, updated_at";

// Columns exposed in admin detail (full data)
const ADMIN_DETAIL_COLUMNS = "id, form_type, data, status, admin_notes, user_id, created_at, updated_at";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

function parseBool(v) {
  if (v === true || v === "true" || v === "yes") return true;
  if (v === false || v === "false" || v === "no") return false;
  return null;
}

// ─── Form service class ────────────────────────────────────────────────────────

class FormService {

  // ── Contact form submission ──────────────────────────────────────────────────

  /**
   * Submit a CONTACT form.
   * Optional userId: if provided, associates the form with the authenticated user.
   * No regarding enum is hard-coded — the value is stored verbatim from the client.
   */
  async submitContact({ body, userId = null }) {
    const formData = {
      name:            body.name.trim(),
      email:           body.email.trim().toLowerCase(),
      phone:           body.phone ? body.phone.trim() : null,
      regarding:       body.regarding.trim(),
      message:         body.message.trim(),
      privacy_consent: true,
      submitted_at:    new Date().toISOString(),
    };

    const insert = {
      form_type:   "CONTACT",
      status:      "NEW",
      data:        formData,
      user_id:     userId || null,
    };

    const { data, error } = await supabase
      .from("forms")
      .insert(insert)
      .select("id, form_type, status, created_at")
      .single();

    if (error) throw new Error(`Failed to save contact form: ${error.message}`);

    // Trigger notification generation safely
    notificationService.notifyNewContactForm(data).catch(() => {});

    return {
      message: "Thank you for your message. We will be in touch shortly.",
      submission_id: data.id,
    };
  }

  // ── Sell Your Car form submission ─────────────────────────────────────────────

  /**
   * Submit a SELL_CAR form.
   * `files` is an optional array of validated file objects from multipart parsing:
   *   [{ originalname, mimetype, size, buffer }]
   *
   * Files are uploaded to Supabase Storage; only paths stored in data.images.
   */
  async submitSellCar({ body, files = [], userId = null }) {
    // ── Validate and upload images ────────────────────────────────────────────
    if (files.length > MAX_SELL_IMAGES) {
      throw opError(`Maximum ${MAX_SELL_IMAGES} images allowed per submission.`, 422);
    }

    const imageRefs = [];
    for (const file of files) {
      // Validate mime + size
      if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
        throw opError(
          `Invalid image type: ${file.mimetype}. Allowed: ${ALLOWED_IMAGE_MIMES.join(", ")}.`,
          422
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw opError(
          `Image "${file.originalname}" exceeds the 10 MB limit.`,
          422
        );
      }

      const ext = file.originalname.split(".").pop().toLowerCase() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `${SELL_CAR_PREFIX}/${fileName}`;

      const uploaded = await storageService.uploadFile({
        bucket:     SELL_CAR_BUCKET,
        filePath,
        fileBuffer: file.buffer,
        mimeType:   file.mimetype,
      });

      imageRefs.push({
        path:       uploaded.path,
        public_url: uploaded.publicUrl,
        name:       file.originalname,
        size:       file.size,
      });
    }

    // ── Build the registration date ───────────────────────────────────────────
    let firstRegistration = null;
    if (body.registration_day && body.registration_month && body.registration_year) {
      const day   = String(parseInt(body.registration_day, 10)).padStart(2, "0");
      const month = String(parseInt(body.registration_month, 10)).padStart(2, "0");
      const year  = String(parseInt(body.registration_year, 10));
      firstRegistration = `${year}-${month}-${day}`;
    } else if (body.first_registration) {
      firstRegistration = body.first_registration;
    }

    // ── Build form data JSONB ─────────────────────────────────────────────────
    const formData = {
      // Vehicle data
      brand:              body.brand.trim(),
      model:              body.model.trim(),
      first_registration: firstRegistration,
      vin:                body.vin.trim().toUpperCase(),

      // Vehicle details
      postal_code:   body.postal_code.trim().toUpperCase(),
      mileage_km:    Number(body.mileage_km),
      accident_free: parseBool(body.accident_free),
      repainting:    parseBool(body.repainting),
      additional_info: body.additional_info ? body.additional_info.trim() : null,
      min_price:     body.min_price !== undefined && body.min_price !== null && body.min_price !== ""
        ? Number(body.min_price)
        : null,
      images:        imageRefs,

      // Contact
      first_name:        body.first_name.trim(),
      last_name:         body.last_name.trim(),
      email:             body.email.trim().toLowerCase(),
      phone:             body.phone.trim(),
      preferred_contact: String(body.preferred_contact).toUpperCase(),
      privacy_consent:   true,
      submitted_at:      new Date().toISOString(),
    };

    const insert = {
      form_type: "SELL_CAR",
      status:    "NEW",
      data:      formData,
      user_id:   userId || null,
    };

    const { data: saved, error } = await supabase
      .from("forms")
      .insert(insert)
      .select("id, form_type, status, created_at")
      .single();

    if (error) {
      // If DB insert fails, clean up already-uploaded images
      if (imageRefs.length > 0) {
        const paths = imageRefs.map((r) => r.path);
        await storageService.deleteFiles({ bucket: SELL_CAR_BUCKET, filePaths: paths });
      }
      throw new Error(`Failed to save sell-car form: ${error.message}`);
    }

    // Trigger notification generation safely
    notificationService.notifyNewSellCarForm(saved).catch(() => {});

    return {
      message: "Your vehicle submission has been received. We will contact you shortly.",
      submission_id: saved.id,
    };
  }

  // ── Admin: list forms ─────────────────────────────────────────────────────────

  /**
   * List forms with server-side filtering, sorting, and pagination.
   * Returns lightweight rows (no data JSONB blob) for performance.
   */
  async listForms(queryParams) {
    const {
      form_type,
      status,
      page  = 1,
      limit = DEFAULT_PAGE_SIZE,
      sort  = "newest",
    } = queryParams;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
    const from     = (pageNum - 1) * pageSize;
    const to       = from + pageSize - 1;

    let query = supabase
      .from("forms")
      .select(ADMIN_LIST_COLUMNS, { count: "exact" });

    if (form_type) query = query.eq("form_type", form_type);
    if (status)    query = query.eq("status", status);

    query = sort === "oldest"
      ? query.order("created_at", { ascending: true })
      : query.order("created_at", { ascending: false });

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list forms: ${error.message}`);

    return {
      forms: data || [],
      meta: {
        total: count || 0,
        page:  pageNum,
        limit: pageSize,
        pages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  // ── Admin: get single form ────────────────────────────────────────────────────

  /**
   * Get a single form by ID with full data JSONB.
   */
  async getForm(id) {
    if (!id) throw opError("Form ID is required.", 400);

    const { data, error } = await supabase
      .from("forms")
      .select(ADMIN_DETAIL_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch form: ${error.message}`);
    if (!data) throw opError("Form not found.", 404);

    return data;
  }

  // ── Admin: update form status / notes ────────────────────────────────────────

  /**
   * Update a form's status and/or admin notes.
   */
  async updateForm(id, { status, admin_notes }) {
    await this.getForm(id); // verify existence

    const update = { updated_at: new Date().toISOString() };
    if (status !== undefined)      update.status      = status;
    if (admin_notes !== undefined) update.admin_notes = admin_notes;

    const { data, error } = await supabase
      .from("forms")
      .update(update)
      .eq("id", id)
      .select(ADMIN_DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update form: ${error.message}`);
    return data;
  }

  // ── Internal: delete form and its storage files (for testing cleanup) ──────

  /**
   * Delete a form by ID and remove any associated Storage files.
   * Used internally by tests — not exposed as a public endpoint.
   */
  async _deleteFormAndFiles(id) {
    const form = await this.getForm(id).catch(() => null);
    if (!form) return;

    // Clean up sell-car images if any
    if (form.form_type === "SELL_CAR" && form.data && Array.isArray(form.data.images)) {
      const paths = form.data.images.map((img) => img.path).filter(Boolean);
      if (paths.length > 0) {
        await storageService.deleteFiles({ bucket: SELL_CAR_BUCKET, filePaths: paths });
      }
    }

    await supabase.from("forms").delete().eq("id", id);
  }
}

module.exports = new FormService();
