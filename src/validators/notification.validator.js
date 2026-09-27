/**
 * Validation rules for the Notifications module.
 */

const VALID_NOTIFICATION_TYPES = ["CONTACT_FORM", "SELL_CAR_FORM", "NEW_REVIEW", "SYSTEM"];
const SUPPORTED_PREFERENCE_KEYS = ["forms", "reviews", "push", "sound"];

/**
 * Validates admin notification feed query parameters (GET /api/notifications)
 */
function listNotificationsValidator(req) {
  const errors = {};
  const { page, limit, type, status, sort } = req.query || {};

  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) {
      errors.page = "Page must be a positive integer.";
    }
  }

  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1 || l > 50) {
      errors.limit = "Limit must be an integer between 1 and 50.";
    }
  }

  if (type !== undefined && !VALID_NOTIFICATION_TYPES.includes(type)) {
    errors.type = `Type must be one of: ${VALID_NOTIFICATION_TYPES.join(", ")}.`;
  }

  if (status !== undefined && !["read", "unread"].includes(status)) {
    errors.status = "Status must be either 'read' or 'unread'.";
  }

  if (sort !== undefined && !["newest", "oldest"].includes(sort)) {
    errors.sort = "Sort must be either 'newest' or 'oldest'.";
  }

  return errors;
}

/**
 * Validates notification preferences update (PATCH /api/notifications/preferences)
 */
function updatePreferencesValidator(req) {
  const errors = {};
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    errors.body = "Request body must be an object.";
    return errors;
  }

  const providedKeys = Object.keys(body);
  if (providedKeys.length === 0) {
    errors.body = "At least one preference setting must be provided.";
    return errors;
  }

  // Reject unsupported keys to prevent arbitrary JSON injection
  for (const key of providedKeys) {
    if (!SUPPORTED_PREFERENCE_KEYS.includes(key)) {
      errors[key] = `Invalid preference field: '${key}'. Allowed fields: ${SUPPORTED_PREFERENCE_KEYS.join(", ")}.`;
    } else if (typeof body[key] !== "boolean") {
      errors[key] = `Preference '${key}' must be a boolean value.`;
    }
  }

  return errors;
}

/**
 * Validates push subscription payload (POST /api/notifications/push/subscribe)
 */
function pushSubscribeValidator(req) {
  const errors = {};
  const { endpoint, keys } = req.body || {};

  if (!endpoint || typeof endpoint !== "string" || !/^https?:\/\//i.test(endpoint.trim())) {
    errors.endpoint = "A valid HTTPS/HTTP push service endpoint URL is required.";
  }

  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    errors.keys = "Subscription keys object is required.";
  } else {
    if (!keys.p256dh || typeof keys.p256dh !== "string" || keys.p256dh.trim().length === 0) {
      errors["keys.p256dh"] = "Public key p256dh is required.";
    }
    if (!keys.auth || typeof keys.auth !== "string" || keys.auth.trim().length === 0) {
      errors["keys.auth"] = "Auth secret is required.";
    }
  }

  return errors;
}

/**
 * Validates push unsubscription payload (DELETE /api/notifications/push/subscribe)
 */
function pushUnsubscribeValidator(req) {
  const errors = {};
  const endpoint = req.body?.endpoint || req.query?.endpoint;

  if (!endpoint || typeof endpoint !== "string" || endpoint.trim().length === 0) {
    errors.endpoint = "Subscription endpoint URL is required to unsubscribe.";
  }

  return errors;
}

module.exports = {
  VALID_NOTIFICATION_TYPES,
  SUPPORTED_PREFERENCE_KEYS,
  listNotificationsValidator,
  updatePreferencesValidator,
  pushSubscribeValidator,
  pushUnsubscribeValidator,
};
