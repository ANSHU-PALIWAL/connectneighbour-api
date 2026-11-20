const express = require("express");
const mongoose = require("mongoose");
const Event = require("../models/event");
const { userAuth } = require("../middlewares/auth");
const { getValidDistance } = require("../utils/constants");

const eventRouter = express.Router();

// 1. Create a local event
eventRouter.post("/event", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { title, description, eventType, date, lat, lng } = req.body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 150 ||
      typeof description !== "string" ||
      !description.trim() ||
      description.length > 2000 ||
      !date ||
      lat === undefined ||
      lng === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Title (up to 150 chars), description (up to 2000 chars), date, and coordinates are required.",
      });
    }

    if (eventType !== undefined && (typeof eventType !== "string" || eventType.length > 50)) {
      return res.status(400).json({
        success: false,
        message: "Event type must be a valid string up to 50 characters.",
      });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "A valid date format is required.",
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    if (
      isNaN(latitude) ||
      isNaN(longitude) ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({ success: false, message: "Invalid latitude or longitude." });
    }

    const newEvent = new Event({
      creatorId: loggedInUser._id,
      title: title.trim(),
      description: description.trim(),
      eventType: eventType ? eventType.trim() : "Other",
      date: parsedDate,
      location: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      rsvpList: [loggedInUser._id], // Creator is automatically RSVP'd
    });

    await newEvent.save();

    res.json({ success: true, message: "Event created successfully.", data: newEvent });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Fetch nearby events
eventRouter.get("/events/nearby", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (
      !loggedInUser.location ||
      !loggedInUser.location.coordinates ||
      loggedInUser.location.coordinates[0] === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Location is required to find local events.",
      });
    }

    const [lng, lat] = loggedInUser.location.coordinates;
    const maxDistance = getValidDistance(req.query.distance); // Universal 150 km radius limit (clamped)

    const nearbyEvents = await Event.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distance",
          maxDistance: maxDistance,
          spherical: true,
          // Only show future events
          query: {
            date: { $gte: new Date() }
          }
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "creatorId",
          foreignField: "_id",
          as: "creator",
        }
      },
      {
        $unwind: "$creator"
      },
      {
        $project: {
          title: 1,
          description: 1,
          eventType: 1,
          date: 1,
          location: 1,
          distance: 1,
          rsvpList: 1,
          "creator.firstName": 1,
          "creator.lastName": 1,
          "creator.photoUrl": 1,
          "creator._id": 1,
        }
      },
      { $limit: 100 }
    ]);

    res.json({
      success: true,
      message: "Events Fetched Successfully",
      data: nearbyEvents,
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. RSVP to an event
eventRouter.post("/event/:eventId/rsvp", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    // Toggle RSVP safely using string comparisons
    const isRSVPd = event.rsvpList.some(
      (id) => id.toString() === loggedInUser._id.toString()
    );
    
    if (isRSVPd) {
      event.rsvpList = event.rsvpList.filter(
        (id) => id.toString() !== loggedInUser._id.toString()
      );
    } else {
      event.rsvpList.push(loggedInUser._id);
    }

    await event.save();

    res.json({ 
      success: true, 
      message: isRSVPd ? "RSVP cancelled." : "RSVP successful.",
      isRSVPd: !isRSVPd
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = eventRouter;
