// ===================================================================
// FRONTEND JAVASCRIPT - FULL CLIENT LOGIC
// ===================================================================
const API = window.location.origin + "/api";
let currentUser = null;
let currentToken = null;
let socket = null;
let currentChatFriend = null;
let onlineUsersMap = new Map(); // userId -> { username, ign, online }
let friendsList = [];
let pendingRequests = [];
let localStream = null;
let peerConnection = null;
let callTarget = null;
let isCaller = false;

// DOM refs
const $ = (id) => document.getElementById(id);
const authContainer = $("authContainer");
const appContainer = $("appContainer");
const authForm = $("authForm");
const authSubmitBtn = $("authSubmitBtn");
const authSwitch = $("authSwitch");
const authError = $("authError");
const logoutBtn = $("logoutBtn");

// Views
const views = document.querySelectorAll(".view");
const navBtns = document.querySelectorAll(".nav-btn");

// ========== AUTH ==========
let isLogin = false;
authSwitch.addEventListener("click", () => {
  isLogin = !isLogin;
  authSubmitBtn.textContent = isLogin ? "Login" : "Sign Up";
  authSwitch.textContent = isLogin
    ? "Don't have an account? Sign Up"
    : "Already have an account? Login";
  $("authEmail").style.display = isLogin ? "none" : "block";
  $("authIGN").style.display = isLogin ? "none" : "block";
  $("authEdition").style.display = isLogin ? "none" : "block";
  $("authState").style.display = isLogin ? "none" : "block";
  authError.textContent = "";
});
// Default: show signup fields
$("authEmail").style.display = "block";
$("authIGN").style.display = "block";
$("authEdition").style.display = "block";
$("authState").style.display = "block";

authSubmitBtn.addEventListener("click", async () => {
  const username = $("authUsername").value.trim();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value.trim();
  const ign = $("authIGN").value.trim();
  const edition = $("authEdition").value;
  const state = $("authState").value.trim();

  if (!username || !password)
    return (authError.textContent = "Username and password required");
  if (!isLogin && (!email || !ign || !state))
    return (authError.textContent = "Please fill all fields");

  const endpoint = isLogin ? "/auth/login" : "/auth/register";
  const body = isLogin
    ? { username, password }
    : { username, email, password, minecraftIGN: ign, edition, state };

  try {
    const res = await fetch(API + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Try to parse JSON safely — the server may return an empty or non-JSON response on error
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      const text = await res.text().catch(() => "");
      throw new Error(
        text || "Server returned an invalid response. Please try again.",
      );
    }

    if (!res.ok) throw new Error(data.error || "Auth failed");
    currentUser = data.user;
    currentToken = data.token;
    localStorage.setItem("token", currentToken);
    localStorage.setItem("user", JSON.stringify(currentUser));
    initApp();
  } catch (err) {
    authError.textContent = err.message;
  }
});

// Check token on load
(function checkAuth() {
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user"));
  if (token && user) {
    currentToken = token;
    currentUser = user;
    initApp();
  }
})();

// ========== APP INIT ==========
function initApp() {
  authContainer.style.display = "none";
  appContainer.style.display = "flex";
  $("dashUsername").textContent = currentUser.username;
  $("profileIGN").textContent = currentUser.minecraftIGN;
  connectSocket();
  fetchOnlineUsers();
  fetchFriends();
  fetchPendingRequests();
  loadProfile();
  setupNavigation();
}

function connectSocket() {
  socket = io(window.location.origin, { auth: { token: currentToken } });

  socket.on("connect", () => console.log("Socket connected"));
  socket.on("online-users", (ids) => {
    // We'll fetch fresh user data to get details
    fetchOnlineUsers();
  });

  socket.on("receive-message", (msg) => {
    appendMessage(msg, false);
    // Update UI if chat is open with that person
  });

  socket.on("message-sent", (msg) => {
    // optional
  });

  socket.on("incoming-call", async (data) => {
    if (confirm(`📞 Incoming call from ${data.from}?`)) {
      callTarget = data.from;
      isCaller = false;
      await startCall(true, data.offer);
    } else {
      // send rejection? we just ignore
    }
  });

  socket.on("call-answered", async (data) => {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.answer),
      );
      $("callStatus").textContent = "Connected";
    }
  });

  socket.on("ice-candidate", (data) => {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  });

  socket.on("call-ended", () => {
    endCall();
  });

  socket.on("error", (err) => console.error("Socket error:", err));
}

// ========== FETCH USERS ==========
async function fetchOnlineUsers() {
  try {
    const res = await fetch(API + "/users/all", {
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // We get all users, we need online status from socket
    // We'll merge with socket's online list
    // For now, render all with online status
    renderOnlineList(data);
  } catch (err) {
    console.error(err);
  }
}

function renderOnlineList(users) {
  const container = $("onlineList");
  container.innerHTML = "";
  const search = $("onlineSearch").value.toLowerCase();
  let count = 0;
  users.forEach((u) => {
    const isOnline = onlineUsersMap.has(u._id) || u.isOnline;
    if (isOnline) count++;
    const match =
      u.username.toLowerCase().includes(search) ||
      u.minecraftIGN.toLowerCase().includes(search);
    if (!match && search) return;
    const div = document.createElement("div");
    div.className = "user-item";
    div.innerHTML = `
  <div class="info">
    <span class="online-dot ${isOnline ? "online" : "offline"}"></span>
    <span class="name">${u.username}</span>
    <span class="ign">🎮 ${u.minecraftIGN}</span>
    ${u.state ? `<span class="text-muted">📍 ${u.state}</span>` : ""}
  </div>
  <div class="actions">
    <button onclick="sendFriendRequest('${u._id}')">➕ Add</button>
  </div>
`;
    container.appendChild(div);
  });
  $("onlineCount").textContent = count;
  $("dashOnlineCount").textContent = count;
}

// ========== FRIENDS ==========
async function fetchFriends() {
  try {
    const res = await fetch(API + "/friends/list", {
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    friendsList = data;
    renderFriends();
    renderChatFriends();
    $("dashFriendCount").textContent = data.length;
  } catch (err) {
    console.error(err);
  }
}

function renderFriends() {
  const container = $("friendsList");
  container.innerHTML = "";
  friendsList.forEach((f) => {
    const isOnline = onlineUsersMap.has(f._id) || f.isOnline;
    const div = document.createElement("div");
    div.className = "user-item";
    div.innerHTML = `
  <div class="info">
    <span class="online-dot ${isOnline ? "online" : "offline"}"></span>
    <span class="name">${f.username}</span>
    <span class="ign">🎮 ${f.minecraftIGN}</span>
  </div>
  <div class="actions">
    <button onclick="openChat('${f._id}')">💬 Chat</button>
  </div>
`;
    container.appendChild(div);
  });
}

async function fetchPendingRequests() {
  try {
    const res = await fetch(API + "/friends/pending", {
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    pendingRequests = data;
    renderPending();
    $("dashRequestCount").textContent = data.length;
  } catch (err) {
    console.error(err);
  }
}

function renderPending() {
  const container = $("pendingRequests");
  container.innerHTML = "";
  pendingRequests.forEach((req) => {
    const div = document.createElement("div");
    div.className = "user-item";
    div.innerHTML = `
  <div class="info">
    <span class="name">${req.sender.username}</span>
    <span class="ign">🎮 ${req.sender.minecraftIGN}</span>
  </div>
  <div class="actions">
    <button onclick="acceptRequest('${req._id}')">✅ Accept</button>
  </div>
`;
    container.appendChild(div);
  });
}

async function sendFriendRequest(userId) {
  try {
    const res = await fetch(API + "/friends/request", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + currentToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipientId: userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert("Friend request sent!");
  } catch (err) {
    alert(err.message);
  }
}

async function acceptRequest(requestId) {
  try {
    const res = await fetch(API + "/friends/accept/" + requestId, {
      method: "PUT",
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    fetchPendingRequests();
    fetchFriends();
  } catch (err) {
    alert(err.message);
  }
}

// ========== CHAT ==========
function renderChatFriends() {
  const container = $("chatFriendsList");
  container.innerHTML =
    '<div style="color:#777;font-size:12px;padding:6px 0;">Your Friends</div>';
  friendsList.forEach((f) => {
    const isOnline = onlineUsersMap.has(f._id) || f.isOnline;
    const div = document.createElement("div");
    div.className =
      "friend-item" + (currentChatFriend === f._id ? " active" : "");
    div.innerHTML = `<span class="online-dot ${isOnline ? "online" : "offline"}" style="width:10px;height:10px;border-radius:50%;display:inline-block;"></span> ${f.username}`;
    div.onclick = () => openChat(f._id);
    container.appendChild(div);
  });
}

function openChat(friendId) {
  currentChatFriend = friendId;
  renderChatFriends();
  $("chatInput").disabled = false;
  $("chatSendBtn").disabled = false;
  $("voiceCallBtn").disabled = false;
  $("chatMessages").innerHTML = "";
  // Fetch history
  if (socket) {
    socket.emit("fetch-history", friendId);
  }
  // Switch to chat view
  switchView("chat");
}

// Listen for history
if (socket) {
  socket.on("history-data", (messages) => {
    if (currentChatFriend) {
      $("chatMessages").innerHTML = "";
      messages.forEach((m) => {
        appendMessage(m, m.sender === currentUser._id);
      });
    }
  });
}

function appendMessage(msg, isOwn) {
  const container = $("chatMessages");
  const div = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");
  const senderName = isOwn ? "You" : msg.senderUsername || "Friend";
  div.innerHTML = `<strong>${senderName}</strong> ${msg.content}<small>${new Date(msg.timestamp).toLocaleTimeString()}</small>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Send message
$("chatSendBtn").addEventListener("click", sendMessage);
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text || !currentChatFriend || !socket) return;
  socket.emit("send-message", {
    recipientId: currentChatFriend,
    content: text,
  });
  input.value = "";
}

// ========== VOICE CALL (WebRTC) ==========
$("voiceCallBtn").addEventListener("click", async () => {
  if (!currentChatFriend) return alert("Select a friend first");
  isCaller = true;
  callTarget = currentChatFriend;
  await startCall(false, null);
});

async function startCall(isAnswer, incomingOffer) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    $("callOverlay").classList.add("active");
    $("callStatus").textContent = isAnswer
      ? "Connecting..."
      : "Calling...";

    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    localStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket && callTarget) {
        socket.emit("ice-candidate", {
          targetUserId: callTarget,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.ontrack = (event) => {
      // Incoming audio
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };

    if (isAnswer && incomingOffer) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(incomingOffer),
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit("answer-call", { targetUserId: callTarget, answer });
      $("callStatus").textContent = "Connected";
    } else if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("call-user", { targetUserId: callTarget, offer });
      $("callStatus").textContent = "Ringing...";
    }

    // Mute button
    $("callMuteBtn").onclick = () => {
      if (localStream) {
        const enabled = localStream.getAudioTracks()[0].enabled;
        localStream.getAudioTracks()[0].enabled = !enabled;
        $("callMuteBtn").textContent = enabled ? "🔇" : "🔊";
      }
    };

    $("callHangupBtn").onclick = () => {
      if (socket && callTarget)
        socket.emit("end-call", { targetUserId: callTarget });
      endCall();
    };
  } catch (err) {
    alert("Cannot access microphone: " + err.message);
    endCall();
  }
}

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  $("callOverlay").classList.remove("active");
  callTarget = null;
  isCaller = false;
}

// ========== PROFILE ==========
async function loadProfile() {
  try {
    const res = await fetch(API + "/users/me", {
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("profileBio").value = data.bio || "";
    $("profileState").value = data.state || "";
    $("profileServer").value = data.favoriteServer || "";
  } catch (err) {
    console.error(err);
  }
}

$("saveProfileBtn").addEventListener("click", async () => {
  const bio = $("profileBio").value.slice(0, 300);
  const state = $("profileState").value.trim();
  const favoriteServer = $("profileServer").value.trim();
  try {
    const res = await fetch(API + "/users/me", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + currentToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bio, state, favoriteServer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("profileStatus").textContent = "✅ Profile updated!";
    setTimeout(() => ($("profileStatus").textContent = ""), 3000);
  } catch (err) {
    alert(err.message);
  }
});

// ========== NAVIGATION ==========
function setupNavigation() {
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
}

function switchView(viewId) {
  views.forEach((v) => v.classList.remove("active"));
  const target = document.getElementById("view-" + viewId);
  if (target) target.classList.add("active");
  navBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.view === viewId),
  );
  if (viewId === "online") fetchOnlineUsers();
  if (viewId === "friends") {
    fetchFriends();
    fetchPendingRequests();
  }
  if (viewId === "chat") renderChatFriends();
}

// Logout
logoutBtn.addEventListener("click", () => {
  localStorage.clear();
  if (socket) socket.disconnect();
  location.reload();
});

// Global for inline onclick
window.sendFriendRequest = sendFriendRequest;
window.acceptRequest = acceptRequest;
window.openChat = openChat;

// ========== POLLING FOR ONLINE STATUS (fallback) ==========
// Socket will update, but we also poll to keep UI fresh
setInterval(() => {
  if (currentToken) fetchOnlineUsers();
}, 10000);

console.log("🇳🇬 NaijaCraft Hub loaded!");
