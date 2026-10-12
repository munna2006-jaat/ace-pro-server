# 🛡️ Ace Pro — Central License Server & Admin Panel

Ace Pro ka backend license authentication system aur client control panel.

---

## 🚀 Features

1. **Client Management:**
   - Client ka **Username & Password** generate karein.
   - Validity set karein: **1 Day Trial**, **7 Days**, **30 Days (1 Month)**, ya **Custom**.
   - One-Click **+30 Days Extension** button.
   - Status toggle (**Active / Suspended**).
   - HWID / Single Device Lock (taaki ek client apni ID 10 logo ko share na kare).

2. **WhatsApp Ready Sharing:**
   - Naya client bante hi ek ready-made WhatsApp message copy ho jata hai jo aap seedha client ko bhej sakte ho.

3. **Zero Dependencies:**
   - Native Node.js + SQLite database (`node:sqlite`). Kisi heavy external module ki zaroorat nahi.

---

## 💻 Local par Kaise Run Karein

```bash
cd admin-server
node server.js
```

Ab browser me kholein:
👉 **http://localhost:3000**

* **Default Admin Password:** `admin123`

---

## ☁️ Cloud / VPS par Kaise Deploy Karein (Taaki 24/7 Chale)

### Option 1: VPS (DigitalOcean / Hetzner / AWS / Linode)

1. Apne VPS me project folder upload karein:
   ```bash
   scp -r admin-server root@your-vps-ip:/var/www/ace-admin
   ```
2. VPS me PM2 ke through background me run karein:
   ```bash
   npm install -g pm2
   cd /var/www/ace-admin
   pm2 start server.js --name "ace-pro-server"
   pm2 startup
   pm2 save
   ```
3. Nginx ya domain point karein (e.g. `https://license.yourdomain.com`).

### Option 2: Render.com / Railway (Free / 5$ Hosting)
- GitHub par push karein.
- Render.com pe "New Web Service" select karein.
- Build Command: `node -v`
- Start Command: `node server.js`
- Render aapko free live URL de dega (e.g. `https://ace-pro-license.onrender.com`).
