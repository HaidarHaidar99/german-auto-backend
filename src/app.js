const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const authRoutes         = require("./routes/auth.routes");
const carRoutes          = require("./routes/car.routes");
const formRoutes         = require("./routes/form.routes");
const reviewRoutes       = require("./routes/review.routes");
const notificationRoutes = require("./routes/notification.routes");
const settingsRoutes     = require("./routes/settings.routes");
const notFound = require("./middleware/notFound.middleware");
const errorHandler = require("./middleware/error.middleware");
const { generalApiLimiter } = require("./middleware/rateLimit.middleware");
const { successResponse } = require("./utils/response.util");

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Body and Cookie Parsers
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// General rate limiter on API endpoints
app.use("/api", generalApiLimiter);

// Health check endpoint
app.get("/", (req, res) => {
  return successResponse(res, {
    message: "German Auto Backend Running",
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
    },
  });
});

// Mount Routes
app.use("/api/auth",          authRoutes);
app.use("/api/cars",          carRoutes);
app.use("/api/forms",         formRoutes);
app.use("/api/reviews",       reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/settings",      settingsRoutes);

// 404 & Centralized Error Handler
app.use(notFound);
app.use(errorHandler);

module.exports = app;