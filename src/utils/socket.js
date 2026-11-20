const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const mongoose = require("mongoose");
const Message = require("../models/message");
const GroupMessage = require("../models/groupMessage");
const Group = require("../models/group");
const User = require("../models/user");
const ConnectionRequest = require("../models/connectionRequest");
const Block = require("../models/block");
const { sendPushNotification } = require("./push");

const initializeSocket = (server) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:5173"];

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const token = cookies.token;
      
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decodedObj = await jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decodedObj._id);

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      const currentTokenVersion = user.tokenVersion ?? 0;
      const jwtVersion = decodedObj.tokenVersion ?? 0;
      if (jwtVersion !== currentTokenVersion) {
        return next(new Error("Authentication error: Session revoked"));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Authentication error: " + err.message));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user._id.toString();
    
    // Join a room unique to this user to receive private messages/calls
    socket.join(userId);

    // Handle sending a text message
    socket.on("sendMessage", async ({ receiverId, receiverEncryptedData, senderEncryptedData }, callback) => {
      try {
        if (!receiverId || typeof receiverId !== "string" || !mongoose.Types.ObjectId.isValid(receiverId)) {
          if (callback) callback({ status: "error", message: "Invalid receiver ID format." });
          return;
        }

        if (typeof receiverEncryptedData !== "string" || receiverEncryptedData.length === 0 || receiverEncryptedData.length > 15000000) {
          if (callback) callback({ status: "error", message: "Invalid receiver encrypted payload." });
          return;
        }

        if (typeof senderEncryptedData !== "string" || senderEncryptedData.length === 0 || senderEncryptedData.length > 15000000) {
          if (callback) callback({ status: "error", message: "Invalid sender encrypted payload." });
          return;
        }

        // 1. Verify connection exists and is accepted
        const connection = await ConnectionRequest.findOne({
          $or: [
            { fromUserId: userId, toUserId: receiverId, status: "accepted" },
            { fromUserId: receiverId, toUserId: userId, status: "accepted" },
          ],
        });

        if (!connection) {
          if (callback) callback({ status: "error", message: "Not connected with this user." });
          return;
        }

        // Verify neither user has blocked the other
        const isBlocked = await Block.findOne({
          $or: [
            { blockerId: userId, blockedId: receiverId },
            { blockerId: receiverId, blockedId: userId },
          ],
        });

        if (isBlocked) {
          if (callback) callback({ status: "error", message: "Cannot send message to this user." });
          return;
        }

        // 2. Save message to database
        const message = new Message({
          senderId: userId,
          receiverId: receiverId,
          receiverEncryptedData,
          senderEncryptedData,
        });
        await message.save();

        // 3. Emit message to the receiver if they are online
        io.to(receiverId).emit("receiveMessage", {
          _id: message._id,
          senderId: userId,
          receiverId: receiverId,
          receiverEncryptedData,
          createdAt: message.createdAt,
        });

        // Send push notification to receiver
        const sender = await User.findById(userId).select("firstName photoUrl");
        sendPushNotification(receiverId, {
          title: `New Message from ${sender.firstName}`,
          body: "You received a new end-to-end encrypted message.",
          icon: sender.photoUrl || "/Logo500.png",
          url: `/chat/${userId}`
        });

        if (callback) callback({ status: "success", message });

      } catch (err) {
        console.error("Socket error in sendMessage:", err);
        if (callback) callback({ status: "error", message: err.message });
      }
    });

    // Handle joining a group chat room
    socket.on("joinGroup", async ({ groupId }, callback) => {
      try {
        if (!groupId || typeof groupId !== "string" || !mongoose.Types.ObjectId.isValid(groupId)) {
          if (callback) callback({ status: "error", message: "Invalid Group ID format." });
          return;
        }

        const authenticatedUserId = socket.user._id.toString();
        const group = await Group.findById(groupId);
        if (group && group.members.some((m) => m.toString() === authenticatedUserId)) {
          socket.join(`group_${groupId}`);
          if (callback) callback({ status: "success" });
        } else {
          if (callback) callback({ status: "error", message: "Not authorized" });
        }
      } catch (err) {
        console.error("Socket error in joinGroup:", err);
        if (callback) callback({ status: "error", message: err.message });
      }
    });

    // Handle sending a group message
    socket.on("sendGroupMessage", async ({ groupId, text }, callback) => {
      try {
        if (!groupId || typeof groupId !== "string" || !mongoose.Types.ObjectId.isValid(groupId)) {
          if (callback) callback({ status: "error", message: "Invalid Group ID format." });
          return;
        }

        if (typeof text !== "string" || text.trim().length === 0 || text.length > 5000) {
          if (callback) callback({ status: "error", message: "Message text must be between 1 and 5000 characters." });
          return;
        }

        const authenticatedUserId = socket.user._id.toString();
        const group = await Group.findById(groupId);
        if (!group || !group.members.some((m) => m.toString() === authenticatedUserId)) {
          if (callback) callback({ status: "error", message: "Not authorized" });
          return;
        }

        const message = new GroupMessage({
          groupId,
          senderId: socket.user._id,
          text: text.trim(),
        });

        const savedMessage = await message.save();
        await savedMessage.populate("senderId", "firstName lastName photoUrl");

        // Broadcast to everyone in the room
        io.to(`group_${groupId}`).emit("receiveGroupMessage", savedMessage);

        if (callback) callback({ status: "success", message: savedMessage });
      } catch (err) {
        console.error("Socket error in sendGroupMessage:", err);
        if (callback) callback({ status: "error", message: err.message });
      }
    });

    // Handle WebRTC Signaling for P2P Calls/Media
    socket.on("webrtcSignal", async ({ to, signal }) => {
      try {
        if (!to || typeof to !== "string" || !mongoose.Types.ObjectId.isValid(to) || !signal || typeof signal !== "object") return;

        // Verify via DB that an "accepted" ConnectionRequest exists between socket.user._id and to
        const connection = await ConnectionRequest.findOne({
          $or: [
            { fromUserId: userId, toUserId: to, status: "accepted" },
            { fromUserId: to, toUserId: userId, status: "accepted" },
          ],
        });

        if (!connection) {
          // Drop unauthorized signals silently
          return;
        }

        // Verify neither user has blocked the other in Block
        const isBlocked = await Block.findOne({
          $or: [
            { blockerId: userId, blockedId: to },
            { blockerId: to, blockedId: userId },
          ],
        });

        if (isBlocked) {
          // Drop blocked signals silently
          return;
        }

        // Forward the WebRTC signal to the target user
        io.to(to).emit("webrtcSignal", {
          from: userId,
          signal,
        });
      } catch (err) {
        console.error("Socket error in webrtcSignal:", err);
      }
    });

    socket.on("disconnect", () => {
      // Socket automatically leaves rooms upon disconnect
    });
  });
};

module.exports = { initializeSocket };
