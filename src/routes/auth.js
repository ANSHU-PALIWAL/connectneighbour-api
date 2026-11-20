const bcrypt = require("bcrypt");
const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/user");
const { validateSignUpData } = require("../utils/validation");
const { OAuth2Client } = require("google-auth-library");
const sendEmail = require("../utils/sendEmail");

const authRouter = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts from this IP. Please try again after 15 minutes.",
  },
});

authRouter.post("/signup", authLimiter, async (req, res) => {
  try {
    validateSignUpData(req);

    const { firstName, lastName, emailId, password } = req.body;

    if (
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof emailId !== "string" ||
      typeof password !== "string"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid input types." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      emailId: emailId.trim().toLowerCase(),
      password: passwordHash,
    });

    let savedUser = await user.save();

    // 🚀 SEND WELCOME EMAIL (Manual Signup)
    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
          <h1 style="color: #00B171;">Welcome to ConnectNeighbour! 🎉</h1>
          <p style="font-size: 16px; color: #333;">Hi ${firstName},</p>
          <p style="font-size: 16px; color: #333;">We are thrilled to have you in the neighborhood. Start discovering locals, sharing skills, and building your community today.</p>
          <br>
          <p style="font-size: 14px; color: #777;">- The ConnectNeighbour Team</p>
        </div>
      `;
      await sendEmail.run(
        emailId,
        "Welcome to ConnectNeighbour! 🎉",
        emailHtml,
      );
    } catch (emailErr) {
      console.error("Welcome email failed to send:", emailErr);
    }

    const token = await savedUser.getJWT();
    const userObject = savedUser.toObject();
    delete userObject.password;
    delete userObject.tokenVersion;

    res.cookie("token", token, getCookieOptions());

    return res.json({
      success: true,
      message: "User Created Successfully 🎉",
      data: userObject,
    });
  } catch (err) {
    let errorMessage = err.message;
    if (err.code === 11000) {
      errorMessage = "A user with this email address already exists.";
    } else if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)[0].message;
    }
    return res.status(400).json({ success: false, message: errorMessage });
  }
});

authRouter.post("/login", authLimiter, async (req, res) => {
  try {
    const { emailId, password } = req.body;

    if (
      typeof emailId !== "string" ||
      typeof password !== "string" ||
      !emailId.trim() ||
      !password
    ) {
      throw new Error("Email and Password are required.");
    }

    const user = await User.findOne({ emailId: emailId.trim().toLowerCase() });

    if (!user) {
      throw new Error("Invalid credentials.");
    }

    if (!user.password) {
      throw new Error(
        "You created your account via Google. Please log in using the Google button above.",
      );
    }

    const isPasswordValid = await user.validatePassword(password);

    if (isPasswordValid) {
      const token = await user.getJWT();

      res.cookie("token", token, getCookieOptions());

      const userObject = user.toObject();
      delete userObject.password;
      delete userObject.tokenVersion;

      return res.json({
        success: true,
        message: "Login Successful",
        data: userObject,
      });
    } else {
      throw new Error("Invalid credentials.");
    }
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

authRouter.post("/auth/google", authLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid Google ID token is required.",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    let user = await User.findOne({ emailId: payload.email });

    if (!user) {
      user = new User({
        firstName: payload.given_name,
        lastName: payload.family_name,
        emailId: payload.email,
        photoUrl:
          (payload.picture && payload.picture.replace("=s96-c", "=s800-c")) ||
          "https://img.freepik.com/free-vector/blue-circle-with-white-user_78370-4707.jpg",
      });
      await user.save();

      // 🚀 SEND WELCOME EMAIL (Google Auth - New User Only)
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
            <h1 style="color: #00B171;">Welcome to ConnectNeighbour! 🎉</h1>
            <p style="font-size: 16px; color: #333;">Hi ${payload.given_name},</p>
            <p style="font-size: 16px; color: #333;">We are thrilled to have you in the neighborhood. Start discovering locals, sharing skills, and building your community today.</p>
            <br>
            <p style="font-size: 14px; color: #777;">- The ConnectNeighbour Team</p>
          </div>
        `;
        await sendEmail.run(
          payload.email,
          "Welcome to ConnectNeighbour! 🎉",
          emailHtml,
        );
      } catch (emailErr) {
        console.error("Welcome email failed to send:", emailErr);
      }
    } else {
      if (
        payload.picture &&
        (!user.photoUrl || user.photoUrl.includes("freepik.com") || user.photoUrl.includes("=s96-c"))
      ) {
        user.photoUrl = payload.picture.replace("=s96-c", "=s800-c");
        await user.save();
      }
    }

    const jwtToken = await user.getJWT();

    res.cookie("token", jwtToken, getCookieOptions());

    const userObject = user.toObject();
    delete userObject.password;
    delete userObject.tokenVersion;

    return res.json({
      success: true,
      message: "Google Login Successful",
      data: userObject,
    });
  } catch (error) {
    console.error("Google Auth Error:", error);
    return res.status(400).json({
      success: false,
      message: "Google authentication failed. Please try again.",
    });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY, {
          ignoreExpiration: true,
        });
        if (decoded && decoded._id) {
          await User.findByIdAndUpdate(decoded._id, {
            $inc: { tokenVersion: 1 },
          });
        }
      } catch (tokenErr) {
        // Token might be malformed or unverified; proceed to clear cookie safely
      }
    }

    res.cookie("token", null, {
      ...getCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });

    return res.json({
      success: true,
      message: "Logout Successful 🎉",
    });
  } catch (err) {
    // Fail gracefully: ensure cookie is cleared regardless
    try {
      res.cookie("token", null, {
        ...getCookieOptions(),
        maxAge: 0,
        expires: new Date(0),
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Logout Successful 🎉",
    });
  }
});

module.exports = authRouter;
