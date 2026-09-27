/**
 * Review Controller — HTTP interface for public and admin review actions.
 */

const reviewService = require("../services/review.service");
const { successResponse } = require("../utils/response.util");

class ReviewController {
  /**
   * POST /api/reviews
   * Submit a new review (authenticated)
   */
  async submitReview(req, res, next) {
    try {
      const userId = req.user.id;
      const userFullName = req.user.full_name;
      const file = req.file;

      const result = await reviewService.submitReview({
        userId,
        userFullName,
        body: req.body,
        file,
      });

      return successResponse(res, {
        statusCode: 201,
        message: result.message,
        data: { review: result.review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/reviews
   * Public list of published reviews
   */
  async listPublic(req, res, next) {
    try {
      const result = await reviewService.listPublicReviews(req.query);
      return successResponse(res, {
        data: { reviews: result.reviews },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/reviews/admin
   * Admin list of all reviews with filters
   */
  async listAdmin(req, res, next) {
    try {
      const result = await reviewService.listAdminReviews(req.query);
      return successResponse(res, {
        data: { reviews: result.reviews },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/reviews/admin/:id
   * Admin get single review details
   */
  async getAdminReview(req, res, next) {
    try {
      const review = await reviewService.getAdminReview(req.params.id);
      return successResponse(res, {
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/reviews/admin/:id
   * Admin update review status/rating/text
   */
  async updateAdminReview(req, res, next) {
    try {
      const review = await reviewService.updateAdminReview(req.params.id, req.body);
      return successResponse(res, {
        message: "Review updated successfully.",
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/reviews/admin/:id
   * Admin soft-delete review
   */
  async deleteAdminReview(req, res, next) {
    try {
      const review = await reviewService.softDeleteReview(req.params.id);
      return successResponse(res, {
        message: "Review deleted successfully.",
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ReviewController();
