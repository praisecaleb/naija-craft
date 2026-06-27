const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

// Get all users (for "Who's Online" & search)
router.get('/all', auth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } })
      .select('-password -__v');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -__v');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile (bio, state, avatar, etc.)
router.put('/me', auth, async (req, res) => {
  try {
    const { bio, state, avatar, favoriteServer } = req.body;
    const user = await User.findByIdAndUpdate(
      req.userId,
      { bio, state, avatar, favoriteServer },
      { new: true, runValidators: true }
    ).select('-password -__v');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;