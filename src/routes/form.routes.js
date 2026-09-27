const express = require("express");
const router = express.Router();
const multer = require("multer");

const formController = require("../controllers/form.controller");
const { authenticate, optionalAuth, requireRole } = require("../middleware/auth.middleware");
const { emailActionLimiter } = require("../middleware/rateLimit.middleware");
const validate = require("../validators/validate.middleware");
const {
  contactFormValidator,
  sellCarFormValidator,
  adminListFormsValidator,
  adminUpdateFormValidator,
} = require("../validators/form.validator");

// ─── Multer setup (memory storage — buffers sent to Supabase Storage) ─────────
// 10 MB per file max, max 5 files, images only (enforced in service too)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB hard limit per file
    files: 5,                   // max 5 files
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Reject — multer will surface this as a MulterError or we handle in service
      cb(new Error(`Invalid image type: ${file.mimetype}. Allowed: ${allowed.join(", ")}.`));
    }
  },
});

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    const { errorResponse } = require("../utils/response.util");
    return errorResponse(res, { statusCode: 422, message: "One or more images exceed the 10 MB size limit." });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    const { errorResponse } = require("../utils/response.util");
    return errorResponse(res, { statusCode: 422, message: "Maximum 5 images are allowed per submission." });
  }
  if (err && err.message && err.message.startsWith("Invalid image type")) {
    const { errorResponse } = require("../utils/response.util");
    return errorResponse(res, { statusCode: 422, message: err.message });
  }
  next(err);
};

// ─── Admin middleware ─────────────────────────────────────────────────────────
const adminOnly = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ─── Admin form routes ────────────────────────────────────────────────────────
// Declared first so /admin/* is not caught by /:id

// GET  /api/forms/admin              — list all forms with filters/pagination
router.get("/admin", ...adminOnly, validate(adminListFormsValidator), formController.listForms);

// GET  /api/forms/admin/:id          — get single form with full data
router.get("/admin/:id", ...adminOnly, formController.getForm);

// PATCH /api/forms/admin/:id         — update status and/or admin notes
router.patch("/admin/:id", ...adminOnly, validate(adminUpdateFormValidator), formController.updateForm);

// ─── Public form submission routes ───────────────────────────────────────────

// POST /api/forms/contact
// Rate-limited. Optional auth: authenticated users get their user_id associated.
router.post(
  "/contact",
  emailActionLimiter,
  optionalAuth,
  validate(contactFormValidator),
  formController.submitContact
);

// POST /api/forms/sell-car
// Rate-limited. Multipart/form-data (images). Optional auth.
router.post(
  "/sell-car",
  emailActionLimiter,
  optionalAuth,
  upload.array("images", 5),
  handleMulterError,
  validate(sellCarFormValidator),
  formController.submitSellCar
);

module.exports = router;
