/**
 * Settings Service — manages singleton site_settings CMS document,
 * public/admin settings retrieval, partial section merging, and safe media management.
 */

const supabase = require("../config/supabase");
const storageService = require("./storage.service");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "german-auto-media";

const DEFAULT_SETTINGS = {
  site: {
    name: "König Automobile Rheinberg",
    description: "König Automobile Rheinberg — Ihr exklusiver Partner für Premium- und Luxusautomobile",
    default_language: "de",
    supported_languages: ["de", "en"],
    timezone: "Europe/Berlin",
    seo_title: "König Automobile Rheinberg",
    seo_description: "Exklusive Sportwagen, Luxuslimousinen und Premiumfahrzeuge bei König Automobile Rheinberg.",
    seo_keywords: ["König Automobile", "Rheinberg", "Sportwagen", "Luxusautos", "Gebrauchtwagen"],
    robots_indexing: true,
  },
  branding: {
    logo_url: "https://ylmahjqspbudmtewjhcg.supabase.co/storage/v1/object/public/german-auto-media/site/branding/1790760237272-so6ety.jpg",
    logo_dark_url: "https://ylmahjqspbudmtewjhcg.supabase.co/storage/v1/object/public/german-auto-media/site/branding/1790760237272-so6ety.jpg",
    logo_light_url: null,
    favicon_url: null,
  },
  theme: {
    primary_color: "#000000",
    secondary_color: "#C5A059",
    background_color: "#FFFFFF",
    text_color: "#111111",
    card_color: "#F8F9FA",
    accent_color: "#D4AF37",
    mode: "light",
  },
  languages: {
    default: "de",
    supported: ["de", "en"],
    fallback: "de",
  },
  contact: {
    phone: null,
    email: null,
    whatsapp: null,
    contact_url: null,
  },
  hours: {
    monday: { enabled: true, open: "09:00", close: "18:00" },
    tuesday: { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday: { enabled: true, open: "09:00", close: "18:00" },
    friday: { enabled: true, open: "09:00", close: "18:00" },
    saturday: { enabled: false, open: null, close: null },
    sunday: { enabled: false, open: null, close: null },
  },
  locations: [],
  social: {
    facebook: { enabled: false, url: null },
    instagram: { enabled: false, url: null },
    youtube: { enabled: false, url: null },
    tiktok: { enabled: false, url: null },
    linkedin: { enabled: false, url: null },
    x: { enabled: false, url: null },
  },
  navigation: {
    main: [],
    header_cta: { enabled: false, label_de: null, label_en: null, route: null },
  },
  footer: {
    copyright_de: "© 2026 König Automobile Rheinberg. Alle Rechte vorbehalten.",
    copyright_en: "© 2026 König Automobile Rheinberg. All rights reserved.",
    description_de: "König Automobile Rheinberg — Ihr exklusiver Partner für Automobile höchster Güteklasse.",
    description_en: "König Automobile Rheinberg — Your exclusive destination for fine luxury automobiles.",
    navigation_groups: [],
    show_contact: true,
    show_social: true,
    show_locations: true,
    footer_logo_url: null,
  },
  homepage: {
    sections_order: [
      "hero",
      "featured_cars",
      "offers",
      "sell_car",
      "testimonials",
      "google_reviews",
      "locations",
      "contact",
    ],
    sections_enabled: {
      hero: true,
      featured_cars: true,
      offers: true,
      sell_car: true,
      testimonials: true,
      google_reviews: true,
      locations: true,
      contact: true,
    },
  },
  hero: {
    enabled: true,
    items: [],
  },
  offers: {
    enabled: true,
    items: [],
  },
  sell_car: {
    enabled: true,
    title_de: null,
    title_en: null,
    description_de: null,
    description_en: null,
    cta_text_de: null,
    cta_text_en: null,
    media_url: null,
  },
  contact_form: {
    enabled: true,
    title_de: null,
    title_en: null,
    description_de: null,
    description_en: null,
    recipient_email: null,
    success_message_de: null,
    success_message_en: null,
  },
  google_reviews: {
    enabled: false,
    profile_url: null,
    display_label_de: null,
    display_label_en: null,
    show_rating: false,
    show_count: false,
  },
  about: {
    title_de: "Über König Automobile Rheinberg",
    title_en: "About König Automobile Rheinberg",
    subtitle_de: "Leidenschaft, Präzision & automobile Perfektion",
    subtitle_en: "Passion, precision & automotive perfection",
    story_de: "König Automobile Rheinberg steht seit vielen Jahren für erstklassige Luxusfahrzeuge und persönlichen Premium-Service.",
    story_en: "König Automobile Rheinberg has represented first-class luxury vehicles and personal premium service for years.",
    media_url: null,
    years_experience: 15,
    vehicles_sold: 2500,
    satisfaction_rate: 99,
  },
};

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

function extractStoragePath(imageUrl, bucket = BUCKET) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (imageUrl.startsWith("site/")) return imageUrl;

  const marker = `/public/${bucket}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(imageUrl.substring(idx + marker.length));
  }

  const siteIdx = imageUrl.indexOf("/site/");
  if (siteIdx !== -1) {
    return decodeURIComponent(imageUrl.substring(siteIdx + 1));
  }

  return null;
}

class SettingsService {
  /**
   * Initializes or fetches the singleton settings record
   */
  async initOrGetSettings() {
    const { data: rows, error: selectErr } = await supabase
      .from("site_settings")
      .select("id, settings, updated_by, created_at, updated_at, singleton")
      .limit(1);

    if (selectErr) {
      throw new Error(`Failed to query site_settings: ${selectErr.message}`);
    }

    if (rows && rows.length > 0) {
      const record = rows[0];
      // Ensure all top-level default sections exist
      let changed = false;
      const current = record.settings || {};
      for (const [secKey, secVal] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[secKey] === undefined) {
          current[secKey] = secVal;
          changed = true;
        }
      }
      if (changed) {
        await supabase
          .from("site_settings")
          .update({ settings: current, updated_at: new Date().toISOString() })
          .eq("id", record.id);
        record.settings = current;
      }
      return record;
    }

    // Insert default singleton row if missing
    const { data: inserted, error: insertErr } = await supabase
      .from("site_settings")
      .insert({
        settings: DEFAULT_SETTINGS,
        singleton: true,
      })
      .select("id, settings, updated_by, created_at, updated_at, singleton")
      .single();

    if (insertErr) {
      throw new Error(`Failed to initialize site_settings: ${insertErr.message}`);
    }

    return inserted;
  }

  /**
   * Retrieves public-safe settings (no secrets, recipient emails, or internal IDs)
   */
  async getPublicSettings() {
    const record = await this.initOrGetSettings();
    const settings = JSON.parse(JSON.stringify(record.settings || {}));

    // Strip sensitive internal fields
    if (settings.contact_form) {
      delete settings.contact_form.recipient_email;
    }

    return settings;
  }

  /**
   * Retrieves full admin settings document with metadata
   */
  async getAdminSettings() {
    const record = await this.initOrGetSettings();
    return {
      id: record.id,
      settings: record.settings,
      updated_by: record.updated_by,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  /**
   * Updates settings with partial section updates (preserving unrelated sections)
   */
  async updateSettings(userId, patchPayload) {
    const record = await this.initOrGetSettings();
    const current = record.settings || {};
    const updated = { ...current };

    // Sanitize & normalize hero items if provided
    if (patchPayload.hero && Array.isArray(patchPayload.hero.items)) {
      const normalizeRoute = (link) => {
        if (!link || typeof link !== "string") return link;
        const trimmed = link.trim();
        if (
          trimmed.length > 0 &&
          !trimmed.startsWith("/") &&
          !trimmed.startsWith("#") &&
          !trimmed.startsWith("http://") &&
          !trimmed.startsWith("https://") &&
          !trimmed.startsWith("tel:") &&
          !trimmed.startsWith("mailto:")
        ) {
          return `/${trimmed}`;
        }
        return trimmed;
      };

      patchPayload.hero.items = patchPayload.hero.items.map((item) => {
        if (!item || typeof item !== "object") return item;
        const normalized = { ...item };
        if (normalized.type) normalized.type = String(normalized.type).toUpperCase();
        if (normalized.type_light) normalized.type_light = String(normalized.type_light).toUpperCase();

        if (normalized.button_link) normalized.button_link = normalizeRoute(normalized.button_link);
        if (normalized.button_link_de) normalized.button_link_de = normalizeRoute(normalized.button_link_de);
        if (normalized.button_link_en) normalized.button_link_en = normalizeRoute(normalized.button_link_en);
        if (normalized.secondary_button_link) normalized.secondary_button_link = normalizeRoute(normalized.secondary_button_link);
        if (normalized.secondary_button_link_de) normalized.secondary_button_link_de = normalizeRoute(normalized.secondary_button_link_de);
        if (normalized.secondary_button_link_en) normalized.secondary_button_link_en = normalizeRoute(normalized.secondary_button_link_en);

        return normalized;
      });
    }

    for (const [section, val] of Object.entries(patchPayload)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        updated[section] = { ...(current[section] || {}), ...val };
      } else {
        updated[section] = val;
      }
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const safeUserId = (userId && typeof userId === "string" && UUID_REGEX.test(userId)) ? userId : null;

    const { data: saved, error } = await supabase
      .from("site_settings")
      .update({
        settings: updated,
        updated_by: safeUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id)
      .select("id, settings, updated_by, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to update site_settings: ${error.message}`);
    }

    return saved;
  }

  /**
   * Resets a single settings section back to its safe default structure
   */
  async resetSection(userId, section) {
    if (!DEFAULT_SETTINGS[section]) {
      throw opError(`Invalid settings section to reset: '${section}'`, 400);
    }

    const record = await this.initOrGetSettings();
    const current = record.settings || {};
    const updated = {
      ...current,
      [section]: JSON.parse(JSON.stringify(DEFAULT_SETTINGS[section])),
    };

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const safeUserId = (userId && typeof userId === "string" && UUID_REGEX.test(userId)) ? userId : null;

    const { data: saved, error } = await supabase
      .from("site_settings")
      .update({
        settings: updated,
        updated_by: safeUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id)
      .select("id, settings, updated_by, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(`Failed to reset section '${section}': ${error.message}`);
    }

    return saved;
  }

  /**
   * Upload branding asset (logo, logo_dark, favicon) and update settings safely
   */
  async uploadBrandingAsset({ file, type = "logo", userId }) {
    const allowedTypes = {
      logo: "logo_url",
      logo_dark: "logo_dark_url",
      logo_light: "logo_light_url",
      favicon: "favicon_url",
      footer_logo: "footer_logo_url",
    };

    const key = allowedTypes[type];
    if (!key) {
      throw opError(`Invalid branding asset type: '${type}'. Allowed: logo, logo_dark, logo_light, favicon, footer_logo.`, 400);
    }

    const allowedMimes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/pjpeg",
      "image/webp",
      "image/svg+xml",
      "image/x-icon",
      "image/vnd.microsoft.icon",
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      throw opError(`Invalid image type: ${file.mimetype}. Allowed: ${allowedMimes.join(", ")}.`, 422);
    }

    if (file.size > 5 * 1024 * 1024) {
      throw opError("Branding file exceeds maximum size limit of 5 MB.", 422);
    }

    // 1. Upload new asset
    const rawExt = file.originalname?.split(".").pop()?.toLowerCase() || "png";
    const ext = ["png", "jpg", "jpeg", "webp", "svg", "ico"].includes(rawExt)
      ? rawExt
      : (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg" || file.mimetype === "image/pjpeg" ? "jpg" : "png");
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = `site/branding/${fileName}`;

    const uploaded = await storageService.uploadFile({
      bucket: BUCKET,
      filePath,
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
    });

    const newUrl = uploaded.publicUrl;

    // 2. Fetch current setting to determine old asset URL
    const record = await this.initOrGetSettings();
    const currentBranding = record.settings?.branding || {};
    const oldUrl = currentBranding[key];

    // 3. Update DB
    try {
      const updatedBranding = { ...currentBranding, [key]: newUrl };
      await this.updateSettings(userId, { branding: updatedBranding });
    } catch (dbErr) {
      // Rollback newly uploaded file on DB failure
      await storageService.deleteFile({ bucket: BUCKET, filePath });
      throw dbErr;
    }

    // 4. Remove old asset only after DB update succeeds
    if (oldUrl && oldUrl !== newUrl) {
      const oldPath = extractStoragePath(oldUrl, BUCKET);
      if (oldPath) {
        await storageService.deleteFile({ bucket: BUCKET, filePath: oldPath });
      }
    }

    return {
      type,
      key,
      url: newUrl,
      path: filePath,
    };
  }

  /**
   * Upload hero media (image or video) and return storage reference
   */
  async uploadHeroMedia({ file, userId }) {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = ["video/mp4", "video/webm"].includes(file.mimetype);

    if (!isImage && !isVideo) {
      throw opError(`Invalid media type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, MP4, WEBM.`, 422);
    }

    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw opError(`File exceeds maximum size of ${isVideo ? "50 MB" : "10 MB"}.`, 422);
    }

    const rawExt = file.originalname?.split(".").pop()?.toLowerCase() || (isVideo ? "mp4" : "jpg");
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${rawExt}`;
    const filePath = `site/hero/${fileName}`;

    const uploaded = await storageService.uploadFile({
      bucket: BUCKET,
      filePath,
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
    });

    return {
      type: isVideo ? "VIDEO" : "IMAGE",
      url: uploaded.publicUrl,
      path: filePath,
    };
  }
}

module.exports = new SettingsService();
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.extractStoragePath = extractStoragePath;
