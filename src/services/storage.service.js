const supabase = require("../config/supabase");

/**
 * Storage Service Abstraction for Supabase Storage
 */

const ALLOWED_MIME_TYPES = {
  IMAGE: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/svg+xml"],
  VIDEO: ["video/mp4", "video/webm"],
  MODEL_3D: ["model/gltf-binary", "model/gltf+json", "application/octet-stream"],
};

const MAX_FILE_SIZES = {
  IMAGE: 10 * 1024 * 1024,      // 10 MB
  VIDEO: 50 * 1024 * 1024,      // 50 MB
  MODEL_3D: 25 * 1024 * 1024,   // 25 MB
};

const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";

class StorageService {
  constructor() {
    this.client = supabase;
    this.defaultBucket = DEFAULT_BUCKET;
  }

  /**
   * Validate file mime type and size
   */
  validateFile({ mimeType, sizeBytes, category = "IMAGE" }) {
    const allowed = ALLOWED_MIME_TYPES[category];
    const maxSize = MAX_FILE_SIZES[category];

    if (allowed && !allowed.includes(mimeType)) {
      return {
        valid: false,
        error: `Invalid file type: ${mimeType}. Allowed types: ${allowed.join(", ")}`,
      };
    }

    if (maxSize && sizeBytes > maxSize) {
      return {
        valid: false,
        error: `File size exceeds the limit of ${Math.round(maxSize / (1024 * 1024))}MB.`,
      };
    }

    return { valid: true };
  }

  /**
   * Upload buffer directly to Supabase Storage
   */
  async uploadFile({ bucket = this.defaultBucket, filePath, fileBuffer, mimeType, upsert = false }) {
    if (!filePath || !fileBuffer) {
      throw new Error("filePath and fileBuffer are required for file upload.");
    }

    const { data, error } = await this.client.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        upsert,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const publicUrl = this.getPublicUrl({ bucket, filePath });

    return {
      path: data.path,
      fullPath: data.fullPath,
      publicUrl,
    };
  }

  /**
   * Get public URL for an asset
   */
  getPublicUrl({ bucket = this.defaultBucket, filePath }) {
    const { data } = this.client.storage.from(bucket).getPublicUrl(filePath);
    return data?.publicUrl || null;
  }

  /**
   * Remove a file from Supabase Storage
   */
  async deleteFile({ bucket = this.defaultBucket, filePath }) {
    if (!filePath) return false;

    const { error } = await this.client.storage.from(bucket).remove([filePath]);
    if (error) {
      console.error(`Storage deletion failed for ${filePath}:`, error.message);
      return false;
    }
    return true;
  }

  /**
   * Remove multiple files from Supabase Storage
   */
  async deleteFiles({ bucket = this.defaultBucket, filePaths = [] }) {
    if (!filePaths.length) return false;

    const { error } = await this.client.storage.from(bucket).remove(filePaths);
    if (error) {
      console.error("Storage bulk deletion failed:", error.message);
      return false;
    }
    return true;
  }
}

module.exports = new StorageService();
