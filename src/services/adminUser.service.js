/**
 * Admin user management service — all business logic for SUPER_ADMIN user management.
 *
 * Uses the existing `users` table. No new tables created.
 * Follows the exact same service pattern as form.service.js, car.service.js, etc.
 *
 * Safe user columns (never return password_hash, links, tokens, internal JSONB):
 *   id, full_name, email, role, is_verified, created_at, updated_at
 */

const supabase = require("../config/supabase");
const { hashPassword } = require("../utils/password");

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Columns returned in admin user list and detail — safe, no secrets */
const SAFE_USER_COLUMNS = "id, full_name, email, role, is_verified, created_at, updated_at";

/** Default notification preferences — matches existing signup defaults */
const DEFAULT_NOTIFICATION_PREFERENCES = {
  forms: true,
  reviews: true,
  push: true,
  sound: true,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

// ─── Admin User Service ────────────────────────────────────────────────────────

class AdminUserService {

  // ── List users ──────────────────────────────────────────────────────────────

  /**
   * List users with optional filtering, search, and pagination.
   */
  async listUsers(queryParams = {}) {
    const {
      role,
      is_verified,
      search,
      page  = 1,
      limit = DEFAULT_PAGE_SIZE,
    } = queryParams;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
    const from     = (pageNum - 1) * pageSize;
    const to       = from + pageSize - 1;

    let query = supabase
      .from("users")
      .select(SAFE_USER_COLUMNS, { count: "exact" });

    // Role filter
    if (role) {
      query = query.eq("role", role);
    }

    // Verification status filter
    if (is_verified !== undefined) {
      const verified = String(is_verified).toLowerCase() === "true";
      query = query.eq("is_verified", verified);
    }

    // Search by name or email (case-insensitive)
    if (search && typeof search === "string" && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
    }

    // Order by created_at descending (newest first)
    query = query.order("created_at", { ascending: false });

    // Pagination
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list users: ${error.message}`);

    return {
      users: data || [],
      meta: {
        total: count || 0,
        page:  pageNum,
        limit: pageSize,
        pages: Math.ceil((count || 0) / pageSize),
      },
    };
  }

  // ── Get single user (safe) ──────────────────────────────────────────────────

  /**
   * Get a single user by ID — returns safe fields only.
   */
  async getUser(id) {
    if (!id) throw opError("User ID is required.", 400);

    const { data, error } = await supabase
      .from("users")
      .select(SAFE_USER_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch user: ${error.message}`);
    if (!data) throw opError("User not found.", 404);

    return data;
  }

  // ── Create admin user ──────────────────────────────────────────────────────

  /**
   * Create an administrative account (ADMIN or SUPER_ADMIN).
   * Created directly as verified — no email verification required.
   */
  async createUser({ fullName, email, password, role }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check for duplicate email
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing) {
      throw opError("An account with this email address already exists.", 409);
    }

    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        full_name: fullName.trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        is_verified: true,
        role,
        token_version: 0,
        favorite_car_ids: [],
        notification_preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        push_subscriptions: [],
      })
      .select(SAFE_USER_COLUMNS)
      .single();

    if (insertError) {
      throw new Error(`Failed to create admin account: ${insertError.message}`);
    }

    return newUser;
  }

  // ── Change role ────────────────────────────────────────────────────────────

  /**
   * Change a user's role. Increments token_version to invalidate existing sessions.
   * Protects against removing the last SUPER_ADMIN.
   */
  async changeRole({ targetId, newRole, currentUserId }) {
    // Fetch target user (with token_version for incrementing)
    const { data: target, error: fetchError } = await supabase
      .from("users")
      .select("id, full_name, email, role, is_verified, token_version, created_at, updated_at")
      .eq("id", targetId)
      .maybeSingle();

    if (fetchError) throw new Error(`Failed to fetch user: ${fetchError.message}`);
    if (!target) throw opError("User not found.", 404);

    // If the role is unchanged, return early (no session invalidation needed)
    if (target.role === newRole) {
      return {
        id: target.id,
        full_name: target.full_name,
        email: target.email,
        role: target.role,
        is_verified: target.is_verified,
        created_at: target.created_at,
        updated_at: target.updated_at,
      };
    }

    // Last SUPER_ADMIN protection: if demoting a SUPER_ADMIN
    if (target.role === "SUPER_ADMIN" && newRole !== "SUPER_ADMIN") {
      await this._ensureNotLastSuperAdmin(targetId);
    }

    // Increment token_version to invalidate all active sessions
    const nextTokenVersion = (target.token_version || 0) + 1;
    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("users")
      .update({
        role: newRole,
        token_version: nextTokenVersion,
        updated_at: now,
      })
      .eq("id", targetId)
      .select(SAFE_USER_COLUMNS)
      .single();

    if (updateError) throw new Error(`Failed to update role: ${updateError.message}`);

    return updated;
  }

  // ── Delete user ────────────────────────────────────────────────────────────

  /**
   * Delete an administrative user account.
   * Uses hard delete consistent with the existing /api/auth/delete-account behavior.
   * Protects against deleting the last SUPER_ADMIN and self-deletion.
   */
  async deleteUser({ targetId, currentUserId }) {
    // Prevent self-deletion through admin endpoint
    if (targetId === currentUserId) {
      throw opError("Cannot delete your own account through admin management. Use account settings instead.", 400);
    }

    // Fetch target to verify existence and role
    const { data: target, error: fetchError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", targetId)
      .maybeSingle();

    if (fetchError) throw new Error(`Failed to fetch user: ${fetchError.message}`);
    if (!target) throw opError("User not found.", 404);

    // Last SUPER_ADMIN protection
    if (target.role === "SUPER_ADMIN") {
      await this._ensureNotLastSuperAdmin(targetId);
    }

    // Hard delete — consistent with existing auth.service.js deleteAccount
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", targetId);

    if (deleteError) throw new Error(`Failed to delete user: ${deleteError.message}`);

    return { message: "User account deleted successfully." };
  }

  // ── Revoke sessions ────────────────────────────────────────────────────────

  /**
   * Revoke all active sessions for a target user by incrementing token_version.
   * Existing JWTs with the previous version become invalid via auth middleware.
   */
  async revokeSessions({ targetId, currentUserId }) {
    // Fetch target user
    const { data: target, error: fetchError } = await supabase
      .from("users")
      .select("id, token_version")
      .eq("id", targetId)
      .maybeSingle();

    if (fetchError) throw new Error(`Failed to fetch user: ${fetchError.message}`);
    if (!target) throw opError("User not found.", 404);

    const nextTokenVersion = (target.token_version || 0) + 1;

    const { error: updateError } = await supabase
      .from("users")
      .update({
        token_version: nextTokenVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetId);

    if (updateError) throw new Error(`Failed to revoke sessions: ${updateError.message}`);

    return { message: "All sessions for this user have been revoked." };
  }

  // ── Internal: Last SUPER_ADMIN guard ───────────────────────────────────────

  /**
   * Ensure the target is not the last remaining SUPER_ADMIN.
   * Throws an operational error if removal/demotion would leave zero SUPER_ADMINs.
   */
  async _ensureNotLastSuperAdmin(targetId) {
    const { count, error } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "SUPER_ADMIN");

    if (error) throw new Error(`Failed to count SUPER_ADMINs: ${error.message}`);

    if ((count || 0) <= 1) {
      throw opError(
        "Cannot perform this operation. At least one SUPER_ADMIN account must exist at all times.",
        403
      );
    }
  }
}

module.exports = new AdminUserService();
