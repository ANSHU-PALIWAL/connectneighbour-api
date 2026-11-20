const express = require("express");
const mongoose = require("mongoose");
const Group = require("../models/group");
const GroupMessage = require("../models/groupMessage");
const { userAuth } = require("../middlewares/auth");
const { sendPushNotification } = require("../utils/push");
const { getValidDistance } = require("../utils/constants");

const groupRouter = express.Router();

// Create a new group
groupRouter.post("/group", userAuth, async (req, res) => {
  try {
    const { name, description, lat, lng } = req.body;
    const loggedInUser = req.user;

    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 100 ||
      lat === undefined ||
      lng === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid group name (up to 100 characters) and coordinates are required.",
      });
    }

    if (description !== undefined && (typeof description !== "string" || description.length > 1000)) {
      return res.status(400).json({
        success: false,
        message: "Description must be a valid string up to 1000 characters.",
      });
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
      return res.status(400).json({ success: false, message: "Invalid coordinates format." });
    }

    const group = new Group({
      name: name.trim(),
      description: description ? description.trim() : "",
      creatorId: loggedInUser._id,
      members: [loggedInUser._id],
      location: {
        type: "Point",
        coordinates: [parsedLng, parsedLat],
      },
    });

    await group.save();
    await group.populate("creatorId", "firstName lastName photoUrl");

    res.status(201).json({ success: true, message: "Group created successfully", data: group });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get nearby groups
groupRouter.get("/groups/nearby", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser.location || !loggedInUser.location.coordinates || loggedInUser.location.coordinates[0] === 0) {
      return res.status(400).json({ success: false, message: "Location is required" });
    }

    const [lng, lat] = loggedInUser.location.coordinates;
    const maxDistance = getValidDistance(req.query.distance);

    const groups = await Group.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distance",
          maxDistance: maxDistance,
          spherical: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "creatorId",
          foreignField: "_id",
          as: "creator",
        },
      },
      { $unwind: "$creator" },
      {
        $project: {
          name: 1,
          description: 1,
          members: 1,
          location: 1,
          distance: 1,
          "creator.firstName": 1,
          "creator.lastName": 1,
          "creator.photoUrl": 1,
        },
      },
      { $limit: 50 },
    ]);

    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single group details
groupRouter.get("/group/:groupId", userAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid Group ID format." });
    }

    const group = await Group.findById(groupId).populate("creatorId", "firstName lastName photoUrl");
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    res.json({ success: true, data: group });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Join a group
groupRouter.post("/group/:groupId/join", userAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const loggedInUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid Group ID format." });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    const isAlreadyMember = group.members.some(
      (m) => m.toString() === loggedInUser._id.toString()
    );

    if (!isAlreadyMember) {
      group.members.push(loggedInUser._id);
      await group.save();
    }

    await group.populate("creatorId", "firstName lastName photoUrl");

    res.json({ success: true, message: "Joined group successfully", data: group });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get group messages
groupRouter.get("/group/:groupId/messages", userAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const loggedInUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid Group ID format." });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: "Group not found" });

    const isMember = group.members.some(
      (m) => m.toString() === loggedInUser._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({ success: false, message: "You are not a member of this group" });
    }

    const messages = await GroupMessage.find({ groupId })
      .populate("senderId", "firstName lastName photoUrl")
      .sort({ createdAt: 1 });

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get groups user belongs to
groupRouter.get("/user/groups", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    
    const groups = await Group.find({ members: loggedInUser._id })
      .populate("creatorId", "firstName photoUrl")
      .sort({ updatedAt: -1 });

    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = groupRouter;
