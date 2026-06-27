const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

// Register
router.post("/register", async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      minecraftIGN,
      edition,
      favoriteServer,
      state,
    } = req.body;

    // Basic validation before hitting the database
    if (!username || !email || !password || !minecraftIGN || !edition) {
      return res
        .status(400)
        .json({
          error:
            "Missing required fields: username, email, password, minecraftIGN, edition",
        });
    }

    // Validate edition enum
    if (!["Java", "Bedrock", "PE"].includes(edition)) {
      return res
        .status(400)
        .json({ error: 'Edition must be "Java", "Bedrock", or "PE"' });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const user = new User({
      username,
      email,
      password,
      minecraftIGN,
      edition,
      favoriteServer,
      state,
    });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res
      .status(201)
      .json({ token, user: { id: user._id, username, email, minecraftIGN } });
  } catch (err) {
    // Handle Mongoose validation errors specifically
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    // Handle duplicate key errors (race condition)
    if (err.code === 11000) {
      return res
        .status(400)
        .json({ error: "Username or email already exists" });
    }
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({
      token,
      user: {
        id: user._id,
        username,
        email: user.email,
        minecraftIGN: user.minecraftIGN,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

module.exports = router;
