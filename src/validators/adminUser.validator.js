/**
 * Admin user management validators
 *
 * Follows the exact same validator pattern used across the project:
 * - Validator is a function that receives `req`
 * - Returns an object of field→error entries (empty = valid)
 * - Used with the shared `validate` middleware
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROLES = ["CUSTOMER", "ADMIN", "SUPER_ADMIN"];
const VALID_CREATION_ROLES = ["ADMIN", "SUPER_ADMIN"];

// ─── List users validator ────────────────────────────────────────────────────

const listUsersValidator = (req) => {
  const { role, is_verified, page, limit } = req.query || {};
  const errors = {};

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    errors.role = `Invalid role. Allowed: ${VALID_ROLES.join(", ")}`;
  }

  if (is_verified !== undefined) {
    const v = String(is_verified).toLowerCase();
    if (!["true", "false"].includes(v)) {
      errors.is_verified = "is_verified must be true or false.";
    }
  }

  if (page !== undefined) {
    const p = parseInt(page, 10);
    if (isNaN(p) || p < 1) {
      errors.page = "Page must be a positive integer.";
    }
  }

  if (limit !== undefined) {
    const l = parseInt(limit, 10);
    if (isNaN(l) || l < 1) {
      errors.limit = "Limit must be a positive integer.";
    }
  }

  return errors;
};

// ─── Create admin user validator ─────────────────────────────────────────────

const createAdminUserValidator = (req) => {
  const { full_name, email, password, confirm_password, role } = req.body || {};
  const errors = {};

  if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2) {
    errors.full_name = "Full name must be at least 2 characters long.";
  }

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.email = "Please provide a valid email address.";
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    errors.password = "Password must be at least 8 characters long.";
  }

  if (password && confirm_password !== undefined && password !== confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  if (!role || !VALID_CREATION_ROLES.includes(role)) {
    errors.role = `Role is required and must be one of: ${VALID_CREATION_ROLES.join(", ")}`;
  }

  return errors;
};

// ─── Change role validator ───────────────────────────────────────────────────

const changeRoleValidator = (req) => {
  const errors = {};

  // Validate UUID param
  const id = req.params && req.params.id;
  if (!id || !UUID_REGEX.test(id)) {
    errors.id = "A valid user UUID is required.";
  }

  const { role } = req.body || {};
  if (!role || !VALID_ROLES.includes(role)) {
    errors.role = `Role is required and must be one of: ${VALID_ROLES.join(", ")}`;
  }

  return errors;
};

// ─── UUID param validator ────────────────────────────────────────────────────

const userIdParamValidator = (req) => {
  const errors = {};
  const id = req.params && req.params.id;
  if (!id || !UUID_REGEX.test(id)) {
    errors.id = "A valid user UUID is required.";
  }
  return errors;
};

module.exports = {
  listUsersValidator,
  createAdminUserValidator,
  changeRoleValidator,
  userIdParamValidator,
};
