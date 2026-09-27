const jwt = require("jsonwebtoken");

const JWT_COOKIE_NAME = "token";

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
 * Sign JWT token with user claims
 */
const signToken = (payload) => {
  const secret = getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || "15m";

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
 */
const getCookieMaxAgeMs = () => {
  const expiry = process.env.JWT_EXPIRES_IN || "15m";
  const num = parseInt(expiry, 10);

  if (expiry.endsWith("d")) return num * 24 * 60 * 60 * 1000;
  if (expiry.endsWith("h")) return num * 60 * 60 * 1000;
  if (expiry.endsWith("m")) return num * 60 * 1000;
  if (expiry.endsWith("s")) return num * 1000;

  // Default to 15 minutes
  return 15 * 60 * 1000;
};

/**
 * Standard secure cookie options
 */
const getAuthCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

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
