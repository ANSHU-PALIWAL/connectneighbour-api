const validator = require("validator");

const validateSignUpData = (req) => {
  const { firstName, lastName, emailId, password } = req.body;

  if (
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    !firstName.trim() ||
    !lastName.trim()
  ) {
    throw new Error("Please provide valid first and last name strings.");
  } else if (
    typeof emailId !== "string" ||
    !validator.isEmail(emailId.trim())
  ) {
    throw new Error("Please enter a valid email address.");
  } else if (
    typeof password !== "string" ||
    !validator.isStrongPassword(password)
  ) {
    throw new Error(
      "Please use a stronger password (include uppercase, numbers, and symbols).",
    );
  }
};

const validateEditProfileData = (req) => {
  const allowedEditFields = [
    "firstName",
    "lastName",
    "photoUrl",
    "gallery",
    "mobileNumber",
    "location", // 🌍 Allow location updates
    "gender",
    "age",
    "about",
    "skills",
  ];

  for (const field of Object.keys(req.body)) {
    if (!allowedEditFields.includes(field)) {
      throw new Error(`Field '${field}' is not editable.`);
    }
  }

  const {
    firstName,
    lastName,
    photoUrl,
    gallery,
    mobileNumber,
    location,
    gender,
    age,
    about,
    skills,
  } = req.body;

  if (firstName !== undefined) {
    if (typeof firstName !== "string" || firstName.trim().length === 0) {
      throw new Error("First name must be a valid non-empty text string.");
    }
    req.body.firstName = firstName.trim();
  }

  if (lastName !== undefined) {
    if (typeof lastName !== "string" || lastName.trim().length === 0) {
      throw new Error("Last name must be a valid non-empty text string.");
    }
    req.body.lastName = lastName.trim();
  }

  if (photoUrl !== undefined && typeof photoUrl !== "string") {
    throw new Error("Photo URL must be a valid string.");
  }

  if (gallery !== undefined) {
    if (!Array.isArray(gallery) || !gallery.every((item) => typeof item === "string")) {
      throw new Error("Gallery must be an array of image strings.");
    }
    if (gallery.length > 6) {
      throw new Error("Gallery cannot exceed 6 images.");
    }
  }

  if (mobileNumber !== undefined && typeof mobileNumber !== "string") {
    throw new Error("Mobile number must be a valid string.");
  }

  if (gender !== undefined && typeof gender !== "string") {
    throw new Error("Gender must be a valid string.");
  }

  if (about !== undefined && typeof about !== "string") {
    throw new Error("About text must be a valid string.");
  }

  if (age !== undefined && age !== null && age !== "") {
    const parsedAge = typeof age === "number" ? age : Number(age);
    if (isNaN(parsedAge) || !Number.isFinite(parsedAge) || parsedAge < 13 || parsedAge > 120) {
      throw new Error("Age must be a valid number between 13 and 120.");
    }
    req.body.age = parsedAge;
  } else if (age === "" || age === null) {
    delete req.body.age;
  }

  if (skills !== undefined) {
    if (typeof skills === "string") {
      req.body.skills = skills.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(skills)) {
      if (!skills.every((s) => typeof s === "string")) {
        throw new Error("Skills list must contain only text strings.");
      }
    } else {
      throw new Error("Skills must be a list of text strings or comma-separated text.");
    }
  }

  if (location !== undefined) {
    if (typeof location !== "object" || location === null) {
      throw new Error("Location must be a valid GeoJSON object.");
    }
  }

  return true;
};

module.exports = {
  validateSignUpData,
  validateEditProfileData,
};
