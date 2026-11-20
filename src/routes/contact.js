const express = require("express");
const validator = require("validator");
const rateLimit = require("express-rate-limit");
const Contact = require("../models/contact");
const sendEmail = require("../utils/sendEmail");

const contactRouter = express.Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many contact requests from this IP. Please try again after an hour.",
  },
});

contactRouter.post("/contact", contactLimiter, async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    // Strict type and existence validation
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof subject !== "string" ||
      typeof message !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !subject.trim() ||
      !message.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields (name, email, subject, message) are required as valid strings.",
      });
    }

    if (!validator.isEmail(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (name.trim().length > 100 || subject.trim().length > 200 || message.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Input length exceeds allowed limits.",
      });
    }

    if (message.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Message must be at least 10 characters long.",
      });
    }

    // Save to database
    const contactQuery = new Contact({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      subject: subject.trim(),
      message: message.trim(),
    });
    await contactQuery.save();

    // Escape user input before HTML template insertion
    const safeName = validator.escape(String(name).trim());
    const safeSubject = validator.escape(String(subject).trim());
    const safeMessage = validator.escape(String(message).trim());

    // Send acknowledgement email to the user safely
    try {
      const emailHtml = `
        <div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: auto; padding: 30px; background: #f8fafc; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: #10b981; padding: 12px 16px; border-radius: 12px;">
              <span style="color: white; font-weight: 900; font-size: 20px; letter-spacing: -0.5px;">ConnectNeighbour</span>
            </div>
          </div>
          <div style="background: white; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
            <h2 style="color: #0f172a; font-size: 22px; margin-bottom: 8px;">We received your message! 📬</h2>
            <p style="color: #64748b; font-size: 15px; line-height: 1.7; margin-bottom: 20px;">
              Hi <strong style="color: #0f172a;">${safeName}</strong>,<br/>
              Thank you for reaching out. We've received your query and our team will get back to you within <strong>24–48 hours</strong>.
            </p>
            <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
              <p style="color: #475569; font-size: 13px; margin: 0 0 6px 0; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Your Message</p>
              <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0;"><strong>Subject:</strong> ${safeSubject}</p>
              <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 8px 0 0 0;">${safeMessage}</p>
            </div>
            <p style="color: #64748b; font-size: 14px; margin: 0;">
              While you wait, feel free to explore the app and connect with your neighbors!
            </p>
          </div>
          <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">
            © ${new Date().getFullYear()} ConnectNeighbour. Built with ❤️ for neighborhoods.
          </p>
        </div>
      `;

      if (sendEmail && typeof sendEmail.run === "function") {
        await sendEmail.run(
          email.trim().toLowerCase(),
          `We got your message — "${safeSubject}" | ConnectNeighbour`,
          emailHtml,
        );
      }
    } catch (emailErr) {
      // Don't fail the whole request if email sending fails or SES credentials are unconfigured
      console.warn("Contact ack email not sent (SES may be unconfigured/disabled):", emailErr.message);
    }

    return res.status(201).json({
      success: true,
      message:
        "Your query has been received. We'll get back to you at " +
        email +
        " within 24–48 hours.",
    });
  } catch (err) {
    let errorMessage = err.message;
    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)[0].message;
    }
    return res.status(400).json({ success: false, message: errorMessage });
  }
});

module.exports = contactRouter;
