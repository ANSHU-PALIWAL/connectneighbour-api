const jwt = require("jsonwebtoken");
const User = require("../models/user");

const userAuth = async (req, res, next) => {
  try {
    const { token } = req.cookies;

    if (!token) {
      // 🛡️ FIX: Standardized JSON response
      return res.status(401).json({
        success: false,
        message: "Please Login To Access This Resource",
      });
    }

    const decodedObj = await jwt.verify(token, process.env.JWT_SECRET_KEY);
    const { _id, tokenVersion: tokenVersionInJwt } = decodedObj;

    const user = await User.findById(_id);

    if (!user) {
      throw new Error("User Not Found");
    }

    const currentTokenVersion = user.tokenVersion ?? 0;
    const jwtVersion = tokenVersionInJwt ?? 0;

    if (jwtVersion !== currentTokenVersion) {
      throw new Error("Session has been revoked. Please login again.");
    }

    req.user = user;
    next();
  } catch (err) {
    // 🛡️ FIX: Always return 401 for Auth failures so the Frontend 'Bouncer' catches it!
    res.status(401).json({
      success: false,
      message: "Session expired or invalid. Please login again.",
    });
  }
};

module.exports = {
  userAuth,
};
