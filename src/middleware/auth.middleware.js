const { verifyToken, JWT_COOKIE_NAME } = require("../utils/jwt.util");
const { errorResponse } = require("../utils/response.util");
const supabase = require("../config/supabase");

/**
 * Extract token from HttpOnly cookie or Authorization Bearer header
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  if (req.cookies && req.cookies[JWT_COOKIE_NAME]) {
    return req.cookies[JWT_COOKIE_NAME];
  }

  return null;
};

/**
 * Mandatory authentication middleware
 */
const authenticate = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return errorResponse(res, {
      statusCode: 401,
      message: "Authentication required",
    });
  }

  try {
    const decoded = verifyToken(token);

    // Fetch user from DB to verify status and token_version
    const { data: user, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, is_verified, token_version, favorite_car_ids, notification_preferences")
      .eq("id", decoded.id)
      .maybeSingle();

    if (error || !user) {
      return errorResponse(res, {
        statusCode: 401,
        message: "User account not found or deactivated",
      });
    }

    // Invalidate token if token_version has been incremented (e.g. password reset/logout)
    if (user.token_version !== decoded.token_version) {
      return errorResponse(res, {
        statusCode: 401,
        message: "Session expired. Please log in again.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return errorResponse(res, {
        statusCode: 401,
        message: "Session expired. Please log in again.",
      });
    }

    return errorResponse(res, {
      statusCode: 401,
      message: "Invalid authentication credentials",
    });
  }
};

/**
 * Optional authentication middleware (for public endpoints with personalized data when authenticated)
 */
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = verifyToken(token);
    const { data: user } = await supabase
      .from("users")
      .select("id, full_name, email, role, is_verified, token_version, favorite_car_ids, notification_preferences")
      .eq("id", decoded.id)
      .maybeSingle();

    if (user && user.token_version === decoded.token_version) {
      req.user = user;
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }

  next();
};

/**
 * Role-based authorization middleware
 * @param  {...string} roles Allowed roles ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, {
        statusCode: 401,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return errorResponse(res, {
        statusCode: 403,
        message: "Forbidden: You do not have permission to access this resource.",
      });
    }

    next();
  };
};

/**
 * Verification requirement middleware
 */
const requireVerified = (req, res, next) => {
  if (!req.user) {
    return errorResponse(res, {
      statusCode: 401,
      message: "Authentication required",
    });
  }

  if (!req.user.is_verified) {
    return errorResponse(res, {
      statusCode: 403,
      message: "Please verify your email address to perform this action.",
    });
  }

  next();
};

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireVerified,
};
