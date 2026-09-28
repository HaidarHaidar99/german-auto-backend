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
const adminUserRoutes    = require("./routes/adminUser.routes");
const notFound = require("./middleware/notFound.middleware");
const errorHandler = require("./middleware/error.middleware");
const { generalApiLimiter } = require("./middleware/rateLimit.middleware");
const { successResponse } = require("./utils/response.util");

const app = express();

// Trust reverse proxy (Vercel, Nginx, cloud load balancers) for secure cookies and https protocol
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  "https://german-auto-frontend.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Check allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow any Vercel preview or production deployment domain (*.vercel.app)
      try {
        const hostname = new URL(origin).hostname;
        if (hostname.endsWith(".vercel.app")) {
          return callback(null, true);
        }
      } catch {
        // invalid URL
      }

      // If in development, allow any origin
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
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
app.use("/api/admin/users",   adminUserRoutes);

// 404 & Centralized Error Handler
app.use(notFound);
app.use(errorHandler);

module.exports = app;