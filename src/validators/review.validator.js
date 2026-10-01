/**
 * Validation rules for the Reviews module.
 */

const VALID_STATUSES = ["PENDING", "PUBLISHED", "HIDDEN", "DELETED"];
const VALID_MODERATION_STATUSES = ["PUBLISHED", "HIDDEN", "DELETED"];

/**
 * Validates review submission (POST /api/reviews)
 */
function submitReviewValidator(req) {
  const errors = {};
  const { rating, text, user_id, status } = req.body || {};

  // Reject explicit user_id override
  if (user_id !== undefined) {
    errors.user_id = "You cannot specify or override the user_id.";
  }

  // Reject explicit status setting
  if (status !== undefined) {
    errors.status = "Review status cannot be set during submission.";
  }

  // Rating validation: integer between 1 and 5
  if (rating === undefined || rating === null || rating === "") {
    errors.rating = "Rating is required.";
  } else {
    const num = Number(rating);
    const isInt = Number.isInteger(num) && !String(rating).includes(".");
    if (!isInt || num < 1 || num > 5) {
      errors.rating = "Rating must be an integer between 1 and 5.";
    }
  }

  // Text validation: required, trimmed length 5..300
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    errors.text = "Review text is required.";
  } else if (text.trim().length < 5) {
    errors.text = "Review text must be at least 5 characters long.";
  } else if (text.trim().length > 300) {
    errors.text = "Review text cannot exceed 300 characters.";
  }

  return errors;
}

/**
 * Validates public reviews list query params (GET /api/reviews)
 */
function publicListReviewsValidator(req) {
  const errors = {};
  const { page, limit } = req.query || {};

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

  return errors;
}

/**
 * Validates admin review list query params (GET /api/reviews/admin)
 */
function adminListReviewsValidator(req) {
  const errors = {};
  const { status, rating, sort, page, limit } = req.query || {};

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    errors.status = `Status must be one of: ${VALID_STATUSES.join(", ")}.`;
  }

  if (rating !== undefined) {
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      errors.rating = "Rating must be an integer between 1 and 5.";
    }
  }

  if (sort !== undefined && !["newest", "oldest"].includes(sort)) {
    errors.sort = "Sort must be either 'newest' or 'oldest'.";
  }

  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) {
      errors.page = "Page must be a positive integer.";
    }
  }

  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      errors.limit = "Limit must be an integer between 1 and 100.";
    }
  }

  return errors;
}

/**
 * Validates admin review update (PATCH /api/reviews/admin/:id)
 */
function adminUpdateReviewValidator(req) {
  const errors = {};
  const { status, rating, text, user_id, name } = req.body || {};

  if (user_id !== undefined || name !== undefined) {
    errors.user_id = "Review owner or author name cannot be changed.";
  }

  if (status !== undefined && !VALID_MODERATION_STATUSES.includes(status)) {
    errors.status = `Status must be one of: ${VALID_MODERATION_STATUSES.join(", ")}.`;
  }

  if (rating !== undefined) {
    const num = Number(rating);
    const isInt = Number.isInteger(num) && !String(rating).includes(".");
    if (!isInt || num < 1 || num > 5) {
      errors.rating = "Rating must be an integer between 1 and 5.";
    }
  }

  if (text !== undefined) {
    if (typeof text !== "string" || text.trim().length === 0) {
      errors.text = "Review text cannot be empty.";
    } else if (text.trim().length < 5) {
      errors.text = "Review text must be at least 5 characters long.";
    } else if (text.trim().length > 300) {
      errors.text = "Review text cannot exceed 300 characters.";
    }
  }

  const hasUpdateField = status !== undefined || rating !== undefined || text !== undefined;
  if (!hasUpdateField && Object.keys(errors).length === 0) {
    errors.body = "At least one updatable field (status, rating, text) must be provided.";
  }

  return errors;
}

module.exports = {
  VALID_STATUSES,
  VALID_MODERATION_STATUSES,
  submitReviewValidator,
  publicListReviewsValidator,
  adminListReviewsValidator,
  adminUpdateReviewValidator,
};
