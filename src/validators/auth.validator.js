/**
 * Authentication input validators
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signupValidator = (req) => {
  const { full_name, email, password, confirm_password } = req.body || {};
  const errors = {};

  if (!full_name || typeof full_name !== "string" || full_name.trim().length < 2) {
    errors.full_name = "Full name must be at least 2 characters long.";
  }

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.email = "Please provide a valid email address.";
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    errors.password = "Password must be at least 8 characters long.";
  }

  if (password && confirm_password !== undefined && password !== confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  return errors;
};

const loginValidator = (req) => {
  const { email, password } = req.body || {};
  const errors = {};

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.email = "Please provide a valid email address.";
  }

  if (!password || typeof password !== "string") {
    errors.password = "Password is required.";
  }

  return errors;
};

const forgotPasswordValidator = (req) => {
  const { email } = req.body || {};
  const errors = {};

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.email = "Please provide a valid email address.";
  }

  return errors;
};

const resendVerificationValidator = (req) => {
  const { email } = req.body || {};
  const errors = {};

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.email = "Please provide a valid email address.";
  }

  return errors;
};

const resetPasswordValidator = (req) => {
  const { token, password, confirm_password } = req.body || {};
  const errors = {};

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    errors.token = "Reset token is required.";
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    errors.password = "New password must be at least 8 characters long.";
  }

  if (password && confirm_password !== undefined && password !== confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  return errors;
};

const changePasswordValidator = (req) => {
  const { current_password, new_password, confirm_new_password } = req.body || {};
  const errors = {};

  if (!current_password || typeof current_password !== "string") {
    errors.current_password = "Current password is required.";
  }

  if (!new_password || typeof new_password !== "string" || new_password.length < 8) {
    errors.new_password = "New password must be at least 8 characters long.";
  }

  if (new_password && confirm_new_password !== undefined && new_password !== confirm_new_password) {
    errors.confirm_new_password = "Passwords do not match.";
  }

  return errors;
};

module.exports = {
  signupValidator,
  loginValidator,
  forgotPasswordValidator,
  resendVerificationValidator,
  resetPasswordValidator,
  changePasswordValidator,
};
