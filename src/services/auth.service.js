const supabase = require("../config/supabase");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken } = require("../utils/jwt.util");
const { generateRandomToken } = require("../utils/token.util");
const emailService = require("./email.service");

class AuthService {
  /**
   * Register a new CUSTOMER account
   */
  async signup({ fullName, email, password, lang }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, full_name, is_verified")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      if (existingUser.is_verified) {
        const err = new Error("An account with this email address already exists. Please log in.");
        err.statusCode = 409;
        err.isOperational = true;
        throw err;
      }

      // User exists but has NOT verified yet: update credentials & generate a fresh 15-minute token
      const passwordHash = await hashPassword(password);
      const verificationToken = generateRandomToken();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // exactly 15 minutes

      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({
          full_name: fullName.trim(),
          password_hash: passwordHash,
          link: verificationToken,
          link_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUser.id)
        .select("id, full_name, email, role, is_verified, created_at")
        .single();

      if (updateError) {
        throw new Error(`Failed to update unverified account: ${updateError.message}`);
      }

      // Re-send verification email with new token
      await emailService.sendVerificationEmail({
        email: normalizedEmail,
        fullName: updatedUser.full_name,
        token: verificationToken,
        lang,
      });

      return {
        user: updatedUser,
        message: "Registration updated. A new verification link has been sent to your email address.",
      };
    }

    const passwordHash = await hashPassword(password);
    const verificationToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // exactly 15 minutes

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
      lang,
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
  async resendVerification({ email, lang }) {
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
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // exactly 15 minutes

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
      lang,
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
  async forgotPassword({ email, lang }) {
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
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // exactly 15 minutes

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
      lang,
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

  /**
   * Generate Google OAuth authorization URL
   */
  getGoogleAuthUrl({ redirectUri }) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      const err = new Error("GOOGLE_CLIENT_ID is not configured.");
      err.statusCode = 503;
      err.isOperational = true;
      throw err;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Verify Google OAuth credential (ID token) or exchange authorization code
   * STRICTLY RESTRICTED TO ROLE: CUSTOMER
   */
  async googleAuth({ credential, code, redirectUri }) {
    let email = null;
    let fullName = null;
    let emailVerified = false;

    if (credential) {
      // 1. Verify Google ID token via Google's tokeninfo API
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );

      if (!response.ok) {
        const err = new Error("Invalid or expired Google authentication token.");
        err.statusCode = 401;
        err.isOperational = true;
        throw err;
      }

      const payload = await response.json();
      email = payload.email;
      fullName = payload.name;
      emailVerified = payload.email_verified === "true" || payload.email_verified === true;
    } else if (code) {
      // 2. Exchange authorization code for tokens
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        const err = new Error(
          "Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured."
        );
        err.statusCode = 503;
        err.isOperational = true;
        throw err;
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({}));
        const err = new Error(
          errData.error_description || "Failed to exchange Google authorization code."
        );
        err.statusCode = 401;
        err.isOperational = true;
        throw err;
      }

      const tokenData = await tokenRes.json();

      if (tokenData.id_token) {
        const infoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`
        );
        if (infoRes.ok) {
          const info = await infoRes.json();
          email = info.email;
          fullName = info.name;
          emailVerified = info.email_verified === "true" || info.email_verified === true;
        }
      }

      if (!email && tokenData.access_token) {
        const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userRes.ok) {
          const userProfile = await userRes.json();
          email = userProfile.email;
          fullName = userProfile.name;
          emailVerified = userProfile.email_verified === true || userProfile.email_verified === "true";
        }
      }
    } else {
      const err = new Error("Google credential or authorization code is required.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    if (!email || !emailVerified) {
      const err = new Error("Google account email could not be verified.");
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, full_name, email, role, is_verified, token_version, favorite_car_ids, notification_preferences")
      .eq("email", normalizedEmail)
      .maybeSingle();

    let userToAuth = null;

    if (existingUser) {
      // RULE: Google authentication is ONLY available for CUSTOMER accounts!
      // Administrative accounts (ADMIN, SUPER_ADMIN) are strictly forbidden from Google OAuth.
      if (existingUser.role === "ADMIN" || existingUser.role === "SUPER_ADMIN") {
        const err = new Error(
          "Google authentication is restricted to customer accounts only. Administrators must use the secure admin login portal."
        );
        err.statusCode = 403;
        err.isOperational = true;
        throw err;
      }

      // If user was previously unverified, mark verified now
      if (!existingUser.is_verified) {
        await supabase
          .from("users")
          .update({ is_verified: true, updated_at: new Date().toISOString() })
          .eq("id", existingUser.id);
        existingUser.is_verified = true;
      }

      userToAuth = existingUser;
    } else {
      // Create new customer account with role CUSTOMER
      const randomPassword = await hashPassword(generateRandomToken());
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          full_name: (fullName && fullName.trim()) || normalizedEmail.split("@")[0],
          email: normalizedEmail,
          password_hash: randomPassword,
          is_verified: true,
          role: "CUSTOMER", // STRICTLY CUSTOMER! Never ADMIN or SUPER_ADMIN
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
        .select("id, full_name, email, role, is_verified, favorite_car_ids, notification_preferences")
        .single();

      if (insertError) {
        throw new Error(`Failed to create Google customer account: ${insertError.message}`);
      }

      userToAuth = newUser;
    }

    // Issue JWT with 24h lifetime
    const token = signToken({
      id: userToAuth.id,
      role: userToAuth.role,
      token_version: userToAuth.token_version || 0,
    });

    const sanitizedUser = {
      id: userToAuth.id,
      full_name: userToAuth.full_name,
      email: userToAuth.email,
      role: userToAuth.role,
      is_verified: userToAuth.is_verified,
      favorite_car_ids: userToAuth.favorite_car_ids || [],
      notification_preferences: userToAuth.notification_preferences || {},
    };

    return {
      user: sanitizedUser,
      token,
    };
  }
}

module.exports = new AuthService();
