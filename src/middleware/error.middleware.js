const { errorResponse } = require("../utils/response.util");

/**
 * Centralized error handling middleware
 * Prevents leaking stack traces, SQL internals, or secrets in production.
 */
const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  const statusCode = err.statusCode || 500;

  // Log full error for diagnostics
  if (!isProduction) {
    console.error("[ErrorHandler]", err);
  } else {
    // In production, log brief summary
    console.error(`[ErrorHandler] ${err.name || "Error"} (${statusCode}): ${err.message}`);
  }

  // Safe error message for client
  let clientMessage = err.message || "Internal server error";

  // Hide internal server errors in production unless explicitly marked operational
  if (isProduction && statusCode === 500 && !err.isOperational) {
    clientMessage = "An unexpected error occurred. Please try again later.";
  }

  return errorResponse(res, {
    statusCode,
    message: clientMessage,
    errors: !isProduction && err.errors ? err.errors : null,
  });
};

module.exports = errorHandler;