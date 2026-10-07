/**
 * Validation rules for the Site Settings / CMS module.
 */

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUrl(url, allowRelative = false) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return true; // empty allowed

  // Reject dangerous pseudo-protocols
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return false;
  }

  // Reject protocol-relative external redirects
  if (trimmed.startsWith("//")) {
    return false;
  }

  if (allowRelative) {
    // Relative routes starting with / or hash anchors #
    if (trimmed.startsWith("/") || trimmed.startsWith("#")) {
      return true;
    }

    // Direct phone or mail links
    if (/^(tel:|mailto:)/i.test(trimmed)) {
      return true;
    }

    // Relative path without leading slash (e.g. "cars", "inventory?make=BMW", "contact")
    // Safe as long as it has no scheme delimiter ":"
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return true;
    }
  }

  try {
    const parsed = new URL(trimmed);
    const allowed = allowRelative
      ? ["http:", "https:", "tel:", "mailto:"]
      : ["http:", "https:"];
    return allowed.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validates theme configuration
 */
function validateTheme(theme, errors) {
  if (!theme || typeof theme !== "object") return;

  const colorFields = [
    "primary_color",
    "secondary_color",
    "background_color",
    "text_color",
    "card_color",
    "accent_color",
  ];

  for (const field of colorFields) {
    if (theme[field] !== undefined && theme[field] !== null && theme[field] !== "") {
      if (typeof theme[field] !== "string" || !HEX_COLOR_REGEX.test(theme[field].trim())) {
        errors[`theme.${field}`] = `Invalid hex color for '${field}'. Must be #RGB or #RRGGBB.`;
      }
    }
  }

  if (theme.mode !== undefined && !["light", "dark", "auto"].includes(theme.mode)) {
    errors["theme.mode"] = "Theme mode must be 'light', 'dark', or 'auto'.";
  }
}

/**
 * Validates contact configuration
 */
function validateContact(contact, errors) {
  if (!contact || typeof contact !== "object") return;

  if (contact.email !== undefined && contact.email !== null && contact.email !== "") {
    if (typeof contact.email !== "string" || !EMAIL_REGEX.test(contact.email.trim())) {
      errors["contact.email"] = "Invalid contact email address.";
    }
  }

  if (contact.contact_url !== undefined && contact.contact_url !== null && contact.contact_url !== "") {
    if (!isValidUrl(contact.contact_url, true)) {
      errors["contact.contact_url"] = "Invalid contact URL.";
    }
  }
}

/**
 * Validates opening hours configuration
 */
function validateHours(hours, errors) {
  if (!hours || typeof hours !== "object") return;

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const day of Object.keys(hours)) {
    if (!days.includes(day)) {
      errors[`hours.${day}`] = `Invalid day of week: '${day}'.`;
      continue;
    }
    const dayConfig = hours[day];
    if (dayConfig && typeof dayConfig === "object") {
      if (dayConfig.open && !TIME_REGEX.test(dayConfig.open)) {
        errors[`hours.${day}.open`] = `Invalid opening time for ${day}. Must be HH:MM format (00:00 to 23:59).`;
      }
      if (dayConfig.close && !TIME_REGEX.test(dayConfig.close)) {
        errors[`hours.${day}.close`] = `Invalid closing time for ${day}. Must be HH:MM format (00:00 to 23:59).`;
      }
    }
  }
}

/**
 * Validates locations list
 */
function validateLocations(locations, errors) {
  if (locations === undefined || locations === null) return;
  if (!Array.isArray(locations)) {
    errors["locations"] = "Locations must be an array.";
    return;
  }

  locations.forEach((loc, idx) => {
    if (!loc || typeof loc !== "object") {
      errors[`locations[${idx}]`] = "Location entry must be an object.";
      return;
    }

    if (loc.latitude !== undefined && loc.latitude !== null) {
      const lat = Number(loc.latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors[`locations[${idx}].latitude`] = "Latitude must be a number between -90 and 90.";
      }
    }

    if (loc.longitude !== undefined && loc.longitude !== null) {
      const lng = Number(loc.longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors[`locations[${idx}].longitude`] = "Longitude must be a number between -180 and 180.";
      }
    }

    if (loc.map_url !== undefined && loc.map_url !== null && loc.map_url !== "") {
      const normalizedMapUrl = String(loc.map_url).trim();
      const testUrl = /^https?:\/\//i.test(normalizedMapUrl) ? normalizedMapUrl : `https://${normalizedMapUrl}`;
      if (!isValidUrl(testUrl, false)) {
        errors[`locations[${idx}].map_url`] = "Map URL must be a valid HTTP/HTTPS URL.";
      }
    }
  });
}

/**
 * Validates languages configuration
 */
function validateLanguages(languages, errors) {
  if (!languages || typeof languages !== "object") return;

  if (languages.supported !== undefined) {
    if (!Array.isArray(languages.supported) || !languages.supported.includes("de") || !languages.supported.includes("en")) {
      errors["languages.supported"] = "Supported languages must be an array containing at least 'de' and 'en'.";
    }
  }

  if (languages.default !== undefined) {
    if (!["de", "en"].includes(languages.default)) {
      errors["languages.default"] = "Default language must be 'de' or 'en'.";
    }
  }
}

/**
 * Validates hero configuration
 */
function validateHero(hero, errors) {
  if (!hero || typeof hero !== "object") return;

  if (hero.items !== undefined) {
    if (!Array.isArray(hero.items)) {
      errors["hero.items"] = "Hero items must be an array.";
      return;
    }

    // Maximum 3 hero carousel items allowed
    if (hero.items.length > 3) {
      errors["hero.items"] = "Hero carousel supports a maximum of 3 items.";
      return;
    }

    // If hero is explicitly enabled, must have at least 1 active item if items array is provided
    if (hero.enabled === true && hero.items.length > 0) {
      const hasActive = hero.items.some((i) => i.enabled !== false);
      if (!hasActive) {
        errors["hero.items"] = "At least 1 active item is required when hero is enabled.";
      }
    }

    hero.items.forEach((item, idx) => {
      if (!item || typeof item !== "object") {
        errors[`hero.items[${idx}]`] = "Item must be an object.";
        return;
      }
      if (item.type && !["IMAGE", "VIDEO"].includes(String(item.type).toUpperCase())) {
        errors[`hero.items[${idx}].type`] = "Item type must be either 'IMAGE' or 'VIDEO'.";
      }
      if (item.type_light && !["IMAGE", "VIDEO"].includes(String(item.type_light).toUpperCase())) {
        errors[`hero.items[${idx}].type_light`] = "Light item type must be either 'IMAGE' or 'VIDEO'.";
      }
      if (item.button_link && !isValidUrl(item.button_link, true)) {
        errors[`hero.items[${idx}].button_link`] = "Button link must be a safe route or URL.";
      }
      if (item.button_link_de && !isValidUrl(item.button_link_de, true)) {
        errors[`hero.items[${idx}].button_link_de`] = "Button link (DE) must be a safe route or URL.";
      }
      if (item.button_link_en && !isValidUrl(item.button_link_en, true)) {
        errors[`hero.items[${idx}].button_link_en`] = "Button link (EN) must be a safe route or URL.";
      }
      if (item.secondary_button_link && !isValidUrl(item.secondary_button_link, true)) {
        errors[`hero.items[${idx}].secondary_button_link`] = "Secondary button link must be a safe route or URL.";
      }
      if (item.secondary_button_link_de && !isValidUrl(item.secondary_button_link_de, true)) {
        errors[`hero.items[${idx}].secondary_button_link_de`] = "Secondary button link (DE) must be a safe route or URL.";
      }
      if (item.secondary_button_link_en && !isValidUrl(item.secondary_button_link_en, true)) {
        errors[`hero.items[${idx}].secondary_button_link_en`] = "Secondary button link (EN) must be a safe route or URL.";
      }
    });
  }
}

/**
 * Validates offers configuration
 */
function validateOffers(offers, errors) {
  if (!offers || typeof offers !== "object") return;

  if (offers.items !== undefined) {
    if (!Array.isArray(offers.items)) {
      errors["offers.items"] = "Offers items must be an array.";
      return;
    }

    offers.items.forEach((offer, idx) => {
      if (!offer || typeof offer !== "object") {
        errors[`offers.items[${idx}]`] = "Offer item must be an object.";
        return;
      }
      if (offer.duration !== undefined && offer.duration !== null) {
        const d = Number(offer.duration);
        if (!Number.isInteger(d) || d < 1) {
          errors[`offers.items[${idx}].duration`] = "Offer duration must be a positive integer.";
        }
      }
      if (offer.link && !isValidUrl(offer.link, true)) {
        errors[`offers.items[${idx}].link`] = "Offer link must be a safe URL or route.";
      }
      if (offer.start_at && isNaN(Date.parse(offer.start_at))) {
        errors[`offers.items[${idx}].start_at`] = "Invalid ISO date format for start_at.";
      }
      if (offer.end_at && isNaN(Date.parse(offer.end_at))) {
        errors[`offers.items[${idx}].end_at`] = "Invalid ISO date format for end_at.";
      }
    });
  }
}

/**
 * Validates social links configuration
 */
function validateSocial(social, errors) {
  if (!social || typeof social !== "object") return;

  const platforms = ["facebook", "instagram", "youtube", "tiktok", "linkedin", "x", "whatsapp"];
  for (const [key, val] of Object.entries(social)) {
    if (!platforms.includes(key.toLowerCase())) {
      errors[`social.${key}`] = `Unsupported social platform: '${key}'. Allowed: ${platforms.join(", ")}.`;
      continue;
    }
    if (val && typeof val === "object" && val.url) {
      const trimmedUrl = String(val.url).trim();
      const testUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
      if (!isValidUrl(testUrl, false)) {
        errors[`social.${key}.url`] = `Invalid URL for ${key}.`;
      }
    }
  }
}

/**
 * Validates navigation configuration
 */
function validateNavigation(navigation, errors) {
  if (!navigation || typeof navigation !== "object") return;

  if (navigation.main !== undefined) {
    if (!Array.isArray(navigation.main)) {
      errors["navigation.main"] = "Main navigation must be an array of navigation items.";
    } else {
      navigation.main.forEach((nav, idx) => {
        if (!nav || typeof nav !== "object") {
          errors[`navigation.main[${idx}]`] = "Navigation item must be an object.";
          return;
        }
        if (nav.route && !isValidUrl(nav.route, true)) {
          errors[`navigation.main[${idx}].route`] = "Navigation route must be a valid relative path or URL.";
        }
      });
    }
  }
}

/**
 * Validates contact form configuration
 */
function validateContactForm(contactForm, errors) {
  if (!contactForm || typeof contactForm !== "object") return;

  if (contactForm.recipient_email !== undefined && contactForm.recipient_email !== null && contactForm.recipient_email !== "") {
    if (typeof contactForm.recipient_email !== "string" || !EMAIL_REGEX.test(contactForm.recipient_email.trim())) {
      errors["contact_form.recipient_email"] = "Invalid recipient email address.";
    }
  }
}

/**
 * Validates Google reviews configuration
 */
function validateGoogleReviews(googleReviews, errors) {
  if (!googleReviews || typeof googleReviews !== "object") return;

  if (googleReviews.profile_url !== undefined && googleReviews.profile_url !== null && googleReviews.profile_url !== "") {
    if (!isValidUrl(googleReviews.profile_url, false)) {
      errors["google_reviews.profile_url"] = "Profile URL must be a valid HTTP/HTTPS URL.";
    }
  }
}

/**
 * Master validator for PATCH /api/settings/admin
 */
function updateSettingsValidator(req) {
  const errors = {};
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    errors.body = "Request body must be a JSON object.";
    return errors;
  }

  const allowedSections = [
    "site",
    "branding",
    "theme",
    "languages",
    "contact",
    "hours",
    "locations",
    "social",
    "navigation",
    "footer",
    "homepage",
    "hero",
    "offers",
    "sell_car",
    "contact_form",
    "google_reviews",
    "about",
  ];

  for (const key of Object.keys(body)) {
    if (!allowedSections.includes(key)) {
      errors[key] = `Invalid settings section: '${key}'. Allowed: ${allowedSections.join(", ")}.`;
    }
  }

  if (body.theme) validateTheme(body.theme, errors);
  if (body.contact) validateContact(body.contact, errors);
  if (body.hours) validateHours(body.hours, errors);
  if (body.locations) validateLocations(body.locations, errors);
  if (body.languages) validateLanguages(body.languages, errors);
  if (body.hero) validateHero(body.hero, errors);
  if (body.offers) validateOffers(body.offers, errors);
  if (body.social) validateSocial(body.social, errors);
  if (body.navigation) validateNavigation(body.navigation, errors);
  if (body.contact_form) validateContactForm(body.contact_form, errors);
  if (body.google_reviews) validateGoogleReviews(body.google_reviews, errors);

  return errors;
}

module.exports = {
  isValidUrl,
  updateSettingsValidator,
};
