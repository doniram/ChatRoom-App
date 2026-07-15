# 💬 ChatRoom — Real-Time Chat App

Chat real-time berbasis web dengan fitur upload foto dan room yang bertahan 24 jam.

## 🚀 Cara Menjalankan

```bash
# 1. Install dependencies
npm install

# 2. Jalankan server
npm start

# 3. Buka browser
http://localhost:3000
```

## 📦 Teknologi
- **Backend**: Node.js, Express, Socket.io, Multer
- **Frontend**: HTML, CSS, Vanilla JS
- **Real-time**: WebSocket via Socket.io
- **Storage**: In-memory (RAM) + disk untuk gambar

## ✨ Fitur
| Fitur | Detail |
|---|---|
| Room persisten | Room bertahan 24 jam sejak aktivitas terakhir |
| Upload foto | Kirim gambar (JPG/PNG/GIF/WebP, maks. 8MB) |
| Lightbox | Klik foto untuk memperbesar |
| Paste gambar | Ctrl+V langsung kirim gambar dari clipboard |
| Edit pesan | Dengan keterangan ✏️ diedit |
| Hapus pesan | Pesan & file foto ikut terhapus |
| Pengguna online | Toggle panel kanan |
| Session restore | Refresh halaman tetap di room |
| Timer room | Tampilkan sisa waktu aktif room |
| Notifikasi | Pesan sistem saat user masuk/keluar |

## 📁 Struktur
```
chatapp/
├── server/index.js        ← Backend Express + Socket.io
├── public/
│   ├── index.html         ← UI utama
│   ├── style.css          ← Styling
│   ├── app.js             ← Logic frontend
│   └── uploads/           ← Gambar yang diupload
└── package.json
```

## ⚙️ Konfigurasi
Edit konstanta di `server/index.js`:
- `ROOM_TTL_MS` — durasi room (default: 24 jam)
- `MAX_IMAGE_SIZE` — batas ukuran gambar (default: 8MB)
