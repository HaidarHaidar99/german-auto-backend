const { errorResponse } = require("../utils/response.util");

const notFound = (req, res) => {
  return errorResponse(res, {
    statusCode: 404,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

module.exports = notFound;