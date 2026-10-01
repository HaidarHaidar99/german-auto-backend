const jwt = require("jsonwebtoken");

const JWT_COOKIE_NAME = "german_auto_jwt";

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev_secret_german_auto_jwt_32_characters_minimum";
  }

  throw new Error("JWT_SECRET is not configured in environment variables.");
};

/**
 * Sign JWT token with user claims.
 * Guarantees a minimum 1 day (24h) session for admin portal users.
 */
const signToken = (payload, options = {}) => {
  const secret = getJwtSecret();
  const isAdmin = payload.role === "ADMIN" || payload.role === "SUPER_ADMIN" || payload.isAdmin;
  const expiresIn = options.expiresIn || (isAdmin ? "24h" : (process.env.JWT_EXPIRES_IN || "24h"));

  return jwt.sign(payload, secret, {
    expiresIn,
  });
};

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  const secret = getJwtSecret();
  return jwt.verify(token, secret);
};

/**
 * Calculate cookie maxAge in milliseconds based on JWT_EXPIRES_IN
 * Guaranteed to stand for at least 24 hours (1 day login session = 86,400,000 ms)
 */
const getCookieMaxAgeMs = () => {
  const expiry = process.env.JWT_EXPIRES_IN || "24h";
  const num = parseInt(expiry, 10);

  if (expiry.endsWith("d")) return Math.max(num * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
  if (expiry.endsWith("h")) return Math.max(num * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
  if (expiry.endsWith("m")) return num * 60 * 1000;
  if (expiry.endsWith("s")) return num * 1000;

  // Default to 24 hours (1 full day login session)
  return 24 * 60 * 60 * 1000;
};

/**
 * Standard secure cookie options
 */
const getAuthCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: getCookieMaxAgeMs(),
    path: "/",
  };
};

/**
 * Set auth cookie on response
 */
const setAuthCookie = (res, token) => {
  res.cookie(JWT_COOKIE_NAME, token, getAuthCookieOptions());
};

/**
 * Clear auth cookie on response
 */
const clearAuthCookie = (res) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.clearCookie(JWT_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  });
};

module.exports = {
  JWT_COOKIE_NAME,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  getAuthCookieOptions,
};
