const express = require("express");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authLimiter, emailActionLimiter } = require("../middleware/rateLimit.middleware");
const validate = require("../validators/validate.middleware");
const {
  signupValidator,
  loginValidator,
  forgotPasswordValidator,
  resendVerificationValidator,
  resetPasswordValidator,
  changePasswordValidator,
} = require("../validators/auth.validator");

// Public — registration & email verification
router.post("/signup", validate(signupValidator), authController.signup);
router.get("/verify-email", authController.verifyEmail);
router.post("/verify-email", authController.verifyEmail);
router.post(
  "/resend-verification",
  emailActionLimiter,
  validate(resendVerificationValidator),
  authController.resendVerification
);

// Public — authentication
router.post("/login", authLimiter, validate(loginValidator), authController.login);
router.post("/logout", authController.logout);

// Public — Google OAuth (Customer Accounts Only)
router.get("/google", authLimiter, authController.googleAuthUrl);
router.get("/google/callback", authController.googleAuthCallback);
router.post("/google", authLimiter, authController.googleAuth);

// Public — password recovery
router.post(
  "/forgot-password",
  emailActionLimiter,
  validate(forgotPasswordValidator),
  authController.forgotPassword
);
router.post(
  "/reset-password",
  authLimiter,
  validate(resetPasswordValidator),
  authController.resetPassword
);

// Protected — authenticated user operations
router.get("/me", authenticate, authController.getMe);
router.post(
  "/change-password",
  authenticate,
  validate(changePasswordValidator),
  authController.changePassword
);
router.delete("/delete-account", authenticate, authController.deleteAccount);

module.exports = router;
