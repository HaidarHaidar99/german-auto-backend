/**
 * Car controller — thin layer between HTTP and CarService.
 * All business logic lives in car.service.js.
 */

const carService = require("../services/car.service");
const { successResponse } = require("../utils/response.util");

class CarController {

  // ── Public endpoints ────────────────────────────────────────────────────────

  async listPublic(req, res, next) {
    try {
      const result = await carService.listPublic(req.query);
      return successResponse(res, {
        data: { cars: result.cars },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  async getPublicCar(req, res, next) {
    try {
      const car = await carService.getPublicCar(req.params.identifier);
      return successResponse(res, { data: { car } });
    } catch (err) {
      next(err);
    }
  }

  // ── Admin endpoints ─────────────────────────────────────────────────────────

  async listAdmin(req, res, next) {
    try {
      const result = await carService.listAdmin(req.query);
      return successResponse(res, {
        data: { cars: result.cars },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  async getAdminCar(req, res, next) {
    try {
      const car = await carService.getAdminCar(req.params.identifier);
      return successResponse(res, { data: { car } });
    } catch (err) {
      next(err);
    }
  }

  async createCar(req, res, next) {
    try {
      const car = await carService.createCar(req.body);
      return successResponse(res, {
        statusCode: 201,
        message: "Car created successfully.",
        data: { car },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateCar(req, res, next) {
    try {
      const car = await carService.updateCar(req.params.id, req.body);
      return successResponse(res, {
        message: "Car updated successfully.",
        data: { car },
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteCar(req, res, next) {
    try {
      const result = await carService.deleteCar(req.params.id);
      return successResponse(res, { message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async setVisibility(req, res, next) {
    try {
      const isVisible = req.body.is_visible;
      if (typeof isVisible !== "boolean") {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "is_visible must be a boolean." });
      }
      const car = await carService.setVisibility(req.params.id, isVisible);
      return successResponse(res, {
        message: `Car is now ${isVisible ? "visible" : "hidden"}.`,
        data: { car },
      });
    } catch (err) {
      next(err);
    }
  }

  async setFeatured(req, res, next) {
    try {
      const isFeatured = req.body.is_featured;
      if (typeof isFeatured !== "boolean") {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "is_featured must be a boolean." });
      }
      const car = await carService.setFeatured(req.params.id, isFeatured);
      return successResponse(res, {
        message: `Car is now ${isFeatured ? "featured" : "unfeatured"}.`,
        data: { car },
      });
    } catch (err) {
      next(err);
    }
  }

  async setStatus(req, res, next) {
    try {
      const { status } = req.body;
      if (!status) {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "status is required." });
      }
      const car = await carService.setStatus(req.params.id, status);
      return successResponse(res, {
        message: `Car status updated to ${status}.`,
        data: { car },
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Favorites ───────────────────────────────────────────────────────────────

  async getFavorites(req, res, next) {
    try {
      const result = await carService.getFavorites(req.user.id);
      return successResponse(res, { data: result });
    } catch (err) {
      next(err);
    }
  }

  async addFavorite(req, res, next) {
    try {
      const { car_id } = req.body;
      if (!car_id || typeof car_id !== "string") {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "car_id is required." });
      }
      const result = await carService.addFavorite(req.user.id, car_id);
      return successResponse(res, {
        message: result.message,
        data: { favorite_car_ids: result.favorite_car_ids },
      });
    } catch (err) {
      next(err);
    }
  }

  async removeFavorite(req, res, next) {
    try {
      const result = await carService.removeFavorite(req.user.id, req.params.carId);
      return successResponse(res, {
        message: result.message,
        data: { favorite_car_ids: result.favorite_car_ids },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new CarController();
