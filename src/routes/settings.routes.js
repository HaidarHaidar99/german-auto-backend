/**
 * Settings Routes — public settings and admin CMS routes.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");

const settingsController = require("../controllers/settings.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { errorResponse } = require("../utils/response.util");
const validate = require("../validators/validate.middleware");
const { updateSettingsValidator } = require("../validators/settings.validator");

// Multer memory storage configuration (handles images and videos up to 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
    files: 1,
  },
});

const handleMulterError = (err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, { statusCode: 422, message: "Uploaded file exceeds size limit." });
  }
  next(err);
};

const adminOnly = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ── Public Settings Endpoint ─────────────────────────────────────────────────
router.get("/", settingsController.getPublicSettings);

// ── Admin Settings Endpoints ─────────────────────────────────────────────────
router.get("/admin", ...adminOnly, settingsController.getAdminSettings);
router.patch("/admin", ...adminOnly, validate(updateSettingsValidator), settingsController.updateSettings);
router.post("/admin/reset-section/:section", ...adminOnly, settingsController.resetSection);

// ── Admin Media Upload Endpoints ─────────────────────────────────────────────
router.post(
  "/admin/branding",
  ...adminOnly,
  upload.single("file"),
  handleMulterError,
  settingsController.uploadBranding
);

router.post(
  "/admin/hero/media",
  ...adminOnly,
  upload.single("file"),
  handleMulterError,
  settingsController.uploadHeroMedia
);

module.exports = router;
