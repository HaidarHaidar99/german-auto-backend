const express = require("express");
const path = require("path");
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

const url = require("url");

// Helper to generate protocol, www, unicode, and ASCII punycode variants
function buildOriginVariants(rawDomainOrUrl) {
  if (!rawDomainOrUrl) return [];
  try {
    const raw = String(rawDomainOrUrl).trim();
    const parsed = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    const asciiHost = url.domainToASCII ? url.domainToASCII(host) : host;
    const unicodeHost = url.domainToUnicode ? url.domainToUnicode(host) : host;

    const baseHosts = new Set([
      host,
      host.replace(/^www\./, ""),
      asciiHost,
      asciiHost.replace(/^www\./, ""),
      unicodeHost,
      unicodeHost.replace(/^www\./, ""),
    ]);

    const results = new Set();
    baseHosts.forEach((b) => {
      if (!b) return;
      results.add(`https://${b}`);
      results.add(`https://www.${b}`);
      results.add(`http://${b}`);
      results.add(`http://www.${b}`);
    });
    return Array.from(results);
  } catch {
    return [rawDomainOrUrl];
  }
}

// CORS configuration
const baseAllowed = [
  "https://german-auto-frontend.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  ...buildOriginVariants("königautomobilerheinberg.de"),
  ...buildOriginVariants("koenigautomobilerheinberg.de"),
  ...buildOriginVariants("xn--knigautomobilerheinberg-7kc.de"),
  ...(process.env.FRONTEND_URL ? buildOriginVariants(process.env.FRONTEND_URL) : []),
];

const allowedOrigins = Array.from(new Set(baseAllowed.filter(Boolean)));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Check allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Check hostname against allowed domain patterns
      try {
        const incomingUrl = new URL(origin);
        const incomingHost = incomingUrl.hostname.toLowerCase();
        const incomingAscii = url.domainToASCII ? url.domainToASCII(incomingHost) : incomingHost;

        if (
          incomingAscii === "xn--knigautomobilerheinberg-7kc.de" ||
          incomingAscii === "www.xn--knigautomobilerheinberg-7kc.de" ||
          incomingAscii === "koenigautomobilerheinberg.de" ||
          incomingAscii === "www.koenigautomobilerheinberg.de" ||
          incomingAscii.endsWith(".vercel.app")
        ) {
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

// Serve local uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// General rate limiter on API endpoints
app.use("/api", generalApiLimiter);

// Health check endpoints
app.get(["/", "/health", "/api/health"], (req, res) => {
  const sKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const aKey = process.env.SUPABASE_ANON_KEY || "";
  let keyType = "none";
  if (sKey) keyType = "service_role";
  else if (aKey) keyType = "anon";

  return successResponse(res, {
    message: "German Auto Backend Running",
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      frontend_url: process.env.FRONTEND_URL || "(not set)",
      configured_services: {
        supabase: Boolean(process.env.SUPABASE_URL && (sKey || aKey)),
        supabase_key_type: keyType,
        google_oauth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        resend_email: Boolean(process.env.RESEND_API_KEY),
        smtp_email: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
        jwt_secret: Boolean(process.env.JWT_SECRET),
      },
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