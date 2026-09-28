const rateLimit = require("express-rate-limit");
const { errorResponse } = require("../utils/response.util");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Standard error handler for rate limit exceeded
 */
const rateLimitHandler = (message) => (req, res) => {
  return errorResponse(res, {
    statusCode: 429,
    message,
  });
};

/**
 * Strict limiter for sensitive auth actions (login, reset password)
 * Production: 15 requests per 15 minutes per IP
 * Development/Test: 500 requests per 15 minutes
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 15 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many attempts. Please try again after 15 minutes."),
});

/**
 * Very strict limiter for email sending endpoints (resend verification, forgot password)
 * Production: 5 requests per 15 minutes per IP
 * Development/Test: 200 requests per 15 minutes
 */
const emailActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 5 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many email requests. Please try again in 15 minutes."),
});

/**
 * General API limiter
 * Production: 200 requests per 15 minutes
 * Development/Test: 2000 requests per 15 minutes
 */
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 200 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many requests from this IP. Please try again later."),
});

/**
 * Limiter for review submissions (POST /api/reviews)
 * Production: 10 requests per 15 minutes per IP
 * Development/Test: 200 requests per 15 minutes
 */
const reviewSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many review submissions. Please try again later."),
});

/**
 * Limiter for admin user management (POST /api/admin/users — account creation)
 * Production: 20 requests per 15 minutes per IP
 * Development/Test: 500 requests per 15 minutes
 */
const adminUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many admin user management requests. Please try again later."),
});

module.exports = {
  authLimiter,
  emailActionLimiter,
  generalApiLimiter,
  reviewSubmissionLimiter,
  adminUserLimiter,
};
