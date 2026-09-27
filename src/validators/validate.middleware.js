const { errorResponse } = require("../utils/response.util");

/**
 * Higher-order middleware for running validation rules on req.body, req.query, or req.params
 */
const validate = (validatorFn) => {
  return (req, res, next) => {
    const errors = validatorFn(req);

    if (errors && Object.keys(errors).length > 0) {
      return errorResponse(res, {
        statusCode: 400,
        message: "Validation failed",
        errors,
      });
    }

    next();
  };
};

module.exports = validate;
