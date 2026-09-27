/**
 * Form controller — thin layer between HTTP and FormService.
 */

const formService = require("../services/form.service");
const { successResponse } = require("../utils/response.util");

class FormController {

  // ── Public: contact form ─────────────────────────────────────────────────────

  async submitContact(req, res, next) {
    try {
      const userId = req.user ? req.user.id : null;
      const result = await formService.submitContact({ body: req.body, userId });
      return successResponse(res, {
        statusCode: 201,
        message: result.message,
        data: { submission_id: result.submission_id },
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Public: sell your car form ───────────────────────────────────────────────

  async submitSellCar(req, res, next) {
    try {
      const userId = req.user ? req.user.id : null;
      // req.files is populated by multer (array of file objects with buffer)
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await formService.submitSellCar({ body: req.body, files, userId });
      return successResponse(res, {
        statusCode: 201,
        message: result.message,
        data: { submission_id: result.submission_id },
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Admin: list forms ────────────────────────────────────────────────────────

  async listForms(req, res, next) {
    try {
      const result = await formService.listForms(req.query);
      return successResponse(res, {
        data: { forms: result.forms },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  // ── Admin: get single form ───────────────────────────────────────────────────

  async getForm(req, res, next) {
    try {
      const form = await formService.getForm(req.params.id);
      return successResponse(res, { data: { form } });
    } catch (err) {
      next(err);
    }
  }

  // ── Admin: update form status / notes ────────────────────────────────────────

  async updateForm(req, res, next) {
    try {
      const form = await formService.updateForm(req.params.id, req.body);
      return successResponse(res, {
        message: "Form updated successfully.",
        data: { form },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new FormController();
