/**
 * Review Routes — defines public and administrative review endpoints.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");

const reviewController = require("../controllers/review.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { reviewSubmissionLimiter } = require("../middleware/rateLimit.middleware");
const { errorResponse } = require("../utils/response.util");
const validate = require("../validators/validate.middleware");
const {
  submitReviewValidator,
  publicListReviewsValidator,
  adminListReviewsValidator,
  adminUpdateReviewValidator,
} = require("../validators/review.validator");

// ── Multer Configuration (Memory Storage) ────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: ${file.mimetype}. Allowed: ${allowed.join(", ")}.`));
    }
  },
});

const handleMulterError = (err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, { statusCode: 422, message: "Review image exceeds the 5 MB size limit." });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    return errorResponse(res, { statusCode: 422, message: "Only 1 image is allowed per review." });
  }
  if (err && err.message && err.message.startsWith("Invalid image type")) {
    return errorResponse(res, { statusCode: 422, message: err.message });
  }
  next(err);
};

// ── Admin Middleware ─────────────────────────────────────────────────────────
const adminOnly = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ── Admin Endpoints ──────────────────────────────────────────────────────────
// GET    /api/reviews/admin        — List reviews with filters
router.get("/admin", ...adminOnly, validate(adminListReviewsValidator), reviewController.listAdmin);

// GET    /api/reviews/admin/:id    — Get single review details
router.get("/admin/:id", ...adminOnly, reviewController.getAdminReview);

// PATCH  /api/reviews/admin/:id    — Update review status/text/rating
router.patch("/admin/:id", ...adminOnly, validate(adminUpdateReviewValidator), reviewController.updateAdminReview);

// DELETE /api/reviews/admin/:id    — Soft-delete review (status=DELETED) + cleanup image
router.delete("/admin/:id", ...adminOnly, reviewController.deleteAdminReview);

// ── Public Endpoints ─────────────────────────────────────────────────────────
// POST   /api/reviews              — Submit review (authenticated user)
router.post(
  "/",
  authenticate,
  reviewSubmissionLimiter,
  upload.single("image"),
  handleMulterError,
  validate(submitReviewValidator),
  reviewController.submitReview
);

// GET    /api/reviews              — Public list of published reviews
router.get("/", validate(publicListReviewsValidator), reviewController.listPublic);

module.exports = router;
