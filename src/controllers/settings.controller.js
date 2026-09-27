/**
 * Settings Controller — handles public and admin endpoints for CMS settings and assets.
 */

const settingsService = require("../services/settings.service");
const { successResponse } = require("../utils/response.util");

class SettingsController {
  /**
   * GET /api/settings
   * Public settings retrieval
   */
  async getPublicSettings(req, res, next) {
    try {
      const settings = await settingsService.getPublicSettings();
      return successResponse(res, {
        data: { settings },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/settings/admin
   * Full admin settings retrieval
   */
  async getAdminSettings(req, res, next) {
    try {
      const result = await settingsService.getAdminSettings();
      return successResponse(res, {
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/settings/admin
   * Partial section update
   */
  async updateSettings(req, res, next) {
    try {
      const result = await settingsService.updateSettings(req.user.id, req.body);
      return successResponse(res, {
        message: "Settings updated successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/settings/admin/reset-section/:section
   * Reset single section to safe default
   */
  async resetSection(req, res, next) {
    try {
      const result = await settingsService.resetSection(req.user.id, req.params.section);
      return successResponse(res, {
        message: `Section '${req.params.section}' reset to default successfully.`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/settings/admin/branding
   * Upload logo, logo_dark, or favicon
   */
  async uploadBranding(req, res, next) {
    try {
      if (!req.file) {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "File is required." });
      }

      const type = req.body?.type || req.query?.type || "logo";
      const result = await settingsService.uploadBrandingAsset({
        file: req.file,
        type,
        userId: req.user.id,
      });

      return successResponse(res, {
        statusCode: 201,
        message: `Branding asset (${type}) uploaded successfully.`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/settings/admin/hero/media
   * Upload hero media (image or video)
   */
  async uploadHeroMedia(req, res, next) {
    try {
      if (!req.file) {
        const { errorResponse } = require("../utils/response.util");
        return errorResponse(res, { statusCode: 400, message: "Media file is required." });
      }

      const result = await settingsService.uploadHeroMedia({
        file: req.file,
        userId: req.user.id,
      });

      return successResponse(res, {
        statusCode: 201,
        message: "Hero media uploaded successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SettingsController();
