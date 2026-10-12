// server.js - Ace Pro Central License Server & Admin Panel
// Built with native Node.js (Zero external dependencies needed!)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'licenses.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Initialize SQLite Database
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    license_key TEXT UNIQUE,
    expires_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    max_devices INTEGER DEFAULT 1,
    bound_device TEXT,
    bound_p2p_account TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
`);

// Migration: Add bound_p2p_account if missing from existing database
try {
  db.exec("ALTER TABLE licenses ADD COLUMN bound_p2p_account TEXT;");
} catch (e) {
  // Column already exists
}

// Setup default admin credentials if not present
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'AcePro@2026#SecureAdmin';
const getAdminPass = db.prepare("SELECT value FROM admin_config WHERE key = 'admin_password'");
const adminRow = getAdminPass.get();
if (!adminRow) {
  db.prepare("INSERT INTO admin_config (key, value) VALUES ('admin_password', ?)").run(ADMIN_PASS);
} else {
  db.prepare("UPDATE admin_config SET value = ? WHERE key = 'admin_password'").run(ADMIN_PASS);
}
console.log("[Admin] Password configured (Secure)");

// Active admin sessions in memory
const adminSessions = new Set();

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
  });
  res.end(JSON.stringify(data));
}

// Helper to verify Admin Token
function verifyAdmin(req) {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  return token && adminSessions.has(token);
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
    });
    return res.end();
  }

  try {
    // -------------------------------------------------------------
    // CLIENT EXTENSION APIS
    // -------------------------------------------------------------

    // 1. Client License Login (Extension Login)
    if (pathname === '/api/license/login' && method === 'POST') {
      const { username, password, licenseKey, deviceId, p2pAccountId } = await parseJsonBody(req);
      
      let stmt, row;
      if (licenseKey) {
        stmt = db.prepare("SELECT * FROM licenses WHERE license_key = ?");
        row = stmt.get(licenseKey);
      } else if (username && password) {
        stmt = db.prepare("SELECT * FROM licenses WHERE username = ? AND password = ?");
        row = stmt.get(username, password);
      }

      if (!row) {
        return sendJson(res, 401, { success: false, message: "Invalid username or password" });
      }

      if (row.is_active === 0) {
        return sendJson(res, 403, { success: false, message: "Account has been suspended by Admin" });
      }

      const expiryDate = new Date(row.expires_at).getTime();
      const now = Date.now();

      if (now > expiryDate) {
        return sendJson(res, 403, {
          success: false,
          message: `License expired on ${new Date(row.expires_at).toLocaleDateString()}. Please contact Admin to renew.`
        });
      }

      // Device lock check (optional HWID binding)
      if (deviceId) {
        if (!row.bound_device) {
          db.prepare("UPDATE licenses SET bound_device = ? WHERE id = ?").run(deviceId, row.id);
        } else if (row.bound_device !== deviceId) {
          return sendJson(res, 403, {
            success: false,
            message: "License is bound to another device. Ask Admin to reset device lock."
          });
        }
      }

      // P2P Account ID Lock Check (Strict 1-Account Binding)
      if (p2pAccountId && typeof p2pAccountId === 'string') {
        const cleanP2p = p2pAccountId.trim().toLowerCase();
        if (cleanP2p) {
          if (!row.bound_p2p_account) {
            // First run: auto-lock this license to this P2P website account
            db.prepare("UPDATE licenses SET bound_p2p_account = ? WHERE id = ?").run(cleanP2p, row.id);
            row.bound_p2p_account = cleanP2p;
            console.log(`[License] Auto-bound license '${row.username}' to P2P Account: ${cleanP2p}`);
          } else if (row.bound_p2p_account.toLowerCase() !== cleanP2p) {
            return sendJson(res, 403, {
              success: false,
              code: "P2P_ACCOUNT_MISMATCH",
              boundP2pAccount: row.bound_p2p_account,
              attemptedP2pAccount: cleanP2p,
              message: `License is locked to P2P Account [${row.bound_p2p_account}]. Cannot use with [${cleanP2p}]. Purchase another license for this account!`
            });
          }
        }
      }

      // Update last login
      db.prepare("UPDATE licenses SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

      return sendJson(res, 200, {
        success: true,
        username: row.username,
        licenseKey: row.license_key,
        boundP2pAccount: row.bound_p2p_account,
        expiresAt: row.expires_at,
        daysLeft: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
        message: "License active"
      });
    }

    // Health check & Keepalive for UptimeRobot / pingers (GET or HEAD)
    if ((pathname === '/api/license/verify' || pathname === '/health' || pathname === '/api/health') && (method === 'GET' || method === 'HEAD')) {
      return sendJson(res, 200, { status: "ok", alive: true, timestamp: Date.now() });
    }

    // 2. Client License Verify (Heartbeat verification)
    if (pathname === '/api/license/verify' && method === 'POST') {
      const { username, licenseKey, p2pAccountId } = await parseJsonBody(req);
      let stmt, row;
      if (username) {
        stmt = db.prepare("SELECT * FROM licenses WHERE username = ?");
        row = stmt.get(username);
      } else if (licenseKey) {
        stmt = db.prepare("SELECT * FROM licenses WHERE license_key = ?");
        row = stmt.get(licenseKey);
      }

      if (!row || row.is_active === 0) {
        return sendJson(res, 200, { valid: false, message: "License inactive or not found" });
      }

      const expiryDate = new Date(row.expires_at).getTime();
      const isValid = Date.now() <= expiryDate;

      if (!isValid) {
        return sendJson(res, 200, {
          valid: false,
          message: `License expired on ${new Date(row.expires_at).toLocaleDateString()}`
        });
      }

      // P2P Account ID Lock Check
      if (p2pAccountId && typeof p2pAccountId === 'string') {
        const cleanP2p = p2pAccountId.trim().toLowerCase();
        if (cleanP2p) {
          if (!row.bound_p2p_account) {
            // Auto-lock to current account if license was not bound yet
            db.prepare("UPDATE licenses SET bound_p2p_account = ? WHERE id = ?").run(cleanP2p, row.id);
            row.bound_p2p_account = cleanP2p;
            console.log(`[License] Auto-bound license '${row.username}' to P2P Account: ${cleanP2p}`);
          } else if (row.bound_p2p_account.toLowerCase() !== cleanP2p) {
            return sendJson(res, 200, {
              valid: false,
              code: "P2P_ACCOUNT_MISMATCH",
              boundP2pAccount: row.bound_p2p_account,
              attemptedP2pAccount: cleanP2p,
              message: `License is locked to P2P Account [${row.bound_p2p_account}]. Cannot use with [${cleanP2p}]. Purchase another license for this account!`
            });
          }
        }
      }

      return sendJson(res, 200, {
        valid: true,
        boundP2pAccount: row.bound_p2p_account,
        expiresAt: row.expires_at,
        daysLeft: Math.ceil((expiryDate - Date.now()) / (1000 * 60 * 60 * 24)),
        message: "Active"
      });
    }

    // -------------------------------------------------------------
    // ADMIN PANEL APIS
    // -------------------------------------------------------------

    // Admin Login
    if (pathname === '/api/admin/login' && method === 'POST') {
      const { password } = await parseJsonBody(req);
      const row = db.prepare("SELECT value FROM admin_config WHERE key = 'admin_password'").get();
      if (password === row.value) {
        const token = crypto.randomBytes(24).toString('hex');
        adminSessions.add(token);
        return sendJson(res, 200, { success: true, token });
      } else {
        return sendJson(res, 401, { success: false, message: "Incorrect admin password" });
      }
    }

    // Protect all remaining /api/admin/* endpoints
    if (pathname.startsWith('/api/admin/')) {
      if (!verifyAdmin(req)) {
        return sendJson(res, 401, { success: false, message: "Unauthorized. Admin login required." });
      }

      // GET /api/admin/clients -> list all licenses
      if (pathname === '/api/admin/clients' && method === 'GET') {
        const rows = db.prepare("SELECT * FROM licenses ORDER BY id DESC").all();
        const now = Date.now();
        const clients = rows.map(r => {
          const exp = new Date(r.expires_at).getTime();
          const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
          return {
            ...r,
            daysLeft,
            isExpired: now > exp
          };
        });
        return sendJson(res, 200, { clients });
      }

      // POST /api/admin/clients -> create new client
      if (pathname === '/api/admin/clients' && method === 'POST') {
        const { username, password, days = 30, notes = '', p2pAccount = '' } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { success: false, message: "Username and password required" });
        }

        const licenseKey = 'ACE-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + parseInt(days));
        const expiresAt = expDate.toISOString();
        const createdAt = new Date().toISOString();
        const boundP2p = p2pAccount && typeof p2pAccount === 'string' && p2pAccount.trim() ? p2pAccount.trim().toLowerCase() : null;

        try {
          db.prepare(`
            INSERT INTO licenses (username, password, license_key, expires_at, is_active, bound_p2p_account, notes, created_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          `).run(username.trim(), password.trim(), licenseKey, expiresAt, boundP2p, notes.trim(), createdAt);

          return sendJson(res, 201, {
            success: true,
            client: { username, password, licenseKey, expiresAt, days, boundP2pAccount: boundP2p }
          });
        } catch (e) {
          if (e.message && e.message.includes('UNIQUE')) {
            return sendJson(res, 400, { success: false, message: "Username already exists. Choose a different one." });
          }
          return sendJson(res, 500, { success: false, message: e.message });
        }
      }

      // POST /api/admin/clients/extend -> extend validity
      if (pathname === '/api/admin/clients/extend' && method === 'POST') {
        const { id, days = 30 } = await parseJsonBody(req);
        const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(id);
        if (!row) return sendJson(res, 404, { success: false, message: "Client not found" });

        const currentExp = new Date(row.expires_at).getTime();
        const baseTime = currentExp > Date.now() ? currentExp : Date.now();
        const newExpDate = new Date(baseTime + (parseInt(days) * 24 * 60 * 60 * 1000));

        db.prepare("UPDATE licenses SET expires_at = ?, is_active = 1 WHERE id = ?").run(newExpDate.toISOString(), id);
        return sendJson(res, 200, { success: true, newExpiresAt: newExpDate.toISOString() });
      }

      // POST /api/admin/clients/toggle -> toggle active/blocked
      if (pathname === '/api/admin/clients/toggle' && method === 'POST') {
        const { id, active } = await parseJsonBody(req);
        db.prepare("UPDATE licenses SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
        return sendJson(res, 200, { success: true });
      }

      // POST /api/admin/clients/reset-p2p -> clear P2P account binding
      if (pathname === '/api/admin/clients/reset-p2p' && method === 'POST') {
        const { id } = await parseJsonBody(req);
        db.prepare("UPDATE licenses SET bound_p2p_account = NULL WHERE id = ?").run(id);
        return sendJson(res, 200, { success: true, message: "P2P Account lock cleared. Will re-bind on next use." });
      }

      // POST /api/admin/clients/set-p2p -> manually update P2P account binding
      if (pathname === '/api/admin/clients/set-p2p' && method === 'POST') {
        const { id, p2pAccount } = await parseJsonBody(req);
        const cleanP2p = p2pAccount && typeof p2pAccount === 'string' && p2pAccount.trim() ? p2pAccount.trim().toLowerCase() : null;
        db.prepare("UPDATE licenses SET bound_p2p_account = ? WHERE id = ?").run(cleanP2p, id);
        return sendJson(res, 200, { success: true, message: "P2P Account updated" });
      }

      // POST /api/admin/clients/reset-device -> clear HWID binding
      if (pathname === '/api/admin/clients/reset-device' && method === 'POST') {
        const { id } = await parseJsonBody(req);
        db.prepare("UPDATE licenses SET bound_device = NULL WHERE id = ?").run(id);
        return sendJson(res, 200, { success: true, message: "Device lock cleared" });
      }

      // DELETE /api/admin/clients -> delete license
      if (pathname === '/api/admin/clients' && method === 'DELETE') {
        const { id } = await parseJsonBody(req);
        db.prepare("DELETE FROM licenses WHERE id = ?").run(id);
        return sendJson(res, 200, { success: true });
      }
    }

    // -------------------------------------------------------------
    // STATIC ASSETS (Admin UI Web Page)
    // -------------------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png'
      };
      const contentType = mimeTypes[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Default 404
    sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    console.error("Server Error:", err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Ace Pro License Server & Admin Panel Running!`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Admin Login Password: 'admin123'`);
  console.log(`💾 SQLite Database: ${DB_FILE}`);
  console.log(`======================================================\n`);
});
