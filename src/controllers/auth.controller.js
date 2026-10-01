const authService = require("../services/auth.service");
const { successResponse, errorResponse } = require("../utils/response.util");
const { setAuthCookie, clearAuthCookie } = require("../utils/jwt.util");

function extractLanguage(req) {
  if (req.body && typeof req.body.lang === "string") {
    const l = req.body.lang.toLowerCase().trim();
    if (l.startsWith("en")) return "en";
    if (l.startsWith("de")) return "de";
  }
  const acceptLang = req.headers["accept-language"];
  if (acceptLang && typeof acceptLang === "string") {
    const l = acceptLang.toLowerCase();
    if (l.startsWith("en") || l.includes(",en") || l.includes(";en")) return "en";
  }
  return "de";
}

function resolveFrontendUrl(req) {
  // PRODUCTION HARDCODE: Always use the known frontend Vercel URL in production
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return "https://german-auto-frontend.vercel.app";
  }

  // Check Origin/Referer headers for Vercel
  const origin = (req && (req.get("origin") || req.get("referer"))) || "";
  if (origin.includes("vercel.app")) {
    return "https://german-auto-frontend.vercel.app";
  }

  // Local development
  if (process.env.FRONTEND_URL) {
    let url = process.env.FRONTEND_URL.replace(/\/+$/, "");
    // Ensure protocol prefix
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    return url;
  }

  return "http://localhost:5173";
}

function resolveRedirectUri(req) {
  // PRODUCTION: Use the frontend domain as the callback URL.
  // The frontend's vercel.json reverse proxy will forward /api/* to the backend.
  // This makes Google consent screen show "german-auto-frontend.vercel.app" instead of the backend domain.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return "https://german-auto-frontend.vercel.app/api/auth/google/callback";
  }

  const host = req.get("host") || "";
  if (host.includes("vercel.app")) {
    return "https://german-auto-frontend.vercel.app/api/auth/google/callback";
  }

  // Local development
  const protocol = req.protocol || "http";
  return `${protocol}://${host}/api/auth/google/callback`;
}

class AuthController {
  async signup(req, res, next) {
    try {
      const { full_name, email, password } = req.body;
      const lang = extractLanguage(req);
      const result = await authService.signup({
        fullName: full_name,
        email,
        password,
        lang,
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
      const lang = extractLanguage(req);
      const result = await authService.resendVerification({ email, lang });

      return successResponse(res, {
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password, isAdminLogin } = req.body;
      const isPortalAdmin = Boolean(isAdminLogin || req.headers["x-admin-portal"] === "true");
      const { user, token } = await authService.login({ email, password });

      // If logging in from the dedicated admin portal, verify role
      if (isPortalAdmin) {
        if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
          return errorResponse(res, {
            statusCode: 403,
            message: "Zugriff verweigert. Nur Administratoren dürfen sich im Admin-Portal anmelden.",
          });
        }
      }

      // Set JWT in secure HttpOnly cookie guaranteed for 24h (1 day)
      setAuthCookie(res, token);

      return successResponse(res, {
        message: "Login successful.",
        data: { user, token },
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
      const lang = extractLanguage(req);
      const result = await authService.forgotPassword({ email, lang });

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
      const frontendUrl = resolveFrontendUrl(req);
      const redirectUri = resolveRedirectUri(req);

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
    const frontendUrl = resolveFrontendUrl(req);
    try {
      const { code, error } = req.query;

      if (error) {
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
      }

      const redirectUri = resolveRedirectUri(req);
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
