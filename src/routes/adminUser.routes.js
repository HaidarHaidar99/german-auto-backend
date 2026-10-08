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

// ─── ADMIN and SUPER_ADMIN middleware stack ─────────────────────────────────
const adminOrSuperAdmin = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /api/admin/users              — list users with filters/pagination
router.get(
  "/",
  ...adminOrSuperAdmin,
  validate(listUsersValidator),
  adminUserController.listUsers
);

// GET  /api/admin/users/:id          — get single user (safe fields)
router.get(
  "/:id",
  ...adminOrSuperAdmin,
  validate(userIdParamValidator),
  adminUserController.getUser
);

// POST /api/admin/users              — create admin/super_admin account
router.post(
  "/",
  ...adminOrSuperAdmin,
  adminUserLimiter,
  validate(createAdminUserValidator),
  adminUserController.createUser
);

// PATCH /api/admin/users/:id/role    — change user role
router.patch(
  "/:id/role",
  ...adminOrSuperAdmin,
  validate(changeRoleValidator),
  adminUserController.changeRole
);

// DELETE /api/admin/users/:id        — delete user account
router.delete(
  "/:id",
  ...adminOrSuperAdmin,
  validate(userIdParamValidator),
  adminUserController.deleteUser
);

// POST /api/admin/users/:id/revoke-sessions — revoke all sessions
router.post(
  "/:id/revoke-sessions",
  ...adminOrSuperAdmin,
  validate(userIdParamValidator),
  adminUserController.revokeSessions
);

module.exports = router;
