// app.js - Admin Dashboard Client Logic

let adminToken = sessionStorage.getItem('adminToken') || null;
let allClients = [];

// DOM Elements
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const formLogin = document.getElementById('formLogin');
const inputAdminPassword = document.getElementById('inputAdminPassword');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const btnLogout = document.getElementById('btnLogout');

const valTotalClients = document.getElementById('valTotalClients');
const valActiveClients = document.getElementById('valActiveClients');
const valExpiringClients = document.getElementById('valExpiringClients');
const valExpiredClients = document.getElementById('valExpiredClients');

const searchInput = document.getElementById('searchInput');
const filterStatus = document.getElementById('filterStatus');
const clientsTableBody = document.getElementById('clientsTableBody');

const createClientModal = document.getElementById('createClientModal');
const btnOpenCreateModal = document.getElementById('btnOpenCreateModal');
const btnCloseCreateModal = document.getElementById('btnCloseCreateModal');
const btnCancelCreate = document.getElementById('btnCancelCreate');
const formCreateClient = document.getElementById('formCreateClient');
const btnGenPassword = document.getElementById('btnGenPassword');
const newUsername = document.getElementById('newUsername');
const newPassword = document.getElementById('newPassword');
const newP2pAccount = document.getElementById('newP2pAccount');
const newValidityDays = document.getElementById('newValidityDays');
const newNotes = document.getElementById('newNotes');
const createErrorMsg = document.getElementById('createErrorMsg');

const shareBox = document.getElementById('shareBox');
const shareText = document.getElementById('shareText');
const btnCopyShare = document.getElementById('btnCopyShare');
const adminToast = document.getElementById('adminToast');

function showToast(msg) {
  adminToast.textContent = msg;
  adminToast.classList.add('show');
  setTimeout(() => adminToast.classList.remove('show'), 2000);
}

// 1. Check Auth on Load
if (adminToken) {
  showDashboard();
} else {
  showLogin();
}

function showLogin() {
  loginView.style.display = 'flex';
  dashboardView.style.display = 'none';
}

function showDashboard() {
  loginView.style.display = 'none';
  dashboardView.style.display = 'block';
  loadClients();
}

// 2. Admin Login Form
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = inputAdminPassword.value.trim();
  loginErrorMsg.textContent = '';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;
      sessionStorage.setItem('adminToken', adminToken);
      showDashboard();
    } else {
      loginErrorMsg.textContent = data.message || "Invalid password";
    }
  } catch (err) {
    loginErrorMsg.textContent = "Server connection failed";
  }
});

// Logout
btnLogout.addEventListener('click', () => {
  adminToken = null;
  sessionStorage.removeItem('adminToken');
  showLogin();
});

// 3. Load Clients from API
async function loadClients() {
  try {
    const res = await fetch('/api/admin/clients', {
      headers: { 'X-Admin-Token': adminToken }
    });
    if (res.status === 401) {
      btnLogout.click();
      return;
    }
    const data = await res.json();
    allClients = data.clients || [];
    updateMetrics();
    renderTable();
  } catch (e) {
    console.error("Error loading clients:", e);
  }
}

// 4. Update Metrics Cards
function updateMetrics() {
  const total = allClients.length;
  let active = 0;
  let expiring = 0;
  let expired = 0;

  for (const c of allClients) {
    if (c.isExpired || c.is_active === 0) {
      expired++;
    } else {
      active++;
      if (c.daysLeft <= 3 && c.daysLeft >= 0) {
        expiring++;
      }
    }
  }

  valTotalClients.textContent = total;
  valActiveClients.textContent = active;
  valExpiringClients.textContent = expiring;
  valExpiredClients.textContent = expired;
}

// 5. Render Clients Table
function renderTable() {
  const search = searchInput.value.toLowerCase().trim();
  const filter = filterStatus.value;

  const filtered = allClients.filter(c => {
    const matchSearch = c.username.toLowerCase().includes(search) || (c.notes && c.notes.toLowerCase().includes(search));
    if (!matchSearch) return false;

    if (filter === 'active') return !c.isExpired && c.is_active === 1;
    if (filter === 'expired') return c.isExpired || c.is_active === 0;
    return true;
  });

  if (filtered.length === 0) {
    clientsTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">
          No clients found. Click "+ Create New Client" to generate one.
        </td>
      </tr>
    `;
    return;
  }

  clientsTableBody.innerHTML = filtered.map(c => {
    const expDate = new Date(c.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    let badgeClass = 'active';
    let badgeText = `${c.daysLeft} days left`;

    if (c.isExpired) {
      badgeClass = 'expired';
      badgeText = 'Expired';
    } else if (c.daysLeft <= 3) {
      badgeClass = 'warning';
      badgeText = `${c.daysLeft} days left (Expiring)`;
    }

    return `
      <tr>
        <td>
          <div class="username-cell">
            <span>${escapeHtml(c.username)}</span>
            ${c.bound_device ? '<span title="Device Bound (1 Device Active)" style="color:#00d2ff; font-size:10px;">🔒</span>' : ''}
          </div>
        </td>
        <td>
          <span class="password-badge" title="Click to copy" onclick="copyText('${escapeHtml(c.password)}')">
            ${escapeHtml(c.password)} 📋
          </span>
        </td>
        <td>
          ${c.bound_p2p_account ? `
            <span class="password-badge" style="color: #00d2ff; background: rgba(0, 210, 255, 0.1); border-color: rgba(0, 210, 255, 0.25);" title="Bound P2P Trader Account">
              🔒 ${escapeHtml(c.bound_p2p_account)}
            </span>
          ` : `
            <span style="color: var(--text-muted); font-size: 11px; font-style: italic;">
              🔓 Auto-locks on 1st run
            </span>
          `}
        </td>
        <td style="color: #c9d1d9;">${expDate}</td>
        <td>
          <span class="days-badge ${badgeClass}">${badgeText}</span>
        </td>
        <td>
          <button class="btn btn-sm ${c.is_active === 1 ? 'btn-secondary' : 'btn-danger'}" onclick="toggleStatus(${c.id}, ${c.is_active})">
            ${c.is_active === 1 ? '● Active' : '✕ Blocked'}
          </button>
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">${escapeHtml(c.notes || '-')}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="extendLicense(${c.id})" title="Extend validity by 30 days">+30 Days</button>
            <button class="btn btn-secondary btn-sm" onclick="copyClientDetails('${escapeHtml(c.username)}', '${escapeHtml(c.password)}', '${expDate}', '${escapeHtml(c.bound_p2p_account || '')}')" title="Copy WhatsApp template">WhatsApp</button>
            ${c.bound_p2p_account ? `<button class="btn btn-secondary btn-sm" onclick="resetP2p(${c.id})" title="Reset P2P Account Lock">Reset P2P</button>` : ''}
            ${c.bound_device ? `<button class="btn btn-secondary btn-sm" onclick="resetDevice(${c.id})" title="Reset Device Lock">Reset Device</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.id})">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Search and filter listeners
searchInput.addEventListener('input', renderTable);
filterStatus.addEventListener('change', renderTable);

// 6. Modal Controls & Generator
btnOpenCreateModal.addEventListener('click', () => {
  createErrorMsg.textContent = '';
  formCreateClient.style.display = 'block';
  shareBox.style.display = 'none';
  newUsername.value = '';
  newNotes.value = '';
  newP2pAccount.value = '';
  generateRandomPassword();
  createClientModal.classList.add('show');
});

btnCloseCreateModal.addEventListener('click', () => {
  createClientModal.classList.remove('show');
});

btnCancelCreate.addEventListener('click', () => {
  createClientModal.classList.remove('show');
});

btnGenPassword.addEventListener('click', generateRandomPassword);

function generateRandomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  newPassword.value = pass;
}

// Create Client Form Submit
formCreateClient.addEventListener('submit', async (e) => {
  e.preventDefault();
  createErrorMsg.textContent = '';

  const username = newUsername.value.trim();
  const password = newPassword.value.trim();
  const p2pAccount = newP2pAccount.value.trim();
  const days = parseInt(newValidityDays.value);
  const notes = newNotes.value.trim();

  try {
    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken
      },
      body: JSON.stringify({ username, password, p2pAccount, days, notes })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      loadClients();
      const expDate = new Date(data.client.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const boundInfo = data.client.boundP2pAccount ? data.client.boundP2pAccount : 'Auto-bind on 1st run (Your P2P ID)';
      
      // Show WhatsApp Ready Share Box
      const shareMsg = 
`🤖 *Ace Pro Bot Login Details*
━━━━━━━━━━━━━━━━━━
👤 *Username:* ${username}
🔑 *Password:* ${password}
🔒 *Bound P2P Account:* ${boundInfo}
⏳ *Validity:* ${days} Days (Till: ${expDate})
━━━━━━━━━━━━━━━━━━
⚠️ *Important Security Rule:*
This bot license is locked to *1 P2P Account ONLY*. You cannot use it on another account. For a 2nd P2P account, you must purchase a separate license.
━━━━━━━━━━━━━━━━━━
📲 *How to Run:*
1. Open Kiwi Browser on Mobile (or Chrome on PC).
2. Install the Ace Pro Extension.
3. Login using your Username & Password above.
4. Keep the P2P portal desk tab open. Toggle Start!`;

      shareText.value = shareMsg;
      formCreateClient.style.display = 'none';
      shareBox.style.display = 'block';
      showToast("Client created successfully!");
    } else {
      createErrorMsg.textContent = data.message || "Failed to create client";
    }
  } catch (err) {
    createErrorMsg.textContent = "Server connection error";
  }
});

btnCopyShare.addEventListener('click', () => {
  navigator.clipboard.writeText(shareText.value).then(() => {
    showToast("WhatsApp message copied!");
  });
});

// 7. Client Actions
window.copyText = function(text) {
  navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard!"));
};

window.copyClientDetails = function(username, password, expDate, p2pAccount) {
  const p2pText = p2pAccount ? `\n🔒 P2P Account: ${p2pAccount}` : `\n🔒 P2P Account: Auto-locks on 1st run`;
  const msg = 
`🤖 *Ace Pro Bot Access*
👤 Username: ${username}
🔑 Password: ${password}${p2pText}
⏳ Expires: ${expDate}
⚠️ Note: Valid for 1 P2P website ID only.`;
  navigator.clipboard.writeText(msg).then(() => showToast("Client details copied for WhatsApp!"));
};

window.resetP2p = async function(id) {
  if (!confirm("Reset P2P Account lock for this client? They will be able to bind a new P2P account on their next run.")) return;
  try {
    const res = await fetch('/api/admin/clients/reset-p2p', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("P2P Account lock cleared!");
      loadClients();
    }
  } catch (e) {
    alert("Error resetting P2P account");
  }
};

window.extendLicense = async function(id) {
  if (!confirm("Extend this client's license by 30 Days (1 Month)?")) return;
  try {
    const res = await fetch('/api/admin/clients/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ id, days: 30 })
    });
    if (res.ok) {
      showToast("License extended by 30 days!");
      loadClients();
    }
  } catch (e) {
    alert("Error extending license");
  }
};

window.toggleStatus = async function(id, currentActive) {
  try {
    const res = await fetch('/api/admin/clients/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ id, active: currentActive === 0 })
    });
    if (res.ok) {
      showToast(currentActive === 0 ? "Client activated" : "Client suspended");
      loadClients();
    }
  } catch (e) {
    alert("Error updating status");
  }
};

window.resetDevice = async function(id) {
  if (!confirm("Reset device lock for this client? They will be able to log in from a new device.")) return;
  try {
    const res = await fetch('/api/admin/clients/reset-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Device lock reset!");
      loadClients();
    }
  } catch (e) {
    alert("Error resetting device");
  }
};

window.deleteClient = async function(id) {
  if (!confirm("Are you sure you want to delete this client?")) return;
  try {
    const res = await fetch('/api/admin/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      showToast("Client deleted");
      loadClients();
    }
  } catch (e) {
    alert("Error deleting client");
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
