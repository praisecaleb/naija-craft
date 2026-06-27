const express = require('express');
const auth = require('../middleware/auth');
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const router = express.Router();

// Send friend request
router.post('/request', auth, async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (req.userId === recipientId) return res.status(400).json({ error: 'Cannot add yourself' });

    const existing = await FriendRequest.findOne({
      $or: [
        { sender: req.userId, recipient: recipientId },
        { sender: recipientId, recipient: req.userId }
      ],
      status: 'pending'
    });
    if (existing) return res.status(400).json({ error: 'Request already pending' });

    const request = new FriendRequest({ sender: req.userId, recipient: recipientId });
    await request.save();
    res.status(201).json({ message: 'Request sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept friend request
router.put('/accept/:requestId', auth, async (req, res) => {
  try {
    const request = await FriendRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.recipient.toString() !== req.userId) return res.status(403).json({ error: 'Forbidden' });

    request.status = 'accepted';
    await request.save();

    // Add to each other's friends list (optional: you can store friends array in User model if you want)
    // For simplicity, we'll just query accepted requests to get friends.
    res.json({ message: 'Friend added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends list
router.get('/list', auth, async (req, res) => {
  try {
    const accepted = await FriendRequest.find({
      $or: [{ sender: req.userId }, { recipient: req.userId }],
      status: 'accepted'
    }).populate('sender recipient', '-password -__v');

    const friends = accepted.map(req => {
      return req.sender._id.toString() === req.userId ? req.recipient : req.sender;
    });
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending requests (incoming)
router.get('/pending', auth, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.userId,
      status: 'pending'
    }).populate('sender', '-password -__v');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;