/**
 * Notification Routes — mounts endpoints for admin notification feed,
 * read/unread operations, preferences, and push subscriptions.
 */

const express = require("express");
const router = express.Router();

const notificationController = require("../controllers/notification.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const validate = require("../validators/validate.middleware");
const {
  listNotificationsValidator,
  updatePreferencesValidator,
  pushSubscribeValidator,
  pushUnsubscribeValidator,
} = require("../validators/notification.validator");

const adminOnly = [authenticate, requireRole("ADMIN", "SUPER_ADMIN")];

// ── User / Admin Preferences ─────────────────────────────────────────────────
// Declared before /:id dynamic routes
router.get("/preferences", authenticate, notificationController.getPreferences);
router.patch(
  "/preferences",
  authenticate,
  validate(updatePreferencesValidator),
  notificationController.updatePreferences
);

// ── Web Push Subscriptions ───────────────────────────────────────────────────
router.post(
  "/push/subscribe",
  authenticate,
  validate(pushSubscribeValidator),
  notificationController.subscribePush
);
router.delete(
  "/push/subscribe",
  authenticate,
  validate(pushUnsubscribeValidator),
  notificationController.unsubscribePush
);

// ── Admin Notification Feed ──────────────────────────────────────────────────
router.get("/", ...adminOnly, validate(listNotificationsValidator), notificationController.getNotifications);

// ── Mark Read / Unread / Dismiss ─────────────────────────────────────────────
router.patch("/:id/read", ...adminOnly, notificationController.markRead);
router.patch("/:id/unread", ...adminOnly, notificationController.markUnread);
router.delete("/:id", ...adminOnly, notificationController.dismissNotification);

module.exports = router;
