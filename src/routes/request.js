const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const User = require("../models/user");
const Block = require("../models/block");
const { userAuth } = require("../middlewares/auth");
const { sendPushNotification } = require("../utils/push");
const ConnectionRequest = require("../models/connectionRequest");

const requestRouter = express.Router();

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many connection requests sent. Please slow down.",
  },
});

// Sending Connection Request Api
requestRouter.post(
  "/request/send/:status/:toUserId",
  userAuth,
  requestLimiter,
  async (req, res) => {
    try {
      const fromUserId = req.user._id;
      const toUserId = req.params.toUserId;
      const status = req.params.status;

      // 🛡️ SECURITY FIX: Validate MongoDB ObjectId and string type
      if (!toUserId || typeof toUserId !== "string" || !mongoose.Types.ObjectId.isValid(toUserId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid User ID format." });
      }

      if (!status || typeof status !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Status format." });
      }

      // 🛡️ LOGIC FIX: Prevent user from sending request to themselves
      if (fromUserId.toString() === toUserId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot send a request to yourself!",
        });
      }

      // Check if blocked
      const isBlocked = await Block.findOne({
        $or: [
          { blockerId: fromUserId, blockedId: toUserId },
          { blockerId: toUserId, blockedId: fromUserId },
        ],
      });
      if (isBlocked) {
        return res.status(400).json({
          success: false,
          message: "Cannot send connection request to this user.",
        });
      }

      const allowedStatus = ["ignored", "interested"];
      if (!allowedStatus.includes(status)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Status Type: " + status });
      }

      const toUser = await User.findById(toUserId);
      if (!toUser) {
        return res
          .status(404)
          .json({ success: false, message: "User Not Found." });
      }

      // Check For the existing ConnectionRequest
      const existingConnectionRequest = await ConnectionRequest.findOne({
        $or: [
          { fromUserId, toUserId },
          { fromUserId: toUserId, toUserId: fromUserId },
        ],
      });

      if (existingConnectionRequest) {
        return res.status(400).json({
          success: false,
          message: "Connection Request Already Exists!",
        });
      }

      const connectionRequest = new ConnectionRequest({
        fromUserId,
        toUserId,
        status,
      });

      const data = await connectionRequest.save();

      res.json({
        success: true,
        message: "Connection Request: " + status,
        data,
      });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

requestRouter.post(
  "/request/review/:status/:requestId",
  userAuth,
  async (req, res) => {
    try {
      const loggedInUser = req.user;
      const { status, requestId } = req.params;

      // 🛡️ SECURITY FIX: Validate Request ID and Status type
      if (!requestId || typeof requestId !== "string" || !mongoose.Types.ObjectId.isValid(requestId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Request ID format." });
      }

      if (!status || typeof status !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Status format." });
      }

      const allowedStatus = ["accepted", "rejected"];
      if (!allowedStatus.includes(status)) {
        return res
          .status(400)
          .json({ success: false, message: "Status not Allowed." });
      }

      const connectionRequest = await ConnectionRequest.findOne({
        _id: requestId,
        toUserId: loggedInUser._id,
        status: "interested",
      });

      if (!connectionRequest) {
        return res
          .status(404)
          .json({ success: false, message: "Connection Request Not Found." });
      }

      connectionRequest.status = status;
      const data = await connectionRequest.save();

      res.json({
        success: true,
        message: "Connection Request: " + status,
        data,
      });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

module.exports = requestRouter;
