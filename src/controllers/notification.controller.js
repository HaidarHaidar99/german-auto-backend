/**
 * Notification Controller — HTTP interface for notification feed, read/unread states,
 * preferences, and push subscription endpoints.
 */

const notificationService = require("../services/notification.service");
const { successResponse } = require("../utils/response.util");

class NotificationController {
  /**
   * GET /api/notifications
   * Admin notification feed
   */
  async getNotifications(req, res, next) {
    try {
      const result = await notificationService.getAdminNotifications(req.user, req.query);
      return successResponse(res, {
        data: {
          notifications: result.notifications,
          unread_count: result.unread_count,
        },
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/notifications/read-all
   * Mark all notifications as read
   */
  async markAllRead(req, res, next) {
    try {
      const result = await notificationService.markAllRead(req.user.id);
      return successResponse(res, {
        message: "All notifications marked as read.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/notifications/:id/read
   * Mark notification as read
   */
  async markRead(req, res, next) {
    try {
      const result = await notificationService.markRead(req.user.id, req.params.id);
      return successResponse(res, {
        message: "Notification marked as read.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/notifications/:id/unread
   * Mark notification as unread
   */
  async markUnread(req, res, next) {
    try {
      const result = await notificationService.markUnread(req.user.id, req.params.id);
      return successResponse(res, {
        message: "Notification marked as unread.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/notifications/:id
   * Dismiss notification
   */
  async dismissNotification(req, res, next) {
    try {
      const result = await notificationService.dismissNotification(req.user.id, req.params.id);
      return successResponse(res, {
        message: "Notification dismissed successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/notifications/preferences
   * Get user notification preferences
   */
  async getPreferences(req, res, next) {
    try {
      const result = await notificationService.getPreferences(req.user.id);
      return successResponse(res, {
        data: { preferences: result },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/notifications/preferences
   * Update user notification preferences
   */
  async updatePreferences(req, res, next) {
    try {
      const result = await notificationService.updatePreferences(req.user.id, req.body);
      return successResponse(res, {
        message: "Notification preferences updated successfully.",
        data: { preferences: result },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/notifications/push/subscribe
   * Register push subscription
   */
  async subscribePush(req, res, next) {
    try {
      const result = await notificationService.subscribePush(req.user.id, req.body);
      return successResponse(res, {
        statusCode: 201,
        message: "Push subscription registered successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/notifications/push/subscribe
   * Remove push subscription
   */
  async unsubscribePush(req, res, next) {
    try {
      const endpoint = req.body?.endpoint || req.query?.endpoint;
      const result = await notificationService.unsubscribePush(req.user.id, endpoint);
      return successResponse(res, {
        message: "Push subscription removed successfully.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new NotificationController();
