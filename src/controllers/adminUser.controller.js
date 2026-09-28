/**
 * Admin user management controller — thin layer between HTTP and AdminUserService.
 * Follows the same controller pattern as form.controller.js, auth.controller.js, etc.
 */

const adminUserService = require("../services/adminUser.service");
const { successResponse } = require("../utils/response.util");

class AdminUserController {

  // ── List users ──────────────────────────────────────────────────────────────

  async listUsers(req, res, next) {
    try {
      const result = await adminUserService.listUsers(req.query);
      return successResponse(res, {
        data: { users: result.users },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Get single user ─────────────────────────────────────────────────────────

  async getUser(req, res, next) {
    try {
      const user = await adminUserService.getUser(req.params.id);
      return successResponse(res, { data: { user } });
    } catch (err) {
      next(err);
    }
  }

  // ── Create admin user ──────────────────────────────────────────────────────

  async createUser(req, res, next) {
    try {
      const { full_name, email, password, role } = req.body;
      const user = await adminUserService.createUser({
        fullName: full_name,
        email,
        password,
        role,
      });
      return successResponse(res, {
        statusCode: 201,
        message: "Administrator account created successfully.",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Change role ────────────────────────────────────────────────────────────

  async changeRole(req, res, next) {
    try {
      const user = await adminUserService.changeRole({
        targetId: req.params.id,
        newRole: req.body.role,
        currentUserId: req.user.id,
      });
      return successResponse(res, {
        message: "User role updated successfully.",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Delete user ────────────────────────────────────────────────────────────

  async deleteUser(req, res, next) {
    try {
      const result = await adminUserService.deleteUser({
        targetId: req.params.id,
        currentUserId: req.user.id,
      });
      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Revoke sessions ────────────────────────────────────────────────────────

  async revokeSessions(req, res, next) {
    try {
      const result = await adminUserService.revokeSessions({
        targetId: req.params.id,
        currentUserId: req.user.id,
      });
      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminUserController();
