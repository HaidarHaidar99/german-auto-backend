const express = require("express");
const router = express.Router();

const carController = require("../controllers/car.controller");
const { authenticate, requireRole, requireVerified } = require("../middleware/auth.middleware");
const validate = require("../validators/validate.middleware");
const {
  createCarValidator,
  updateCarValidator,
  listCarsQueryValidator,
} = require("../validators/car.validator");

// ─── Admin middleware shorthand ───────────────────────────────────────────────
// ADMIN and SUPER_ADMIN can manage inventory. CUSTOMER is explicitly forbidden.
const adminOnly = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ─── Favorites routes ─────────────────────────────────────────────────────────
// Declared BEFORE /:identifier so that "favorites" is not caught as a car identifier.

// GET    /api/cars/favorites          — get authenticated user's favorite cars
router.get("/favorites", authenticate, requireVerified, carController.getFavorites);

// POST   /api/cars/favorites          — add a car to favorites
router.post("/favorites", authenticate, requireVerified, carController.addFavorite);

// DELETE /api/cars/favorites/:carId   — remove a car from favorites
router.delete("/favorites/:carId", authenticate, requireVerified, carController.removeFavorite);

const multer = require("multer");
const { errorResponse } = require("../utils/response.util");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per image
    files: 20,
  },
});

const handleMulterError = (err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return errorResponse(res, { statusCode: 422, message: "Uploaded image exceeds 15 MB limit." });
  }
  if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
    return errorResponse(res, { statusCode: 422, message: "Maximum 20 images allowed per upload." });
  }
  next(err);
};

// ─── Admin inventory routes ───────────────────────────────────────────────────
// Declared BEFORE /:identifier so that "admin" is not caught as a car identifier.

// POST /api/cars/admin/upload-media        — upload car images from device (up to 20 images)
router.post(
  "/admin/upload-media",
  ...adminOnly,
  upload.array("images", 20),
  handleMulterError,
  carController.uploadMedia
);

// GET  /api/cars/admin/list               — admin list (all cars, incl. hidden)
router.get("/admin/list", ...adminOnly, validate(listCarsQueryValidator), carController.listAdmin);

// GET  /api/cars/admin/:identifier        — admin detail (by slug or UUID)
router.get("/admin/:identifier", ...adminOnly, carController.getAdminCar);

// POST /api/cars/admin                    — create a new car
router.post("/admin", ...adminOnly, validate(createCarValidator), carController.createCar);

// PATCH /api/cars/admin/:id/visibility    — show or hide a car
router.patch("/admin/:id/visibility", ...adminOnly, carController.setVisibility);

// PATCH /api/cars/admin/:id/featured      — mark or unmark as featured
router.patch("/admin/:id/featured", ...adminOnly, carController.setFeatured);

// PATCH /api/cars/admin/:id/status        — change car status
router.patch("/admin/:id/status", ...adminOnly, carController.setStatus);

// PATCH /api/cars/admin/:id               — full/partial car update
router.patch("/admin/:id", ...adminOnly, validate(updateCarValidator), carController.updateCar);

// DELETE /api/cars/admin/:id              — delete a car permanently
router.delete("/admin/:id", ...adminOnly, carController.deleteCar);

// ─── Public inventory routes ──────────────────────────────────────────────────
// These come LAST so that static segments above are matched first.

// GET /api/cars                   — public listing with filters/sort/pagination
router.get("/", validate(listCarsQueryValidator), carController.listPublic);

// GET /api/cars/:identifier       — public detail by slug or UUID
router.get("/:identifier", carController.getPublicCar);

module.exports = router;
