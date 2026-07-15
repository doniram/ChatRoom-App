const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const multer  = require('multer');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 25 * 1024 * 1024
});

// ===== CONSTANTS =====
const ROOM_TTL_MS      = 24 * 60 * 60 * 1000;  // 24-hour inactivity TTL
const CLEANUP_INTERVAL =  5 * 60 * 1000;        // run cleanup every 5 min
const MAX_FILE_SIZE    = 20 * 1024 * 1024;       // 20 MB per file
const UPLOADS_DIR      = path.join(__dirname, '../public/uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ===== ALLOWED TYPES =====
const ALLOWED_MIME = {
  // images
  'image/jpeg': { category: 'image', ext: '.jpg'  },
  'image/jpg':  { category: 'image', ext: '.jpg'  },
  'image/png':  { category: 'image', ext: '.png'  },
  'image/gif':  { category: 'image', ext: '.gif'  },
  'image/webp': { category: 'image', ext: '.webp' },
  // documents
  'application/pdf':                                                          { category: 'doc', ext: '.pdf'  },
  'application/msword':                                                       { category: 'doc', ext: '.doc'  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  { category: 'doc', ext: '.docx' },
  'application/vnd.ms-excel':                                                 { category: 'doc', ext: '.xls'  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':        { category: 'doc', ext: '.xlsx' },
  'application/vnd.ms-powerpoint':                                            { category: 'doc', ext: '.ppt'  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':{ category: 'doc', ext: '.pptx' },
  'text/plain':        { category: 'doc', ext: '.txt'  },
  'text/csv':          { category: 'doc', ext: '.csv'  },
  'application/zip':   { category: 'doc', ext: '.zip'  },
  'application/x-zip-compressed': { category: 'doc', ext: '.zip' },
  'application/json':  { category: 'doc', ext: '.json' },
};

function formatFileSize(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const info = ALLOWED_MIME[file.mimetype];
    const ext  = info ? info.ext : path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('Tipe file tidak didukung'));
  }
});

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ===== IN-MEMORY DB =====
const rooms = {};

// ===== HELPERS =====
function touchRoom(roomId) {
  if (rooms[roomId]) rooms[roomId].lastActivity = Date.now();
}

function deleteRoomFiles(room) {
  (room.messages || []).forEach(msg => {
    if (msg.filename) {
      const fp = path.join(UPLOADS_DIR, msg.filename);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    }
  });
}

function getRoomInfo(roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  const remainingMs = ROOM_TTL_MS - (Date.now() - (room.lastActivity || room.createdAt));
  return {
    remainingH: Math.max(0, Math.floor(remainingMs / 3600000)),
    remainingM: Math.max(0, Math.floor((remainingMs % 3600000) / 60000))
  };
}

// ===== CLEANUP EXPIRED ROOMS (every 5 min) =====
function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    if (now - (room.lastActivity || room.createdAt) > ROOM_TTL_MS) {
      deleteRoomFiles(room);
      io.to(roomId).emit('room-expired', { message: 'Room kedaluwarsa (24 jam tidak aktif). Semua file telah dihapus.' });
      delete rooms[roomId];
      console.log(`[Expired] Room ${roomId} deleted`);
    }
  }
}
setInterval(cleanupExpiredRooms, CLEANUP_INTERVAL);

// ===== REST API =====
app.post('/api/create-room', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) return res.status(400).json({ error: 'roomId dan password wajib diisi' });
  if (!/^[A-Z0-9_-]{1,16}$/.test(roomId)) return res.status(400).json({ error: 'Room ID tidak valid' });
  if (rooms[roomId]) return res.status(409).json({ error: 'Room ID sudah digunakan' });
  const now = Date.now();
  rooms[roomId] = { password, users: {}, messages: [], createdAt: now, lastActivity: now };
  console.log(`[Created] Room ${roomId}`);
  res.json({ success: true, roomId });
});

app.post('/api/join-room', (req, res) => {
  const { roomId, username, password } = req.body;
  if (!roomId || !username || !password) return res.status(400).json({ error: 'Semua field wajib diisi' });
  if (!rooms[roomId]) return res.status(404).json({ error: 'Room tidak ditemukan' });
  if (rooms[roomId].password !== password) return res.status(401).json({ error: 'Password salah' });
  if (Object.keys(rooms[roomId].users).includes(username)) return res.status(409).json({ error: 'Username sudah digunakan di room ini' });
  res.json({ success: true });
});

app.get('/api/room/:roomId/exists', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.json({ exists: false });
  res.json({ exists: true, ...getRoomInfo(req.params.roomId) });
});

// ===== UPLOAD (image + document) =====
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });

  const { roomId, username } = req.body;
  if (!roomId || !username || !rooms[roomId]) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Room tidak valid' });
  }

  const info     = ALLOWED_MIME[req.file.mimetype] || { category: 'doc' };
  const category = info.category;
  const origName = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); // fix encoding

  const message = {
    id:           uuidv4(),
    username,
    type:         category,           // 'image' | 'doc'
    filename:     req.file.filename,
    originalName: origName,
    fileSize:     formatFileSize(req.file.size),
    mimetype:     req.file.mimetype,
    fileUrl:      `/uploads/${req.file.filename}`,
    // for images
    imageUrl:     category === 'image' ? `/uploads/${req.file.filename}` : null,
    timestamp:    Date.now(),
    edited:       false
  };

  rooms[roomId].messages.push(message);
  touchRoom(roomId);
  io.to(roomId).emit('new-message', message);
  console.log(`[Upload] ${username}@${roomId} — ${origName} (${category})`);
  res.json({ success: true });
});

// ===== SOCKET.IO =====
io.on('connection', socket => {
  socket.on('join-room', ({ roomId, username }) => {
    if (!rooms[roomId]) return socket.emit('error', 'Room tidak ditemukan atau sudah kedaluwarsa');
    const usernameInUse = Object.keys(rooms[roomId].users).some(
      u => u === username && rooms[roomId].users[u] !== socket.id
    );
    if (usernameInUse) return socket.emit('error', 'Username sudah digunakan');

    rooms[roomId].users[username] = socket.id;
    socket.join(roomId);
    socket.data = { roomId, username };
    touchRoom(roomId);

    socket.emit('message-history', rooms[roomId].messages);
    socket.emit('room-info', { ...getRoomInfo(roomId), createdAt: rooms[roomId].createdAt });
    io.to(roomId).emit('user-joined', { username, users: Object.keys(rooms[roomId].users), timestamp: Date.now() });
    console.log(`[Join] ${username} → ${roomId}`);
  });

  socket.on('send-message', ({ roomId, content }) => {
    const { username } = socket.data || {};
    if (!username || !rooms[roomId]) return;
    const msg = { id: uuidv4(), username, type: 'text', content, timestamp: Date.now(), edited: false };
    rooms[roomId].messages.push(msg);
    touchRoom(roomId);
    io.to(roomId).emit('new-message', msg);
  });

  socket.on('edit-message', ({ roomId, messageId, newContent }) => {
    const { username } = socket.data || {};
    if (!username || !rooms[roomId]) return;
    const msg = rooms[roomId].messages.find(m => m.id === messageId);
    if (!msg || msg.username !== username || msg.type !== 'text') return;
    msg.content = newContent; msg.edited = true; msg.editedAt = Date.now();
    touchRoom(roomId);
    io.to(roomId).emit('message-edited', { messageId, newContent });
  });

  socket.on('delete-message', ({ roomId, messageId }) => {
    const { username } = socket.data || {};
    if (!username || !rooms[roomId]) return;
    const idx = rooms[roomId].messages.findIndex(m => m.id === messageId && m.username === username);
    if (idx === -1) return;
    const msg = rooms[roomId].messages[idx];
    if (msg.filename) {
      const fp = path.join(UPLOADS_DIR, msg.filename);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    }
    rooms[roomId].messages.splice(idx, 1);
    touchRoom(roomId);
    io.to(roomId).emit('message-deleted', { messageId });
  });

  socket.on('logout', ({ roomId, username }) => {
    if (roomId && username && rooms[roomId]) {
      delete rooms[roomId].users[username];
      socket.leave(roomId);
      io.to(roomId).emit('user-left', { username, users: Object.keys(rooms[roomId].users), timestamp: Date.now() });
    }
    socket.data = {};
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data || {};
    if (roomId && username && rooms[roomId]) {
      delete rooms[roomId].users[username];
      io.to(roomId).emit('user-left', { username, users: Object.keys(rooms[roomId].users), timestamp: Date.now() });
    }
  });
});

// multer error
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload error' });
  next(err);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ChatApp → http://localhost:${PORT}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);
});
