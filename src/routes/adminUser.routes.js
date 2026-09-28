/**
 * Admin user management routes
 *
 * Mounted at: /api/admin/users
 *
 * All endpoints require authentication + SUPER_ADMIN role.
 * Follows the same route pattern as form.routes.js, car.routes.js, etc.
 */

const express = require("express");
const router = express.Router();

const adminUserController = require("../controllers/adminUser.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { adminUserLimiter } = require("../middleware/rateLimit.middleware");
const validate = require("../validators/validate.middleware");
const {
  listUsersValidator,
  createAdminUserValidator,
  changeRoleValidator,
  userIdParamValidator,
} = require("../validators/adminUser.validator");

// ─── SUPER_ADMIN-only middleware stack ────────────────────────────────────────
const superAdminOnly = [authenticate, requireRole("SUPER_ADMIN")];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /api/admin/users              — list users with filters/pagination
router.get(
  "/",
  ...superAdminOnly,
  validate(listUsersValidator),
  adminUserController.listUsers
);

// GET  /api/admin/users/:id          — get single user (safe fields)
router.get(
  "/:id",
  ...superAdminOnly,
  validate(userIdParamValidator),
  adminUserController.getUser
);

// POST /api/admin/users              — create admin/super_admin account
router.post(
  "/",
  ...superAdminOnly,
  adminUserLimiter,
  validate(createAdminUserValidator),
  adminUserController.createUser
);

// PATCH /api/admin/users/:id/role    — change user role
router.patch(
  "/:id/role",
  ...superAdminOnly,
  validate(changeRoleValidator),
  adminUserController.changeRole
);

// DELETE /api/admin/users/:id        — delete user account
router.delete(
  "/:id",
  ...superAdminOnly,
  validate(userIdParamValidator),
  adminUserController.deleteUser
);

// POST /api/admin/users/:id/revoke-sessions — revoke all sessions
router.post(
  "/:id/revoke-sessions",
  ...superAdminOnly,
  validate(userIdParamValidator),
  adminUserController.revokeSessions
);

module.exports = router;
