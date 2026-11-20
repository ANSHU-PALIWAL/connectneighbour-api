const express = require("express");
const bcrypt = require("bcrypt");
const validator = require("validator");
const rateLimit = require("express-rate-limit");
const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData } = require("../utils/validation");

const profileRouter = express.Router();

const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many location updates. Please slow down.",
  },
});

// Get Profile Api
profileRouter.get("/profile/view", userAuth, async (req, res) => {
  try {
    const user = req.user;
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.tokenVersion;
    res.json(userObj);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Edit Profile Api (supports up to 10mb for base64 photo/gallery uploads configured in app.js)
profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    validateEditProfileData(req);

    const loggedInUser = req.user;

    const allowedFields = [
      "firstName",
      "lastName",
      "photoUrl",
      "gallery",
      "mobileNumber",
      "location",
      "gender",
      "age",
      "about",
      "skills",
    ];

    allowedFields.forEach((key) => {
      if (req.body[key] !== undefined) {
        loggedInUser[key] = req.body[key];
      }
    });

    await loggedInUser.save();

    const userObj = loggedInUser.toObject();
    delete userObj.password;
    delete userObj.tokenVersion;

    res.json({
      success: true,
      message: `${loggedInUser.firstName}, Your Profile Has Been Updated Successfully`,
      data: userObj,
    });
  } catch (err) {
    let errorMessage = err.message;

    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)[0].message;
    }

    res.status(400).json({ success: false, message: errorMessage });
  }
});

// UPDATE PASSWORD API
profileRouter.patch("/profile/password", userAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const loggedInUser = req.user;

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      throw new Error("Current and new passwords are required as valid strings.");
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      loggedInUser.password,
    );
    if (!isPasswordValid) {
      throw new Error("Incorrect current password.");
    }

    if (!newPassword || !validator.isStrongPassword(newPassword)) {
      throw new Error(
        "Please enter a stronger new password (use uppercase, numbers, and symbols).",
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    loggedInUser.password = passwordHash;
    await loggedInUser.save();

    res.json({ success: true, message: "Password updated successfully!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 🌍 SILENT LOCATION UPDATE API (with coordinate bounds validation and rate limiting)
profileRouter.patch("/profile/location", userAuth, locationLimiter, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const loggedInUser = req.user;

    if (lat === undefined || lng === undefined) {
      throw new Error("Latitude and longitude are required.");
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (
      isNaN(parsedLat) ||
      isNaN(parsedLng) ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates: Latitude must be between -90 and 90, Longitude between -180 and 180.",
      });
    }

    // Format for MongoDB GeoJSON (Longitude always comes first!)
    loggedInUser.location = {
      type: "Point",
      coordinates: [parsedLng, parsedLat],
    };

    await loggedInUser.save();

    const userObj = loggedInUser.toObject();
    delete userObj.password;
    delete userObj.tokenVersion;

    res.json({ success: true, message: "Location updated successfully.", data: userObj });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

profileRouter.post("/profile/push/subscribe", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const subscription = req.body;

    if (
      !subscription ||
      typeof subscription !== "object" ||
      typeof subscription.endpoint !== "string"
    ) {
      return res.status(400).json({ success: false, message: "Invalid push subscription object." });
    }

    // Save subscription if it doesn't already exist
    const exists = loggedInUser.pushSubscriptions.some(
      (sub) => sub.endpoint === subscription.endpoint
    );

    if (!exists) {
      loggedInUser.pushSubscriptions.push(subscription);
      await loggedInUser.save();
    }

    res.status(201).json({ success: true, message: "Subscribed to push notifications." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE ACCOUNT API
profileRouter.delete("/profile/delete", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    await User.findByIdAndDelete(loggedInUser._id);
    res.cookie("token", null, { expires: new Date(Date.now()) });
    res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPGRADE TO BUSINESS PROFILE API
profileRouter.post("/profile/business/upgrade", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { businessName, businessCategory, businessAddress } = req.body;

    if (
      !businessName ||
      !businessCategory ||
      typeof businessName !== "string" ||
      typeof businessCategory !== "string" ||
      !businessName.trim() ||
      !businessCategory.trim()
    ) {
      return res.status(400).json({ success: false, message: "Business name and category must be valid non-empty strings." });
    }

    if (businessAddress !== undefined && typeof businessAddress !== "string") {
      return res.status(400).json({ success: false, message: "Business address must be a valid string." });
    }

    if (loggedInUser.isBusiness) {
      return res.status(400).json({ success: false, message: "You already have an active Business Profile." });
    }

    loggedInUser.isBusiness = true;
    loggedInUser.businessName = businessName.trim();
    loggedInUser.businessCategory = businessCategory.trim();
    loggedInUser.businessAddress = businessAddress ? businessAddress.trim() : "";

    await loggedInUser.save();

    const userObj = loggedInUser.toObject();
    delete userObj.password;
    delete userObj.tokenVersion;

    res.json({ success: true, message: "Successfully upgraded to Business Profile!", data: userObj });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = profileRouter;
