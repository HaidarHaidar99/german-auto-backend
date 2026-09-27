/**
 * Review service — business logic for public and admin review operations.
 *
 * Reviews table columns:
 * id, user_id, name, rating, text, image_url, status, created_at, updated_at
 */

const supabase = require("../config/supabase");
const storageService = require("./storage.service");
const notificationService = require("./notification.service");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";
const REVIEW_STORAGE_PREFIX = "reviews";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

/**
 * Extracts storage relative file path from public URL or path string
 */
function extractStoragePath(imageUrl, bucket = BUCKET) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (imageUrl.startsWith(`${REVIEW_STORAGE_PREFIX}/`)) return imageUrl;

  const marker = `/public/${bucket}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(imageUrl.substring(idx + marker.length));
  }

  const revIdx = imageUrl.indexOf(`/${REVIEW_STORAGE_PREFIX}/`);
  if (revIdx !== -1) {
    return decodeURIComponent(imageUrl.substring(revIdx + 1));
  }

  return null;
}

class ReviewService {
  /**
   * Submit a new review by an authenticated user
   */
  async submitReview({ userId, userFullName, body, file }) {
    // 1. Check for rapid spam (submissions within 1s by the same user)
    const { data: recentSubmissions } = await supabase
      .from("reviews")
      .select("id, created_at")
      .eq("user_id", userId)
      .neq("status", "DELETED")
      .order("created_at", { ascending: false })
      .limit(1);

    if (recentSubmissions && recentSubmissions.length > 0) {
      const elapsed = Date.now() - new Date(recentSubmissions[0].created_at).getTime();
      if (elapsed < 1000) {
        throw opError("Too many review submissions in a short period. Please wait before submitting another review.", 429);
      }
    }

    // 2. Prevent duplicate submissions with identical text from the same user
    const trimmedText = body.text.trim();
    const { data: duplicates } = await supabase
      .from("reviews")
      .select("id")
      .eq("user_id", userId)
      .eq("text", trimmedText)
      .neq("status", "DELETED")
      .limit(1);

    if (duplicates && duplicates.length > 0) {
      throw opError("Duplicate review detected. You have already submitted this review.", 409);
    }

    // 3. Handle optional image upload
    let uploadedFilePath = null;
    let imageUrl = null;

    if (file) {
      if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
        throw opError(`Invalid image type: ${file.mimetype}. Allowed: ${ALLOWED_IMAGE_MIMES.join(", ")}.`, 422);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw opError("Image exceeds the maximum allowed size of 5 MB.", 422);
      }

      const rawExt = file.originalname?.split(".").pop()?.toLowerCase() || "jpg";
      const ext = ["jpeg", "jpg", "png", "webp", "avif"].includes(rawExt) ? rawExt : "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      uploadedFilePath = `${REVIEW_STORAGE_PREFIX}/${fileName}`;

      const uploadResult = await storageService.uploadFile({
        bucket: BUCKET,
        filePath: uploadedFilePath,
        fileBuffer: file.buffer,
        mimeType: file.mimetype,
      });

      imageUrl = uploadResult.publicUrl;
    }

    // 4. Insert into reviews table with status PENDING
    try {
      const { data, error } = await supabase
        .from("reviews")
        .insert({
          user_id: userId,
          name: userFullName && userFullName.trim().length > 0 ? userFullName.trim() : "Verified Customer",
          rating: parseInt(body.rating, 10),
          text: trimmedText,
          image_url: imageUrl,
          status: "PENDING",
        })
        .select("id, user_id, name, rating, text, image_url, status, created_at, updated_at")
        .single();

      if (error) {
        throw error;
      }

      // Trigger notification generation safely
      notificationService.notifyNewReview(data).catch(() => {});

      return {
        message: "Review submitted successfully and is pending approval.",
        review: data,
      };
    } catch (dbErr) {
      // Rollback uploaded image if database insert fails
      if (uploadedFilePath) {
        await storageService.deleteFile({ bucket: BUCKET, filePath: uploadedFilePath });
      }
      throw new Error(`Failed to save review: ${dbErr.message}`);
    }
  }

  /**
   * Public list of PUBLISHED reviews only (paginated, newest first)
   */
  async listPublicReviews({ page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const from = (pageNum - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from("reviews")
      .select("id, name, rating, text, image_url, created_at", { count: "exact" })
      .eq("status", "PUBLISHED")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch public reviews: ${error.message}`);
    }

    return {
      reviews: data || [],
      meta: {
        total: count || 0,
        page: pageNum,
        limit: pageSize,
        pages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  /**
   * Admin list of reviews with status/rating filters and search
   */
  async listAdminReviews({ status, rating, sort = "newest", search, page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const from = (pageNum - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("reviews")
      .select("id, user_id, name, rating, text, image_url, status, created_at, updated_at", { count: "exact" });

    if (status) {
      query = query.eq("status", status);
    }

    if (rating !== undefined && rating !== null && rating !== "") {
      query = query.eq("rating", parseInt(rating, 10));
    }

    if (search && typeof search === "string" && search.trim().length > 0) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,text.ilike.%${term}%`);
    }

    if (sort === "oldest") {
      query = query.order("created_at", { ascending: true });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) {
      throw new Error(`Failed to fetch admin reviews: ${error.message}`);
    }

    return {
      reviews: data || [],
      meta: {
        total: count || 0,
        page: pageNum,
        limit: pageSize,
        pages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  /**
   * Get single review for admin
   */
  async getAdminReview(id) {
    const { data, error } = await supabase
      .from("reviews")
      .select("id, user_id, name, rating, text, image_url, status, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch review: ${error.message}`);
    }

    if (!data) {
      throw opError("Review not found", 404);
    }

    return data;
  }

  /**
   * Update review moderation fields (status, text, rating)
   */
  async updateAdminReview(id, payload) {
    await this.getAdminReview(id); // Ensure review exists

    const updates = {};
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.rating !== undefined) updates.rating = parseInt(payload.rating, 10);
    if (payload.text !== undefined) updates.text = payload.text.trim();
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("reviews")
      .update(updates)
      .eq("id", id)
      .select("id, user_id, name, rating, text, image_url, status, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to update review: ${error.message}`);
    }

    return data;
  }

  /**
   * Soft-delete review (status = DELETED) and cleanup Storage file if present
   */
  async softDeleteReview(id) {
    const existing = await this.getAdminReview(id);

    // Delete image from storage if attached
    if (existing.image_url) {
      const storagePath = extractStoragePath(existing.image_url, BUCKET);
      if (storagePath) {
        await storageService.deleteFile({ bucket: BUCKET, filePath: storagePath });
      }
    }

    const { data, error } = await supabase
      .from("reviews")
      .update({
        status: "DELETED",
        image_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, user_id, name, rating, text, image_url, status, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to delete review: ${error.message}`);
    }

    return data;
  }
}

module.exports = new ReviewService();
module.exports.extractStoragePath = extractStoragePath;
