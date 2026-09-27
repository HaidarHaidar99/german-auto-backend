const supabase = require("../config/supabase");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken } = require("../utils/jwt.util");
const { generateRandomToken } = require("../utils/token.util");
const emailService = require("./email.service");

class AuthService {
  /**
   * Register a new CUSTOMER account
   */
  async signup({ fullName, email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, is_verified")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      const err = new Error("An account with this email address already exists.");
      err.statusCode = 409;
      err.isOperational = true;
      throw err;
    }

    const passwordHash = await hashPassword(password);
    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        full_name: fullName.trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        is_verified: false,
        role: "CUSTOMER",
        link: verificationToken,
        link_expires_at: expiresAt,
        token_version: 0,
        favorite_car_ids: [],
        notification_preferences: {
          forms: true,
          reviews: true,
          push: true,
          sound: true,
        },
        push_subscriptions: [],
      })
      .select("id, full_name, email, role, is_verified, created_at")
      .single();

    if (insertError) {
      throw new Error(`Failed to create account: ${insertError.message}`);
    }

    // Send verification email
    await emailService.sendVerificationEmail({
      email: normalizedEmail,
      fullName: newUser.full_name,
      token: verificationToken,
    });

    return {
      user: newUser,
      message: "Registration successful. Please check your email to verify your account.",
    };
  }

  /**
   * Verify email via one-time token
   */
  async verifyEmail({ token }) {
    if (!token) {
      const err = new Error("Verification token is required.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    const now = new Date().toISOString();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, is_verified, link_expires_at")
      .eq("link", token)
      .maybeSingle();

    if (error || !user) {
      const err = new Error("Invalid or expired verification token.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    if (user.link_expires_at && new Date(user.link_expires_at) < new Date(now)) {
      const err = new Error("Verification link has expired. Please request a new one.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    // Mark as verified and invalidate one-time verification token
    const { error: updateError } = await supabase
      .from("users")
      .update({
        is_verified: true,
        link: null,
        link_expires_at: null,
        updated_at: now,
      })
      .eq("id", user.id);

    if (updateError) {
      throw new Error(`Failed to update verification status: ${updateError.message}`);
    }

    return {
      message: "Email address verified successfully. You can now log in.",
    };
  }

  /**
   * Resend account verification email
   */
  async resendVerification({ email }) {
    const normalizedEmail = email.toLowerCase().trim();

    const { data: user } = await supabase
      .from("users")
      .select("id, full_name, is_verified")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // Prevent email enumeration: return standard success message regardless
    if (!user) {
      return { message: "If an unverified account exists, a new verification link was sent." };
    }

    if (user.is_verified) {
      return { message: "This account is already verified. You can log in directly." };
    }

    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({
        link: verificationToken,
        link_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    await emailService.sendVerificationEmail({
      email: normalizedEmail,
      fullName: user.full_name,
      token: verificationToken,
    });

    return { message: "If an unverified account exists, a new verification link was sent." };
  }

  /**
   * Authenticate user and issue JWT
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, password_hash, role, is_verified, token_version, favorite_car_ids, notification_preferences")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error || !user) {
      const err = new Error("Invalid email or password.");
      err.statusCode = 401;
      err.isOperational = true;
      throw err;
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      const err = new Error("Invalid email or password.");
      err.statusCode = 401;
      err.isOperational = true;
      throw err;
    }

    // Unverified accounts cannot perform authenticated actions
    if (!user.is_verified) {
      const err = new Error("Please verify your email address before logging in.");
      err.statusCode = 403;
      err.isOperational = true;
      throw err;
    }

    // Issue JWT with user ID, role, and current token_version
    const token = signToken({
      id: user.id,
      role: user.role,
      token_version: user.token_version,
    });

    // Strip password hash from returned object
    const sanitizedUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      is_verified: user.is_verified,
      favorite_car_ids: user.favorite_car_ids,
      notification_preferences: user.notification_preferences,
    };

    return {
      user: sanitizedUser,
      token,
    };
  }

  /**
   * Request password reset token
   */
  async forgotPassword({ email }) {
    const normalizedEmail = email.toLowerCase().trim();

    const { data: user } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // Prevent enumeration: always return standard response
    if (!user) {
      return { message: "If an account exists with this email, a password reset link has been sent." };
    }

    const resetToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabase
      .from("users")
      .update({
        reset_link: resetToken,
        reset_link_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    await emailService.sendPasswordResetEmail({
      email: normalizedEmail,
      fullName: user.full_name,
      token: resetToken,
    });

    return { message: "If an account exists with this email, a password reset link has been sent." };
  }

  /**
   * Reset password via reset token
   */
  async resetPassword({ token, newPassword }) {
    if (!token) {
      const err = new Error("Reset token is required.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    const now = new Date().toISOString();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, token_version, reset_link_expires_at")
      .eq("reset_link", token)
      .maybeSingle();

    if (error || !user) {
      const err = new Error("Invalid or expired password reset link.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    if (user.reset_link_expires_at && new Date(user.reset_link_expires_at) < new Date(now)) {
      const err = new Error("Password reset link has expired. Please request a new one.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    const newHash = await hashPassword(newPassword);

    // Invalidate all existing JWT sessions by incrementing token_version
    const nextTokenVersion = (user.token_version || 0) + 1;

    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: newHash,
        reset_link: null,
        reset_link_expires_at: null,
        token_version: nextTokenVersion,
        updated_at: now,
      })
      .eq("id", user.id);

    if (updateError) {
      throw new Error(`Failed to reset password: ${updateError.message}`);
    }

    return { message: "Password reset successful. Please log in with your new password." };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword({ userId, currentPassword, newPassword }) {
    // Select role as well — required for re-signing the JWT
    const { data: user, error } = await supabase
      .from("users")
      .select("id, role, password_hash, token_version")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      err.isOperational = true;
      throw err;
    }

    const isMatch = await comparePassword(currentPassword, user.password_hash);
    if (!isMatch) {
      const err = new Error("Current password is incorrect.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    const newHash = await hashPassword(newPassword);
    const nextTokenVersion = (user.token_version || 0) + 1;

    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: newHash,
        token_version: nextTokenVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      throw new Error(`Failed to update password: ${updateError.message}`);
    }

    // Issue refreshed token with the new token_version so the current session stays valid
    const newToken = signToken({
      id: user.id,
      role: user.role,
      token_version: nextTokenVersion,
    });

    return {
      message: "Password changed successfully.",
      token: newToken,
    };
  }

  /**
   * Delete account (authenticated customer)
   */
  async deleteAccount({ userId }) {
    // Delete user from users table. Cascades/nulls are handled by Foreign Key constraints.
    const { error } = await supabase.from("users").delete().eq("id", userId);

    if (error) {
      throw new Error(`Failed to delete account: ${error.message}`);
    }

    return { message: "Account deleted successfully." };
  }

  /**
   * Get current authenticated user profile
   */
  async getMe({ userId }) {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, is_verified, favorite_car_ids, notification_preferences, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      err.isOperational = true;
      throw err;
    }

    return user;
  }
}

module.exports = new AuthService();
