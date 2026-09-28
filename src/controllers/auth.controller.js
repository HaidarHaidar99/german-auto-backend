const authService = require("../services/auth.service");
const { successResponse } = require("../utils/response.util");
const { setAuthCookie, clearAuthCookie } = require("../utils/jwt.util");

class AuthController {
  async signup(req, res, next) {
    try {
      const { full_name, email, password } = req.body;
      const result = await authService.signup({
        fullName: full_name,
        email,
        password,
      });

      return successResponse(res, {
        statusCode: 201,
        message: result.message,
        data: { user: result.user },
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyEmail(req, res, next) {
    try {
      // Express 5: req.query is always an object, never undefined.
      // req.body may also be empty if GET request.
      const token =
        (req.query && req.query.token) ||
        (req.body && req.body.token) ||
        null;
      const result = await authService.verifyEmail({ token });

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async resendVerification(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.resendVerification({ email });

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, token } = await authService.login({ email, password });

      // Set JWT in secure HttpOnly cookie
      setAuthCookie(res, token);

      return successResponse(res, {
        message: "Login successful.",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {
      clearAuthCookie(res);

      return successResponse(res, {
        message: "Logged out successfully.",
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword({ email });

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, password } = req.body;
      const result = await authService.resetPassword({
        token,
        newPassword: password,
      });

      // Clear any existing cookie as tokens were invalidated
      clearAuthCookie(res);

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { current_password, new_password } = req.body;
      const result = await authService.changePassword({
        userId: req.user.id,
        currentPassword: current_password,
        newPassword: new_password,
      });

      // Set updated JWT with incremented token_version
      setAuthCookie(res, result.token);

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteAccount(req, res, next) {
    try {
      const result = await authService.deleteAccount({ userId: req.user.id });
      clearAuthCookie(res);

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async getMe(req, res, next) {
    try {
      const user = await authService.getMe({ userId: req.user.id });

      return successResponse(res, {
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  }

  async googleAuthUrl(req, res, next) {
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

      if (!process.env.GOOGLE_CLIENT_ID) {
        if (req.accepts("html") && !req.xhr) {
          return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
        }
        return res.status(503).json({
          success: false,
          error: {
            message: "Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured.",
          },
        });
      }

      const url = authService.getGoogleAuthUrl({ redirectUri });
      return res.redirect(url);
    } catch (err) {
      next(err);
    }
  }

  async googleAuthCallback(req, res, next) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    try {
      const { code, error } = req.query;

      if (error) {
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
      }

      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
      const { user, token } = await authService.googleAuth({ code, redirectUri });

      // Set JWT in HttpOnly cookie named 'german_auto_jwt'
      setAuthCookie(res, token);

      return res.redirect(`${frontendUrl}/account`);
    } catch (err) {
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(err.message)}`);
    }
  }

  async googleAuth(req, res, next) {
    try {
      const { credential, code, redirect_uri } = req.body;
      const { user, token } = await authService.googleAuth({
        credential,
        code,
        redirectUri: redirect_uri,
      });

      // Set JWT in HttpOnly cookie named 'german_auto_jwt'
      setAuthCookie(res, token);

      return successResponse(res, {
        message: "Google authentication successful.",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
