const crypto = require("crypto");

/**
 * Generate cryptographically secure random token (64 hex characters)
 */
const generateRandomToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Generate SHA-256 hash of a token
 */
const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

module.exports = {
  generateRandomToken,
  hashToken,
};
