require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");

// Models
const User = require("./models/User");
const FriendRequest = require("./models/FriendRequest");
const Message = require("./models/Message");

// Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const friendRoutes = require("./routes/friendRoutes");

// Middleware
const auth = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", auth, friendRoutes);

// ========== GLOBAL ERROR HANDLER ==========
// Catches JSON parse errors, unhandled rejections, and other middleware errors
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);

  if (err.type === "entity.parse.failed") {
    // Malformed JSON body
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  if (err.name === "SyntaxError") {
    return res.status(400).json({ error: "Invalid request format" });
  }

  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// ============ SOCKET.IO REAL-TIME LOGIC ============
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.userId;
  console.log(`🟢 User ${userId} connected`);

  // 1. Register online user
  onlineUsers.set(userId, socket.id);
  userSockets.set(socket.id, userId);
  User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: Date.now() }).then(
    () => {
      io.emit("online-users", Array.from(onlineUsers.keys()));
    },
  );

  // 2. Handle private text messages
  socket.on("send-message", async (data) => {
    try {
      const { recipientId, content } = data;
      const sender = await User.findById(userId);
      const recipient = await User.findById(recipientId);
      if (!recipient) return;

      const message = new Message({
        sender: userId,
        recipient: recipientId,
        content,
        timestamp: new Date(),
      });
      await message.save();

      const payload = {
        id: message._id,
        senderId: userId,
        senderUsername: sender.username,
        content,
        timestamp: message.timestamp,
      };

      // Emit to recipient if online
      const recipientSocketId = onlineUsers.get(recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("receive-message", payload);
      }
      // Acknowledge sender
      socket.emit("message-sent", payload);
    } catch (err) {
      socket.emit("error", "Failed to send message");
    }
  });

  // 3. Fetch chat history
  socket.on("fetch-history", async (friendId) => {
    try {
      const messages = await Message.find({
        $or: [
          { sender: userId, recipient: friendId },
          { sender: friendId, recipient: userId },
        ],
      })
        .sort({ timestamp: 1 })
        .limit(50);
      socket.emit("history-data", messages);
    } catch (err) {
      socket.emit("error", "Cannot fetch history");
    }
  });

  // ============ WEBRTC SIGNALING (Voice Chat) ============
  socket.on("call-user", (data) => {
    const { targetUserId, offer } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("incoming-call", {
        from: userId,
        offer,
      });
    }
  });

  socket.on("answer-call", (data) => {
    const { targetUserId, answer } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call-answered", { answer });
    }
  });

  socket.on("ice-candidate", (data) => {
    const { targetUserId, candidate } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("ice-candidate", { candidate });
    }
  });

  socket.on("end-call", (data) => {
    const { targetUserId } = data;
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call-ended");
    }
  });

  // 4. Handle disconnect
  socket.on("disconnect", async () => {
    console.log(`🔴 User ${userId} disconnected`);
    onlineUsers.delete(userId);
    userSockets.delete(socket.id);
    await User.findByIdAndUpdate(userId, {
      isOnline: false,
      lastSeen: Date.now(),
    });
    io.emit("online-users", Array.from(onlineUsers.keys()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`),
);
