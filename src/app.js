const express = require("express");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/database");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
require("dotenv").config();

const app = express();

// Trust proxy for rate limiting and secure cookies behind Cloudflare / Nginx
app.set("trust proxy", 1);

// Automatic Gzip response compression for JSON/text responses
app.use(compression());

// HTTP Security Headers via Helmet & disable x-powered-by
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.disable("x-powered-by");

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// Targeted 10mb body parser specifically for routes that accept base64 image/gallery uploads.
// All other routes remain strictly locked at 1mb to mitigate payload flooding.
const json10mb = express.json({ limit: "10mb" });
const urlencoded10mb = express.urlencoded({ limit: "10mb", extended: true });
const json1mb = express.json({ limit: "1mb" });
const urlencoded1mb = express.urlencoded({ limit: "1mb", extended: true });

const highLimitEndpoints = ["/profile/edit"];

app.use((req, res, next) => {
  const isHighLimit = highLimitEndpoints.some((endpoint) =>
    req.path.startsWith(endpoint),
  );
  if (isHighLimit) {
    return json10mb(req, res, (err) => {
      if (err) return next(err);
      urlencoded10mb(req, res, next);
    });
  }
  return json1mb(req, res, (err) => {
    if (err) return next(err);
    urlencoded1mb(req, res, next);
  });
});

app.use(cookieParser());

// Safe in-place NoSQL injection and prototype pollution sanitizer
const sanitizeInput = (target) => {
  if (!target || typeof target !== "object") return;
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      if (target[i] && typeof target[i] === "object") {
        sanitizeInput(target[i]);
      }
    }
    return;
  }
  for (const key of Object.keys(target)) {
    if (
      key.startsWith("$") ||
      key.includes(".") ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      delete target[key];
    } else if (target[key] && typeof target[key] === "object") {
      sanitizeInput(target[key]);
    }
  }
};

app.use((req, res, next) => {
  if (req.body) sanitizeInput(req.body);
  if (req.params) sanitizeInput(req.params);
  if (req.query) sanitizeInput(req.query);
  next();
});

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");
const contactRouter = require("./routes/contact");
const chatRouter = require("./routes/chat");
const safetyRouter = require("./routes/safety");
const eventRouter = require("./routes/event");
const groupRouter = require("./routes/group");

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", requestRouter);
app.use("/", userRouter);
app.use("/", contactRouter);
app.use("/", chatRouter);
app.use("/", safetyRouter);
app.use("/", eventRouter);
app.use("/", groupRouter);

// Global Error Handler for CastErrors, PayloadTooLarge, etc.
app.use((err, req, res, next) => {
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: `Invalid ID format for field '${err.path}'`,
    });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Payload too large. Please upload smaller files or images.",
    });
  }
  console.error("Unhandled error:", err);
  const isProd = process.env.NODE_ENV === "production";
  return res.status(err.status || 500).json({
    success: false,
    message: isProd ? "Internal Server Error" : (err.message || "Internal Server Error"),
  });
});

const { createServer } = require("http");
const { initializeSocket } = require("./utils/socket");

// Wrap app with http server
const server = createServer(app);
initializeSocket(server);

// DataBase Connection and Server Start
connectDB()
  .then(() => {
    server.listen(process.env.PORT, () => {
      console.log(
        "Server is successfully listening on port " + process.env.PORT,
      );
    });
  })
  .catch((err) => {
    console.error("Error connecting to the database: " + err.message);
  });

