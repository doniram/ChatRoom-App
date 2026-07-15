// ===== STATE =====
let socket = null;
let currentUser = { roomId: null, username: null };
let editingMessageId = null;
let contextMessageId = null;
let userPanelOpen = false;
const SESSION_KEY = 'chatroom_session';

// ===== SESSION =====
function saveSession(r, u) { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId: r, username: u })); }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

// ===== SCREEN =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; s.style.opacity = '0'; });
  const t = document.getElementById(id);
  t.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => { t.classList.add('active'); t.style.opacity = '1'; }));
}

// ===== UTILS =====
function showError(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.remove('hidden'); }
function hideError(id) { document.getElementById(id).classList.add('hidden'); }
function showToast(msg, dur = 3000) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.add('hidden'), dur);
}
function formatTime(ts) { return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
function setLoading(bId, lId, v) { const b = document.getElementById(bId), l = document.getElementById(lId); if (b) b.disabled = v; if (l) l.classList.toggle('hidden', !v); }
function togglePassword(id) { const el = document.getElementById(id); el.type = el.type === 'password' ? 'text' : 'password'; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function isValidRoomId(id) { return /^[a-zA-Z0-9_\-]{1,16}$/.test(id); }
function isValidUsername(n) { return /^[a-zA-Z0-9_\-\.]{2,16}$/.test(n); }
function scrollToBottom(smooth) { const a = document.getElementById('messages-area'); requestAnimationFrame(() => a.scrollTo({ top: a.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })); }

function generateRoomId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let id = '';
  for (let i = 0; i < 6; i++) id += c[Math.floor(Math.random() * c.length)];
  document.getElementById('create-roomid').value = id;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');
}

// ===== FILE HELPERS =====
const DOC_ICONS = {
  pdf:  { icon: '📄', color: '#e05252', bg: 'rgba(224,82,82,0.12)' },
  doc:  { icon: '📝', color: '#4a9eff', bg: 'rgba(74,158,255,0.12)' },
  docx: { icon: '📝', color: '#4a9eff', bg: 'rgba(74,158,255,0.12)' },
  xls:  { icon: '📊', color: '#25d366', bg: 'rgba(37,211,102,0.12)' },
  xlsx: { icon: '📊', color: '#25d366', bg: 'rgba(37,211,102,0.12)' },
  ppt:  { icon: '📋', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  pptx: { icon: '📋', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  txt:  { icon: '📃', color: '#a0aec0', bg: 'rgba(160,174,192,0.12)' },
  csv:  { icon: '🗂️', color: '#25d366', bg: 'rgba(37,211,102,0.12)' },
  zip:  { icon: '🗜️', color: '#9b5de5', bg: 'rgba(155,93,229,0.12)' },
  json: { icon: '{ }', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  default: { icon: '📎', color: '#8899aa', bg: 'rgba(136,153,170,0.12)' }
};

function getDocMeta(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return DOC_ICONS[ext] || DOC_ICONS.default;
}

function formatBytes(str) { return str; } // already formatted by server

const ALLOWED_TYPES = [
  'image/jpeg','image/jpg','image/png','image/gif','image/webp',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','application/zip','application/x-zip-compressed','application/json'
];

// ===== AUTH =====
async function createRoom() {
  const roomId = document.getElementById('create-roomid').value.trim().toUpperCase();
  const username = document.getElementById('create-username').value.trim();
  const password = document.getElementById('create-password').value;
  hideError('create-error');
  if (!isValidRoomId(roomId)) return showError('create-error', '❌ Room ID: 1–16 karakter huruf/angka');
  if (!isValidUsername(username)) return showError('create-error', '❌ Username: 2–16 karakter huruf/angka');
  if (!password || password.length < 4) return showError('create-error', '❌ Password minimal 4 karakter');
  setLoading('create-btn', 'create-loader', true);
  try {
    const res = await fetch('/api/create-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, password }) });
    const data = await res.json();
    if (!res.ok) { showError('create-error', '❌ ' + data.error); setLoading('create-btn','create-loader',false); return; }
    currentUser = { roomId, username }; saveSession(roomId, username); initSocket(); setupChatUI();
  } catch { showError('create-error', '❌ Gagal terhubung ke server'); setLoading('create-btn','create-loader',false); }
}

async function joinRoom() {
  const roomId = document.getElementById('join-roomid').value.trim().toUpperCase();
  const username = document.getElementById('join-username').value.trim();
  const password = document.getElementById('join-password').value;
  hideError('join-error');
  if (!isValidRoomId(roomId)) return showError('join-error', '❌ Room ID: 1–16 karakter huruf/angka');
  if (!isValidUsername(username)) return showError('join-error', '❌ Username: 2–16 karakter huruf/angka');
  if (!password) return showError('join-error', '❌ Masukkan password room');
  setLoading('join-btn', 'join-loader', true);
  try {
    const res = await fetch('/api/join-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, username, password }) });
    const data = await res.json();
    if (!res.ok) { showError('join-error', '❌ ' + data.error); setLoading('join-btn','join-loader',false); return; }
    currentUser = { roomId, username }; saveSession(roomId, username); initSocket(); setupChatUI();
  } catch { showError('join-error', '❌ Gagal terhubung ke server'); setLoading('join-btn','join-loader',false); }
}

// ===== SOCKET =====
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => {
    socket.emit('join-room', { roomId: currentUser.roomId, username: currentUser.username });
    setLoading('create-btn','create-loader',false);
    setLoading('join-btn','join-loader',false);
  });

  socket.on('error', msg => { showToast('⚠️ ' + msg); setLoading('create-btn','create-loader',false); setLoading('join-btn','join-loader',false); });

  socket.on('message-history', msgs => {
    const area = document.getElementById('messages-area');
    area.innerHTML = '';
    if (!msgs.length) {
      area.innerHTML = `<div class="chat-welcome"><div class="welcome-icon">🎉</div><p>Selamat datang di room!<br>Mulai ngobrol sekarang.</p></div>`;
    } else {
      area.classList.add('has-messages');
      msgs.forEach(renderMessage);
    }
    scrollToBottom(); showScreen('screen-chat');
    setTimeout(() => document.getElementById('message-input')?.focus(), 350);
  });

  socket.on('room-info', ({ remainingH, remainingM }) => updateRoomTimer(remainingH, remainingM));

  socket.on('new-message', msg => {
    document.querySelector('.chat-welcome')?.remove();
    document.getElementById('messages-area').classList.add('has-messages');
    renderMessage(msg); scrollToBottom(true);
  });

  socket.on('message-edited', ({ messageId, newContent }) => {
    const t = document.querySelector(`[data-id="${messageId}"] .msg-text`);
    const e = document.querySelector(`[data-id="${messageId}"] .msg-edited`);
    if (t) t.innerHTML = escapeHtml(newContent);
    if (e) { e.textContent = '✏️'; e.style.display = 'inline'; }
  });

  socket.on('message-deleted', ({ messageId }) => {
    const el = document.querySelector(`[data-id="${messageId}"]`);
    if (el) { el.style.opacity = '0'; el.style.transform = 'scale(0.95)'; el.style.transition = 'all .2s'; setTimeout(() => el.remove(), 200); }
  });

  socket.on('user-joined', ({ username, users }) => {
    if (username !== currentUser.username) appendSystem(`👋 ${username} bergabung`);
    updateUserList(users);
  });
  socket.on('user-left', ({ username, users }) => { appendSystem(`🚪 ${username} meninggalkan room`); updateUserList(users); });

  socket.on('room-expired', ({ message }) => {
    showToast('⏰ ' + message, 6000); clearSession();
    setTimeout(() => { socket?.disconnect(); socket = null; currentUser = { roomId: null, username: null }; showScreen('screen-landing'); }, 3500);
  });

  socket.on('disconnect', () => showToast('⚡ Koneksi terputus...'));
  socket.on('reconnect', () => {
    if (currentUser.roomId) { socket.emit('join-room', { roomId: currentUser.roomId, username: currentUser.username }); showToast('✅ Terhubung kembali'); }
  });
}

// ===== ROOM TIMER =====
function updateRoomTimer(h, m) {
  const el = document.getElementById('room-timer');
  if (!el) return;
  if (h <= 0 && m <= 0) { el.textContent = '⏰ Hampir kedaluwarsa!'; el.style.color = '#f87171'; }
  else if (h < 2)       { el.textContent = `⏰ ${h}j ${m}m lagi`; el.style.color = '#fbbf24'; }
  else                  { el.textContent = `⏱️ ${h}j lagi`; el.style.color = 'var(--accent)'; }
}

// ===== CHAT UI =====
function setupChatUI() {
  document.getElementById('header-room-name').textContent = `Room #${currentUser.roomId}`;
  const a = document.getElementById('messages-area'); a.innerHTML = ''; a.classList.remove('has-messages');
}

// ===== RENDER MESSAGE =====
function renderMessage(msg) {
  const isOwn = msg.username === currentUser.username;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isOwn ? 'outgoing' : 'incoming'}`;
  wrapper.setAttribute('data-id', msg.id);
  wrapper.setAttribute('data-type', msg.type || 'text');
  const time = formatTime(msg.timestamp);
  const nameHTML = !isOwn ? `<div class="msg-username">${escapeHtml(msg.username)}</div>` : '';

  if (msg.type === 'image') {
    wrapper.innerHTML = `
      ${nameHTML}
      <div class="message-bubble image-bubble" onclick="handleBubbleClick(event,'${msg.id}',${isOwn})">
        <div class="img-wrapper">
          <img src="${msg.imageUrl}" alt="${escapeHtml(msg.originalName||'Foto')}" loading="lazy" onclick="openLightbox('${msg.imageUrl}')" />
          <div class="img-overlay"></div>
        </div>
        <div class="msg-meta-inline"><span class="msg-time">${time}</span></div>
      </div>`;
    if (isOwn) addLongPress(wrapper.querySelector('.message-bubble'), msg.id);

  } else if (msg.type === 'doc') {
    const meta = getDocMeta(msg.originalName || msg.filename);
    const fname = escapeHtml(msg.originalName || msg.filename || 'Dokumen');
    const fsize = escapeHtml(msg.fileSize || '');
    wrapper.innerHTML = `
      ${nameHTML}
      <div class="message-bubble doc-bubble" oncontextmenu="showContextMenu(event,'${msg.id}',${isOwn})" onclick="handleBubbleClick(event,'${msg.id}',${isOwn})">
        <a class="doc-card" href="${msg.fileUrl}" download="${escapeHtml(msg.originalName||msg.filename||'file')}" target="_blank" onclick="event.stopPropagation()">
          <div class="doc-icon-wrap" style="background:${meta.bg}">
            <span class="doc-icon" style="color:${meta.color}">${meta.icon}</span>
          </div>
          <div class="doc-info">
            <div class="doc-name">${fname}</div>
            <div class="doc-size">${fsize}</div>
          </div>
          <div class="doc-download" style="color:${meta.color}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
        </a>
        <div class="msg-meta-inline"><span class="msg-time">${time}</span></div>
      </div>`;
    if (isOwn) addLongPress(wrapper.querySelector('.message-bubble'), msg.id);

  } else {
    const editedHTML = msg.edited ? `<span class="msg-edited" style="display:inline">✏️</span>` : `<span class="msg-edited" style="display:none">✏️</span>`;
    wrapper.innerHTML = `
      ${nameHTML}
      <div class="message-bubble" oncontextmenu="showContextMenu(event,'${msg.id}',${isOwn})" onclick="handleBubbleClick(event,'${msg.id}',${isOwn})">
        <span class="msg-text">${escapeHtml(msg.content)}</span>
        <div class="msg-meta-inline"><span class="msg-time">${time}</span>${editedHTML}</div>
      </div>`;
  }

  document.getElementById('messages-area').appendChild(wrapper);
}

function addLongPress(el, msgId) {
  let t;
  el.addEventListener('touchstart', () => { t = setTimeout(() => showContextMenu({ clientX: window.innerWidth/2, clientY: window.innerHeight*0.6, preventDefault:()=>{} }, msgId, true), 600); }, { passive: true });
  ['touchend','touchmove','touchcancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
  el.addEventListener('contextmenu', e => showContextMenu(e, msgId, true));
}

function appendSystem(text) {
  const el = document.createElement('div'); el.className = 'system-message'; el.textContent = text;
  document.getElementById('messages-area').appendChild(el); scrollToBottom(true);
}

// ===== USER LIST =====
function updateUserList(users) {
  const list = document.getElementById('user-list'); list.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="user-dot"></div><span>${escapeHtml(u)}</span>${u===currentUser.username?'<span class="user-you">Kamu</span>':''}`;
    list.appendChild(li);
  });
  document.getElementById('header-online-count').textContent = `${users.length} online`;
}

function toggleUserPanel() {
  userPanelOpen = !userPanelOpen;
  document.getElementById('user-panel').classList.toggle('open', userPanelOpen);
  document.getElementById('toggle-users-btn').classList.toggle('active', userPanelOpen);
}

// ===== SEND TEXT =====
function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !socket) return;
  if (editingMessageId) {
    socket.emit('edit-message', { roomId: currentUser.roomId, messageId: editingMessageId, newContent: content });
    cancelEdit();
  } else {
    socket.emit('send-message', { roomId: currentUser.roomId, content });
  }
  input.value = ''; input.style.height = 'auto'; input.focus();
}

function handleKeydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

// ===== ATTACH MENU =====
function toggleAttachMenu() {
  const menu = document.getElementById('attach-menu');
  menu.classList.toggle('open');
}
function closeAttachMenu() { document.getElementById('attach-menu')?.classList.remove('open'); }

function triggerImageUpload() {
  closeAttachMenu();
  document.getElementById('image-input').click();
}
function triggerDocUpload() {
  closeAttachMenu();
  document.getElementById('doc-input').click();
}

// ===== UPLOAD =====
async function handleFileSelect(e, category) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  if (!ALLOWED_TYPES.includes(file.type)) { showToast('❌ Tipe file tidak didukung'); return; }
  if (file.size > 20 * 1024 * 1024) { showToast('❌ Ukuran file maks. 20MB'); return; }

  const previewId = 'prev-' + Date.now();
  const isImage = file.type.startsWith('image/');
  showUploadPreview(previewId, file, isImage);

  const fd = new FormData();
  fd.append('file', file);
  fd.append('roomId', currentUser.roomId);
  fd.append('username', currentUser.username);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    document.querySelector(`[data-preview-id="${previewId}"]`)?.remove();
    if (!res.ok) showToast('❌ ' + (data.error || 'Gagal upload'));
  } catch {
    document.querySelector(`[data-preview-id="${previewId}"]`)?.remove();
    showToast('❌ Gagal mengunggah file');
  }
}

function showUploadPreview(previewId, file, isImage) {
  const area = document.getElementById('messages-area');
  area.classList.add('has-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper outgoing';
  wrapper.setAttribute('data-preview-id', previewId);

  if (isImage) {
    const url = URL.createObjectURL(file);
    wrapper.innerHTML = `
      <div class="message-bubble image-bubble uploading">
        <div class="img-wrapper">
          <img src="${url}" alt="Uploading..." />
          <div class="img-overlay"><div class="upload-spinner"></div></div>
        </div>
      </div>`;
  } else {
    const meta = getDocMeta(file.name);
    wrapper.innerHTML = `
      <div class="message-bubble doc-bubble uploading">
        <div class="doc-card">
          <div class="doc-icon-wrap" style="background:${meta.bg}">
            <span class="doc-icon" style="color:${meta.color}">${meta.icon}</span>
          </div>
          <div class="doc-info">
            <div class="doc-name">${escapeHtml(file.name)}</div>
            <div class="doc-size">Mengunggah...</div>
          </div>
          <div class="upload-spinner-sm"></div>
        </div>
      </div>`;
  }
  area.appendChild(wrapper);
  scrollToBottom(true);
}

// ===== LIGHTBOX =====
function openLightbox(url) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = url;
  lb.classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
}

// ===== EDIT / DELETE =====
function startEdit(msgId) {
  const t = document.querySelector(`[data-id="${msgId}"] .msg-text`);
  if (!t) return;
  editingMessageId = msgId;
  const input = document.getElementById('message-input');
  input.value = t.textContent; input.focus(); autoResize(input);
  document.getElementById('edit-indicator').classList.remove('hidden');
  hideContextMenu();
}
function cancelEdit() {
  editingMessageId = null;
  document.getElementById('message-input').value = '';
  document.getElementById('message-input').style.height = 'auto';
  document.getElementById('edit-indicator').classList.add('hidden');
}
function deleteMessage(msgId) {
  socket?.emit('delete-message', { roomId: currentUser.roomId, messageId: msgId });
  hideContextMenu();
}

// ===== CONTEXT MENU =====
function showContextMenu(e, msgId, isOwn) {
  e.preventDefault(); if (!isOwn) return;
  contextMessageId = msgId;
  const type = document.querySelector(`[data-id="${msgId}"]`)?.getAttribute('data-type');
  document.getElementById('ctx-edit').style.display = type === 'text' ? 'block' : 'none';
  const menu = document.getElementById('context-menu');
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 140) + 'px';
}
function handleBubbleClick(e, msgId, isOwn) { if (isOwn && window.innerWidth <= 768) showContextMenu(e, msgId, isOwn); }
function hideContextMenu() { document.getElementById('context-menu').classList.add('hidden'); contextMessageId = null; }
function contextEdit()   { if (contextMessageId) startEdit(contextMessageId); }
function contextDelete() { if (contextMessageId) deleteMessage(contextMessageId); }
document.addEventListener('click', e => { if (!document.getElementById('context-menu').contains(e.target)) hideContextMenu(); });

// ===== LOGOUT =====
function logout() {
  socket?.emit('logout', { roomId: currentUser.roomId, username: currentUser.username });
  socket?.disconnect(); socket = null;
  clearSession(); currentUser = { roomId: null, username: null }; editingMessageId = null;
  userPanelOpen = false; document.getElementById('user-panel').classList.remove('open');
  ['create-roomid','create-username','create-password','join-roomid','join-username','join-password']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['create-error','join-error'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  showScreen('screen-landing'); showToast('✅ Berhasil keluar dari room');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  const cb = document.querySelector('#screen-create .btn-primary.full');
  const jb = document.querySelector('#screen-join .btn-primary.full');
  if (cb) cb.id = 'create-btn';
  if (jb) jb.id = 'join-btn';

  ['create-roomid','create-username','create-password'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') createRoom(); }));
  ['join-roomid','join-username','join-password'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); }));

  ['create-roomid','join-roomid'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9_\-]/g,'').slice(0,16).toUpperCase(); });
  });
  ['create-username','join-username'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9_\-\.]/g,'').slice(0,16); });
  });

  document.getElementById('message-input')?.addEventListener('focus', () => setTimeout(() => scrollToBottom(), 350));

  document.getElementById('lightbox')?.addEventListener('click', e => { if (e.target === document.getElementById('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); hideContextMenu(); closeAttachMenu(); } });

  // Close attach menu on outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('attach-menu');
    const btn  = document.getElementById('attach-btn');
    if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeAttachMenu();
  });

  // Paste image
  document.addEventListener('paste', async e => {
    if (!currentUser.roomId) return;
    for (const item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); await handleFileSelect({ target: { files: [file], value: '' } }, 'image'); }
      }
    }
  });

  // Session restore
  const session = loadSession();
  if (session?.roomId && session?.username) {
    fetch(`/api/room/${session.roomId}/exists`)
      .then(r => r.json())
      .then(d => {
        if (d.exists) { currentUser = { roomId: session.roomId, username: session.username }; setupChatUI(); initSocket(); }
        else { clearSession(); showScreen('screen-landing'); showToast('ℹ️ Room sudah tidak ada atau kedaluwarsa'); }
      })
      .catch(() => { clearSession(); showScreen('screen-landing'); });
  } else {
    showScreen('screen-landing');
  }
});
