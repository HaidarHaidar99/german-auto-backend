/**
 * Car service — all business logic for the cars/inventory module.
 * Controllers remain thin; this service owns all DB interaction.
 */

const supabase = require("../config/supabase");

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

/**
 * Columns returned in public list endpoints (lightweight — no large media/description blobs)
 */
const LIST_COLUMNS =
  "id, brand, model, title, slug, price, old_price, condition, fuel_type, transmission, mileage_km, first_registration, performance_hp, seats, is_featured, is_visible, status, category, media, created_at";

/**
 * Columns returned in detail endpoints (full data)
 */
const DETAIL_COLUMNS = [
  "id", "brand", "model", "title", "slug",
  "description_de", "description_en",
  "price", "old_price",
  "condition", "fuel_type", "transmission",
  "mileage_km", "first_registration",
  "engine_displacement_cc", "performance_hp",
  "seats", "vehicle_owners", "vehicle_condition",
  "air_conditioning", "camera",
  "interior_design", "interior_color",
  "equipment", "custom_fields", "media",
  "is_featured", "is_visible",
  "category", "status",
  "created_at", "updated_at",
].join(", ");

// ─── Slug generation ──────────────────────────────────────────────────────────

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
 * Generate a unique slug for a car.
 * Base: brand-model-title (truncated to 200 chars).
 * Appends a numeric suffix until unique.
 * @param {string} brand
 * @param {string} model
 * @param {string} title
 * @param {string|null} existingId  — exclude this car from the uniqueness check (for updates)
 */
async function generateUniqueSlug(brand, model, title, existingId = null) {
  const base = slugify(`${brand}-${model}-${title}`).substring(0, 200);
  let candidate = base;
  let suffix = 1;

  while (true) {
    let query = supabase
      .from("cars")
      .select("id")
      .eq("slug", candidate)
      .limit(1);

    if (existingId) {
      query = query.neq("id", existingId);
    }

    const { data } = await query;
    if (!data || data.length === 0) break;

    candidate = `${base}-${suffix}`;
    suffix++;
  }

  return candidate;
}

// ─── Operational errors ───────────────────────────────────────────────────────

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

// ─── Cars service class ───────────────────────────────────────────────────────

class CarService {

  // ── Public: list cars ───────────────────────────────────────────────────────

  /**
   * Public car listing with server-side filtering, sorting, and pagination.
   * Only returns is_visible=true, status != HIDDEN cars.
   */
  async listPublic(queryParams) {
    const {
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
      brand,
      model,
      category,
      fuel_type,
      transmission,
      condition,
      min_price,
      max_price,
      min_mileage,
      max_mileage,
      featured,
      sort = "newest",
    } = queryParams;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
    const from = (pageNum - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("cars")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("is_visible", true)
      .neq("status", "HIDDEN");

    // Filters
    if (brand) query = query.ilike("brand", `%${brand}%`);
    if (model) query = query.ilike("model", `%${model}%`);
    if (category) query = query.eq("category", category);
    if (fuel_type) query = query.eq("fuel_type", fuel_type);
    if (transmission) query = query.eq("transmission", transmission);
    if (condition) query = query.eq("condition", condition);
    if (min_price !== undefined) query = query.gte("price", Number(min_price));
    if (max_price !== undefined) query = query.lte("price", Number(max_price));
    if (min_mileage !== undefined) query = query.gte("mileage_km", Number(min_mileage));
    if (max_mileage !== undefined) query = query.lte("mileage_km", Number(max_mileage));
    if (featured === "true" || featured === true) query = query.eq("is_featured", true);

    // Sorting
    query = this._applySort(query, sort);

    // Pagination
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch cars: ${error.message}`);

    return {
      cars: data || [],
      meta: {
        total: count || 0,
        page: pageNum,
        limit: pageSize,
        pages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  // ── Public: car detail ──────────────────────────────────────────────────────

  /**
   * Fetch a single public car by slug or UUID.
   * Only visible, non-hidden cars are returned to the public.
   */
  async getPublicCar(identifier) {
    if (!identifier) throw opError("Car identifier is required.", 400);

    // Try by slug first, then fall back to UUID (if identifier looks like a UUID)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    let query = supabase
      .from("cars")
      .select(DETAIL_COLUMNS)
      .eq("is_visible", true)
      .neq("status", "HIDDEN");

    if (isUUID) {
      query = query.eq("id", identifier);
    } else {
      query = query.eq("slug", identifier);
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw new Error(`Failed to fetch car: ${error.message}`);
    if (!data) throw opError("Car not found.", 404);

    return data;
  }

  // ── Admin: get any car (including hidden) ───────────────────────────────────

  async getAdminCar(identifier) {
    if (!identifier) throw opError("Car identifier is required.", 400);

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    let query = supabase.from("cars").select(DETAIL_COLUMNS);
    if (isUUID) {
      query = query.eq("id", identifier);
    } else {
      query = query.eq("slug", identifier);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to fetch car: ${error.message}`);
    if (!data) throw opError("Car not found.", 404);

    return data;
  }

  // ── Admin: list all cars (including hidden) ─────────────────────────────────

  async listAdmin(queryParams) {
    const {
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
      brand, model, category, fuel_type, transmission, condition,
      status, featured, sort = "newest", search, is_visible,
      min_price, max_price, min_mileage, max_mileage,
    } = queryParams;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
    const from = (pageNum - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("cars")
      .select(LIST_COLUMNS, { count: "exact" });

    // Server-side text search (brand, model, title)
    if (search && typeof search === "string" && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.or(`brand.ilike.${term},model.ilike.${term},title.ilike.${term}`);
    }

    if (brand) query = query.ilike("brand", `%${brand}%`);
    if (model) query = query.ilike("model", `%${model}%`);
    if (category) query = query.eq("category", category);
    if (fuel_type) query = query.eq("fuel_type", fuel_type);
    if (transmission) query = query.eq("transmission", transmission);
    if (condition) query = query.eq("condition", condition);
    if (status && status !== "ALL") query = query.eq("status", status);
    if (featured === "true" || featured === true) query = query.eq("is_featured", true);
    if (is_visible !== undefined && is_visible !== "" && is_visible !== "ALL") {
      query = query.eq("is_visible", is_visible === "true" || is_visible === true);
    }
    if (min_price !== undefined && min_price !== "") query = query.gte("price", Number(min_price));
    if (max_price !== undefined && max_price !== "") query = query.lte("price", Number(max_price));
    if (min_mileage !== undefined && min_mileage !== "") query = query.gte("mileage_km", Number(min_mileage));
    if (max_mileage !== undefined && max_mileage !== "") query = query.lte("mileage_km", Number(max_mileage));

    query = this._applySort(query, sort).range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch cars: ${error.message}`);

    return {
      cars: data || [],
      meta: { total: count || 0, page: pageNum, limit: pageSize, pages: Math.ceil((count || 0) / pageSize) },
    };
  }

  // ── Admin: create car ───────────────────────────────────────────────────────

  async createCar(payload) {
    const {
      brand, model, title, description_de, description_en,
      price, old_price, condition, fuel_type, transmission,
      mileage_km, first_registration, engine_displacement_cc,
      performance_hp, seats, vehicle_owners, vehicle_condition,
      air_conditioning, camera, interior_design, interior_color,
      equipment, custom_fields, media, is_featured, is_visible,
      slug: rawSlug, category, status,
    } = payload;

    // Resolve slug
    const slug = rawSlug
      ? await this._ensureUniqueSlug(rawSlug.trim(), null)
      : await generateUniqueSlug(brand, model, title);

    const insert = {
      brand: brand.trim(),
      model: model.trim(),
      title: title.trim(),
      slug,
      price: Number(price),
      status: status || "AVAILABLE",
      is_visible: is_visible !== undefined ? Boolean(is_visible) : true,
      is_featured: is_featured !== undefined ? Boolean(is_featured) : false,
    };

    // Optional fields
    if (description_de !== undefined) insert.description_de = description_de;
    if (description_en !== undefined) insert.description_en = description_en;
    if (old_price !== undefined && old_price !== null) insert.old_price = Number(old_price);
    if (condition !== undefined) insert.condition = condition;
    if (fuel_type !== undefined) insert.fuel_type = fuel_type;
    if (transmission !== undefined) insert.transmission = transmission;
    if (mileage_km !== undefined && mileage_km !== null) insert.mileage_km = Number(mileage_km);
    if (first_registration !== undefined && first_registration !== null) insert.first_registration = first_registration;
    if (engine_displacement_cc !== undefined && engine_displacement_cc !== null) insert.engine_displacement_cc = Number(engine_displacement_cc);
    if (performance_hp !== undefined && performance_hp !== null) insert.performance_hp = Number(performance_hp);
    if (seats !== undefined && seats !== null) insert.seats = Number(seats);
    if (vehicle_owners !== undefined && vehicle_owners !== null) insert.vehicle_owners = Number(vehicle_owners);
    if (vehicle_condition !== undefined) insert.vehicle_condition = vehicle_condition;
    if (air_conditioning !== undefined) insert.air_conditioning = Boolean(air_conditioning);
    if (camera !== undefined) insert.camera = Boolean(camera);
    if (interior_design !== undefined) insert.interior_design = interior_design;
    if (interior_color !== undefined) insert.interior_color = interior_color;
    if (equipment !== undefined) insert.equipment = equipment;
    if (custom_fields !== undefined) insert.custom_fields = custom_fields;
    if (media !== undefined) insert.media = this._validateMedia(media);
    if (category !== undefined) insert.category = category;

    const { data, error } = await supabase
      .from("cars")
      .insert(insert)
      .select(DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to create car: ${error.message}`);
    return data;
  }

  // ── Admin: update car ───────────────────────────────────────────────────────

  async updateCar(id, payload) {
    // Verify car exists
    const existing = await this.getAdminCar(id);

    const update = {};

    const stringFields = ["brand", "model", "title", "description_de", "description_en",
      "interior_color", "vehicle_condition", "condition", "fuel_type", "transmission",
      "interior_design", "category", "status"];
    for (const f of stringFields) {
      if (payload[f] !== undefined) update[f] = payload[f];
    }
    const trimmed = ["brand", "model", "title"];
    for (const f of trimmed) {
      if (update[f]) update[f] = update[f].trim();
    }

    const numFields = ["price", "old_price", "mileage_km", "engine_displacement_cc",
      "performance_hp", "seats", "vehicle_owners"];
    for (const f of numFields) {
      if (payload[f] !== undefined) {
        update[f] = payload[f] === null ? null : Number(payload[f]);
      }
    }

    if (payload.first_registration !== undefined) {
      update.first_registration = payload.first_registration;
    }

    const boolFields = ["is_featured", "is_visible", "air_conditioning", "camera"];
    for (const f of boolFields) {
      if (payload[f] !== undefined) update[f] = Boolean(payload[f]);
    }

    if (payload.equipment !== undefined) update.equipment = payload.equipment;
    if (payload.custom_fields !== undefined) update.custom_fields = payload.custom_fields;
    if (payload.media !== undefined) update.media = this._validateMedia(payload.media);

    // Slug re-generation when brand/model/title changes
    if (payload.slug !== undefined && payload.slug !== null) {
      update.slug = await this._ensureUniqueSlug(payload.slug.trim(), id);
    } else if (update.brand || update.model || update.title) {
      const newBrand = update.brand || existing.brand;
      const newModel = update.model || existing.model;
      const newTitle = update.title || existing.title;
      update.slug = await generateUniqueSlug(newBrand, newModel, newTitle, id);
    }

    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("cars")
      .update(update)
      .eq("id", existing.id)
      .select(DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update car: ${error.message}`);
    return data;
  }

  // ── Admin: delete car ───────────────────────────────────────────────────────

  async deleteCar(id) {
    const car = await this.getAdminCar(id);

    const { error } = await supabase.from("cars").delete().eq("id", car.id);
    if (error) throw new Error(`Failed to delete car: ${error.message}`);

    return { message: "Car deleted successfully." };
  }

  // ── Admin: set visibility ───────────────────────────────────────────────────

  async setVisibility(id, isVisible) {
    const car = await this.getAdminCar(id);

    const { data, error } = await supabase
      .from("cars")
      .update({ is_visible: Boolean(isVisible), updated_at: new Date().toISOString() })
      .eq("id", car.id)
      .select(DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update visibility: ${error.message}`);
    return data;
  }

  // ── Admin: set featured ─────────────────────────────────────────────────────

  async setFeatured(id, isFeatured) {
    const car = await this.getAdminCar(id);

    const { data, error } = await supabase
      .from("cars")
      .update({ is_featured: Boolean(isFeatured), updated_at: new Date().toISOString() })
      .eq("id", car.id)
      .select(DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update featured status: ${error.message}`);
    return data;
  }

  // ── Admin: set status ───────────────────────────────────────────────────────

  async setStatus(id, status) {
    const { VALID_STATUS } = require("../validators/car.validator");
    if (!VALID_STATUS.includes(status)) {
      throw opError(`Invalid status. Must be one of: ${VALID_STATUS.join(", ")}.`);
    }

    const car = await this.getAdminCar(id);

    const { data, error } = await supabase
      .from("cars")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", car.id)
      .select(DETAIL_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update car status: ${error.message}`);
    return data;
  }

  // ── Favorites ───────────────────────────────────────────────────────────────

  /**
   * Add a car to the authenticated user's favorites.
   * Verifies car exists and is publicly visible (not hidden/invisible).
   */
  async addFavorite(userId, carId) {
    // Verify car exists and is visible
    const { data: car, error: carErr } = await supabase
      .from("cars")
      .select("id, status, is_visible")
      .eq("id", carId)
      .maybeSingle();

    if (carErr || !car) throw opError("Car not found.", 404);
    if (!car.is_visible || car.status === "HIDDEN") {
      throw opError("This vehicle is not available.", 404);
    }

    // Fetch current favorites
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("favorite_car_ids")
      .eq("id", userId)
      .single();

    if (userErr || !user) throw opError("User not found.", 404);

    const current = Array.isArray(user.favorite_car_ids) ? user.favorite_car_ids : [];

    // Prevent duplicates
    if (current.includes(carId)) {
      throw opError("Car is already in your favorites.", 409);
    }

    const updated = [...current, carId];

    const { error: updateErr } = await supabase
      .from("users")
      .update({ favorite_car_ids: updated })
      .eq("id", userId);

    if (updateErr) throw new Error(`Failed to update favorites: ${updateErr.message}`);

    return { message: "Car added to favorites.", favorite_car_ids: updated };
  }

  /**
   * Remove a car from the authenticated user's favorites.
   */
  async removeFavorite(userId, carId) {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("favorite_car_ids")
      .eq("id", userId)
      .single();

    if (userErr || !user) throw opError("User not found.", 404);

    const current = Array.isArray(user.favorite_car_ids) ? user.favorite_car_ids : [];

    if (!current.includes(carId)) {
      throw opError("Car is not in your favorites.", 404);
    }

    const updated = current.filter((id) => id !== carId);

    const { error: updateErr } = await supabase
      .from("users")
      .update({ favorite_car_ids: updated })
      .eq("id", userId);

    if (updateErr) throw new Error(`Failed to update favorites: ${updateErr.message}`);

    return { message: "Car removed from favorites.", favorite_car_ids: updated };
  }

  /**
   * Get user's current favorite car IDs list and their details.
   */
  async getFavorites(userId) {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("favorite_car_ids")
      .eq("id", userId)
      .single();

    if (userErr || !user) throw opError("User not found.", 404);

    const ids = Array.isArray(user.favorite_car_ids) ? user.favorite_car_ids : [];

    if (ids.length === 0) return { cars: [], favorite_car_ids: [] };

    const { data: cars, error: carsErr } = await supabase
      .from("cars")
      .select(LIST_COLUMNS)
      .in("id", ids)
      .eq("is_visible", true)
      .neq("status", "HIDDEN");

    if (carsErr) throw new Error(`Failed to fetch favorite cars: ${carsErr.message}`);

    return { cars: cars || [], favorite_car_ids: ids };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Apply sort order to a Supabase query.
   */
  _applySort(query, sort) {
    switch (sort) {
      case "price_asc":   return query.order("price", { ascending: true });
      case "price_desc":  return query.order("price", { ascending: false });
      case "mileage_asc": return query.order("mileage_km", { ascending: true });
      case "mileage_desc":return query.order("mileage_km", { ascending: false });
      case "az":          return query.order("brand", { ascending: true }).order("model", { ascending: true });
      case "za":          return query.order("brand", { ascending: false }).order("model", { ascending: false });
      case "oldest":      return query.order("created_at", { ascending: true });
      case "newest":
      default:            return query.order("created_at", { ascending: false });
    }
  }

  /**
   * Ensure a manually provided slug is unique.
   */
  async _ensureUniqueSlug(slug, existingId) {
    const normalized = slugify(slug).substring(0, 300);
    let query = supabase.from("cars").select("id").eq("slug", normalized).limit(1);
    if (existingId) query = query.neq("id", existingId);
    const { data } = await query;
    if (data && data.length > 0) {
      throw opError(`Slug "${normalized}" is already in use. Please choose a different slug.`, 409);
    }
    return normalized;
  }

  /**
   * Validate and normalize the media JSONB object.
   * Enforces the defined media schema: gallery, thumbnail, video, images_360, model_3d.
   */
  _validateMedia(media) {
    if (!media || typeof media !== "object") return {};

    const result = {};

    if (media.thumbnail !== undefined) {
      result.thumbnail = typeof media.thumbnail === "string" ? media.thumbnail : null;
    }
    if (media.gallery !== undefined) {
      result.gallery = Array.isArray(media.gallery) ? media.gallery.slice(0, 20) : [];
    }
    if (media.video !== undefined) {
      result.video = typeof media.video === "string" ? media.video : null;
    }
    if (media.images_360 !== undefined) {
      result.images_360 = Array.isArray(media.images_360) ? media.images_360 : [];
    }
    if (media.model_3d !== undefined) {
      result.model_3d = typeof media.model_3d === "string" ? media.model_3d : null;
    }

    return result;
  }

  /**
   * Upload multiple car images from device (up to 20 images)
   */
  async uploadCarImages(files) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const storageService = require("./storage.service");
    const fs = require("fs");
    const path = require("path");

    const urls = [];
    const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";

    for (const file of files) {
      const rawExt = file.originalname?.split(".").pop()?.toLowerCase() || "jpg";
      const ext = ["jpg", "jpeg", "png", "webp", "avif"].includes(rawExt) ? rawExt : "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `cars/images/${fileName}`;

      let publicUrl = null;
      try {
        const uploaded = await storageService.uploadFile({
          bucket: BUCKET,
          filePath,
          fileBuffer: file.buffer,
          mimeType: file.mimetype || "image/jpeg",
        });
        publicUrl = uploaded?.publicUrl || null;
      } catch (err) {
        console.warn("[CarService] Supabase upload failed, using local storage:", err.message);
        try {
          const uploadDir = path.join(__dirname, "../../uploads/cars");
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
          publicUrl = `/uploads/cars/${fileName}`;
        } catch (localErr) {
          console.error("[CarService] Local fallback storage error:", localErr.message);
        }
      }

      if (publicUrl) {
        urls.push(publicUrl);
      }
    }
    return urls;
  }
}

module.exports = new CarService();
