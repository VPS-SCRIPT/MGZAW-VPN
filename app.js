// MZZ VPN - VIP User Control Panel Logic
// Compatible with Firebase Realtime Database & Android MZZ VPN client

const DEFAULT_RTDB_URL = "https://flash-4c320-default-rtdb.asia-southeast1.firebasedatabase.app/premium_user.json";

// State
let allUsers = [];
let filteredUsers = [];
let currentFilter = 'ALL'; // ALL, ACTIVE, EXPIRED
let currentSort = 'NEWEST'; // NEWEST, EXPIRING_SOON, NAME, PRICE
let editingIndex = -1; // -1 for new user, >=0 for edit
let rawDbStructure = null; // keeps original shape

// DOM Elements
const userTableBody = document.getElementById('userTableBody');
const userCardsMobile = document.getElementById('userCardsMobile');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const refreshIcon = document.getElementById('refreshIcon');

// Metrics Elements
const statTotalUsers = document.getElementById('statTotalUsers');
const statActiveUsers = document.getElementById('statActiveUsers');
const statExpiredUsers = document.getElementById('statExpiredUsers');
const statRevenue = document.getElementById('statRevenue');
const filterCountAll = document.getElementById('filterCountAll');
const filterCountActive = document.getElementById('filterCountActive');
const filterCountExpired = document.getElementById('filterCountExpired');

// Modals
const userModal = document.getElementById('userModal');
const settingsModal = document.getElementById('settingsModal');

// ==========================================
// 1. INITIALIZATION & DATABASE CONFIG
// ==========================================

function getDbUrl() {
  const custom = localStorage.getItem('mzz_rtdb_url');
  if (custom && custom.trim().startsWith('http')) {
    let u = custom.trim();
    if (!u.endsWith('.json')) {
      u = u.replace(/\/+$/, '') + '/premium_user.json';
    }
    return u;
  }
  return DEFAULT_RTDB_URL;
}

function setDbUrl(url) {
  if (url && url.trim().startsWith('http')) {
    let clean = url.trim();
    if (!clean.endsWith('.json')) {
      clean = clean.replace(/\/+$/, '') + '/premium_user.json';
    }
    localStorage.setItem('mzz_rtdb_url', clean);
  } else {
    localStorage.removeItem('mzz_rtdb_url');
  }
  updateDbStatusUI();
}

function updateDbStatusUI() {
  const url = getDbUrl();
  const dbText = document.getElementById('dbStatusText');

  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    const name = hostParts[0] || 'Firebase';
    dbText.textContent = name;
  } catch (e) {
    dbText.textContent = "Firebase RTDB";
  }
}

// ==========================================
// 2. DATA FETCHING (GET) - NO LIMIT
// ==========================================

async function fetchLiveUsersDirectly() {
  const url = getDbUrl();
  const res = await fetch(url + '?ts=' + Date.now(), {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  rawDbStructure = data;
  return parseUsersData(data);
}

async function loadUsers() {
  showLoading(true);
  refreshIcon.classList.add('animate-spin');

  try {
    allUsers = await fetchLiveUsersDirectly();
    
    // Apply sorting (Default: Newest added stay at top!)
    sortUserList(allUsers);

    applyFilterAndSearch();
    updateMetrics();
    showToast(`Loaded ${allUsers.length} VIP users from database`, "success");
  } catch (err) {
    console.error("Failed to load users:", err);
    showToast(`Connection error: ${err.message}. Check Database URL or Security Rules.`, "error");
    renderEmptyState("Failed to connect to database. Please check connection and permissions.");
  } finally {
    showLoading(false);
    refreshIcon.classList.remove('animate-spin');
  }
}

function parseUsersData(data) {
  if (!data) return [];

  let list = [];
  if (Array.isArray(data)) {
    list = data.filter(item => item !== null && typeof item === 'object');
  } else if (typeof data === 'object') {
    if (Array.isArray(data.premium_user)) {
      list = data.premium_user.filter(item => item !== null && typeof item === 'object');
    } else if (Array.isArray(data.premium_users)) {
      list = data.premium_users.filter(item => item !== null && typeof item === 'object');
    } else if (Array.isArray(data.vip_users)) {
      list = data.vip_users.filter(item => item !== null && typeof item === 'object');
    } else {
      // Key-value pairs or indexed object
      Object.keys(data).forEach(k => {
        if (data[k] && typeof data[k] === 'object') {
          list.push(data[k]);
        }
      });
    }
  }

  // Normalize fields without losing ANY user data
  return list.map(u => {
    const key = u.Key || u.id || u.device_id || u.user_id || '';
    const name = u.Name || u.name || 'VIP User';
    const price = u.Price || u.price || '0 ฿';
    const start = u.StartDate || u.start_date || '';
    const exp = u.Expiration || u.expiration_date || '';
    const note = u.AdminNote || u.admin_note || u.note || '';
    const valid = typeof u.Valid === 'number' ? u.Valid : (typeof u.valid === 'number' ? u.valid : 30);
    const active = u.active !== false;

    return {
      Key: key,
      id: key,
      device_id: key,
      Name: name,
      name: name,
      Price: price,
      price: price,
      StartDate: start,
      start_date: start,
      Expiration: exp,
      expiration_date: exp,
      Valid: valid,
      valid: valid,
      AdminNote: note,
      admin_note: note,
      active: active,
      _original: u
    };
  });
}

// ==========================================
// 3. DATE & EXPIRY HELPERS (MULTI-FORMAT)
// ==========================================

// Parse DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD
function parseDateString(str) {
  if (!str || typeof str !== 'string') return null;
  const clean = str.trim();

  // Try slash format
  const slashParts = clean.split('/');
  if (slashParts.length === 3) {
    const p0 = parseInt(slashParts[0], 10);
    const p1 = parseInt(slashParts[1], 10);
    const p2 = parseInt(slashParts[2], 10);
    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (p2 > 1000) {
        // DD/MM/YYYY
        return new Date(p2, p1 - 1, p0, 23, 59, 59);
      } else if (p0 > 1000) {
        // YYYY/MM/DD
        return new Date(p0, p1 - 1, p2, 23, 59, 59);
      }
    }
  }

  // Try dash format
  const dashParts = clean.split('-');
  if (dashParts.length === 3) {
    const p0 = parseInt(dashParts[0], 10);
    const p1 = parseInt(dashParts[1], 10);
    const p2 = parseInt(dashParts[2], 10);
    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (p0 > 1000) {
        // YYYY-MM-DD
        return new Date(p0, p1 - 1, p2, 23, 59, 59);
      } else if (p2 > 1000) {
        // DD-MM-YYYY
        return new Date(p2, p1 - 1, p0, 23, 59, 59);
      }
    }
  }

  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d;
  return null;
}

// Format JavaScript Date into DD/MM/YYYY
function formatDate(d) {
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Check if user is expired
function isUserExpired(user) {
  if (user.active === false) return true;
  const expDate = parseDateString(user.Expiration);
  if (!expDate) return false;
  return new Date() > expDate;
}

// Calculate remaining days
function getDaysRemaining(user) {
  const expDate = parseDateString(user.Expiration);
  if (!expDate) return 0;
  const now = new Date();
  const diffTime = expDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// ==========================================
// 4. SORTING & METRICS
// ==========================================

function sortUserList(list) {
  if (currentSort === 'EXPIRING_SOON') {
    list.sort((a, b) => {
      const dateA = parseDateString(a.Expiration || a.expiration_date);
      const dateB = parseDateString(b.Expiration || b.expiration_date);
      return (dateA ? dateA.getTime() : Infinity) - (dateB ? dateB.getTime() : Infinity);
    });
  } else if (currentSort === 'NAME') {
    list.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
  } else if (currentSort === 'PRICE') {
    list.sort((a, b) => {
      const pA = parseInt((a.Price || '0').replace(/\D/g, '') || '0', 10);
      const pB = parseInt((b.Price || '0').replace(/\D/g, '') || '0', 10);
      return pB - pA;
    });
  }
}

function changeSort(val) {
  currentSort = val;
  sortUserList(allUsers);
  applyFilterAndSearch();
}

function updateMetrics() {
  const total = allUsers.length;
  let activeCount = 0;
  let expiredCount = 0;
  let revenue = 0;

  allUsers.forEach(u => {
    if (isUserExpired(u)) {
      expiredCount++;
    } else {
      activeCount++;
    }

    if (u.Price) {
      const match = u.Price.match(/(\d+)/);
      if (match) {
        revenue += parseInt(match[1], 10);
      }
    }
  });

  statTotalUsers.textContent = total;
  statActiveUsers.textContent = activeCount;
  statExpiredUsers.textContent = expiredCount;
  statRevenue.textContent = revenue.toLocaleString() + ' ฿';

  filterCountAll.textContent = total;
  filterCountActive.textContent = activeCount;
  filterCountExpired.textContent = expiredCount;
}

// ==========================================
// 5. FILTERING & SEARCH
// ==========================================

function setFilter(mode) {
  currentFilter = mode;
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.className = "filter-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all whitespace-nowrap";
  });

  const activeBtn = document.getElementById('filterBtn' + mode);
  if (activeBtn) {
    activeBtn.className = "filter-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-dark-800 border border-dark-600 shadow-sm transition-all whitespace-nowrap";
  }

  applyFilterAndSearch();
}

function handleSearch(query) {
  if (query && query.trim()) {
    clearSearchBtn.classList.remove('hidden');
  } else {
    clearSearchBtn.classList.add('hidden');
  }
  applyFilterAndSearch();
}

function clearSearch() {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  applyFilterAndSearch();
  searchInput.focus();
}

function applyFilterAndSearch() {
  const q = (searchInput.value || '').trim().toLowerCase();

  filteredUsers = allUsers.filter(u => {
    const expired = isUserExpired(u);
    if (currentFilter === 'ACTIVE' && expired) return false;
    if (currentFilter === 'EXPIRED' && !expired) return false;

    if (q) {
      const matchName = (u.Name || '').toLowerCase().includes(q);
      const matchKey = (u.Key || '').toLowerCase().includes(q);
      const matchNote = (u.AdminNote || '').toLowerCase().includes(q);
      const matchPrice = (u.Price || '').toLowerCase().includes(q);
      return matchName || matchKey || matchNote || matchPrice;
    }

    return true;
  });

  renderUsersList();
}

// ==========================================
// 6. RENDER LIST (NO LIMIT - ALL USERS DISPLAYED)
// ==========================================

function renderUsersList() {
  if (filteredUsers.length === 0) {
    userTableBody.innerHTML = '';
    userCardsMobile.innerHTML = '';
    renderEmptyState(
      searchInput.value.trim() 
        ? `No VIP users matching "${searchInput.value}"` 
        : `No ${currentFilter.toLowerCase()} VIP users currently in database.`
    );
    return;
  }

  emptyState.classList.add('hidden');

  // Render Desktop Table Rows
  userTableBody.innerHTML = filteredUsers.map((user) => {
    const expired = isUserExpired(user);
    const daysLeft = getDaysRemaining(user);
    const globalIdx = allUsers.indexOf(user);

    return `
      <tr class="hover:bg-dark-850/60 transition-colors group">
        <!-- Status -->
        <td class="py-3 px-4">
          ${expired 
            ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Expired
               </span>`
            : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active
               </span>`
          }
        </td>

        <!-- User Name -->
        <td class="py-3 px-4">
          <div class="font-bold text-white flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-dark-800 border border-dark-700 flex items-center justify-center text-xs font-bold text-cyan-400">
              ${(user.Name || 'U').charAt(0).toUpperCase()}
            </div>
            <span>${escapeHtml(user.Name)}</span>
          </div>
        </td>

        <!-- VIP Key -->
        <td class="py-3 px-4 font-mono text-xs">
          <div class="flex items-center gap-2">
            <span class="text-cyan-300 font-semibold bg-dark-950 px-2 py-1 rounded-md border border-dark-700 select-all">${escapeHtml(user.Key)}</span>
            <button onclick="copyToClipboard('${escapeHtml(user.Key)}', 'VIP Token')" title="Copy Key" class="p-1 rounded hover:bg-dark-800 text-slate-400 hover:text-cyan-400 transition-colors">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>

        <!-- Dates & Validity -->
        <td class="py-3 px-4">
          <div class="flex flex-col gap-0.5">
            <div class="text-slate-200 font-medium flex items-center gap-1.5">
              <span>${escapeHtml(user.Expiration || 'No Expiry')}</span>
              ${!expired 
                ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-semibold">${daysLeft}d left</span>`
                : `<span class="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-400 font-semibold">overdue</span>`
              }
            </div>
            <div class="text-[11px] text-slate-400">Start: ${escapeHtml(user.StartDate || '-')}</div>
          </div>
        </td>

        <!-- Price -->
        <td class="py-3 px-4 font-semibold text-amber-300">
          ${escapeHtml(user.Price || '0 ฿')}
        </td>

        <!-- Admin Note -->
        <td class="py-3 px-4">
          ${user.AdminNote 
            ? `<span class="px-2 py-0.5 rounded bg-dark-800 border border-dark-700/80 text-[11px] text-slate-300">${escapeHtml(user.AdminNote)}</span>`
            : `<span class="text-slate-400 text-[11px]">-</span>`
          }
        </td>

        <!-- Actions -->
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="quickRenew(${globalIdx})" title="Quick Renew +30 Days" class="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1 transition-all active:scale-95">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>+30d</span>
            </button>

            <button onclick="openEditModal(${globalIdx})" title="Edit User" class="p-1.5 rounded-lg bg-dark-800 hover:bg-dark-750 text-slate-300 hover:text-white transition-all">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>

            <button onclick="deleteUser(${globalIdx})" title="Revoke / Delete User" class="p-1.5 rounded-lg bg-dark-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Render Mobile Cards
  userCardsMobile.innerHTML = filteredUsers.map((user) => {
    const expired = isUserExpired(user);
    const daysLeft = getDaysRemaining(user);
    const globalIdx = allUsers.indexOf(user);

    return `
      <div class="p-4 space-y-3 bg-dark-900/60 hover:bg-dark-850/50 transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-dark-800 border border-dark-700 flex items-center justify-center font-bold text-cyan-400 text-xs">
              ${(user.Name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div class="font-bold text-white text-sm">${escapeHtml(user.Name)}</div>
              <div class="text-[11px] text-slate-400">Price: <span class="text-amber-300 font-semibold">${escapeHtml(user.Price || '0 ฿')}</span></div>
            </div>
          </div>
          
          <div>
            ${expired 
              ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Expired</span>`
              : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">${daysLeft}d left</span>`
            }
          </div>
        </div>

        <!-- Token Box -->
        <div class="flex items-center justify-between p-2 rounded-xl bg-dark-950 border border-dark-700/80">
          <span class="font-mono text-xs text-cyan-300 truncate mr-2">${escapeHtml(user.Key)}</span>
          <button onclick="copyToClipboard('${escapeHtml(user.Key)}', 'VIP Token')" class="shrink-0 px-2 py-1 rounded bg-dark-800 text-[11px] text-slate-300 hover:text-white flex items-center gap-1">
            <i data-lucide="copy" class="w-3 h-3"></i> Copy
          </button>
        </div>

        <!-- Dates & Notes -->
        <div class="flex items-center justify-between text-xs text-slate-400 pt-1">
          <div>Expires: <span class="text-slate-200 font-semibold">${escapeHtml(user.Expiration || '-')}</span></div>
          ${user.AdminNote ? `<span class="px-2 py-0.5 rounded bg-dark-800 text-[10px] text-slate-300 border border-dark-700">${escapeHtml(user.AdminNote)}</span>` : ''}
        </div>

        <!-- Mobile Actions -->
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-dark-800">
          <button onclick="quickRenew(${globalIdx})" class="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1 active:scale-95">
            <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> +30 Days
          </button>
          <button onclick="openEditModal(${globalIdx})" class="px-3 py-1.5 rounded-lg bg-dark-800 text-slate-300 text-xs font-medium">
            Edit
          </button>
          <button onclick="deleteUser(${globalIdx})" class="p-1.5 rounded-lg bg-dark-800 text-rose-400 text-xs">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function renderEmptyState(msg) {
  emptyState.classList.remove('hidden');
  document.getElementById('emptyStateDesc').textContent = msg;
  lucide.createIcons();
}

function showLoading(show) {
  if (show) {
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
  } else {
    loadingState.classList.add('hidden');
  }
}

// ==========================================
// 7. SAFE ADD / EDIT - FETCH FRESH FIRST!
// ==========================================

function openAddModal() {
  editingIndex = -1;
  document.getElementById('modalTitle').textContent = "Add VIP User";
  document.getElementById('btnSaveUserText').textContent = "Save User";
  document.getElementById('userForm').reset();

  generateRandomKey();
  const today = new Date();
  document.getElementById('inputStartDate').value = formatDate(today);
  
  const expiry = new Date(today);
  expiry.setDate(expiry.getDate() + 30);
  document.getElementById('inputExpiration').value = formatDate(expiry);
  document.getElementById('inputPrice').value = "50 ฿";
  document.getElementById('inputActive').checked = true;

  userModal.classList.remove('hidden');
  document.getElementById('inputName').focus();
  lucide.createIcons();
}

function openEditModal(globalIdx) {
  if (globalIdx < 0 || globalIdx >= allUsers.length) return;
  editingIndex = globalIdx;
  const user = allUsers[globalIdx];

  document.getElementById('modalTitle').textContent = "Edit VIP User";
  document.getElementById('btnSaveUserText').textContent = "Update User";

  document.getElementById('inputName').value = user.Name || '';
  document.getElementById('inputKey').value = user.Key || '';
  document.getElementById('inputStartDate').value = user.StartDate || formatDate(new Date());
  document.getElementById('inputExpiration').value = user.Expiration || '';
  document.getElementById('inputPrice').value = user.Price || '50 ฿';
  document.getElementById('inputNote').value = user.AdminNote || '';
  document.getElementById('inputActive').checked = user.active !== false;

  userModal.classList.remove('hidden');
  lucide.createIcons();
}

function closeUserModal() {
  userModal.classList.add('hidden');
}

function generateRandomKey() {
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  document.getElementById('inputKey').value = hex;
}

function setPresetDays(days) {
  const startStr = document.getElementById('inputStartDate').value.trim();
  let baseDate = parseDateString(startStr) || new Date();
  const newExp = new Date(baseDate);
  newExp.setDate(newExp.getDate() + days);
  document.getElementById('inputExpiration').value = formatDate(newExp);
}

function setPrice(price) {
  document.getElementById('inputPrice').value = price;
}

function setNote(note) {
  document.getElementById('inputNote').value = note;
}

// ATOMIC & SAFE FORM SUBMISSION:
// ALWAYS fetches latest database users first to prevent overwriting or losing ANY users!
async function handleFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('inputName').value.trim();
  const key = document.getElementById('inputKey').value.trim();
  const startDate = document.getElementById('inputStartDate').value.trim();
  const expiration = document.getElementById('inputExpiration').value.trim();
  const price = document.getElementById('inputPrice').value.trim() || '0 ฿';
  const note = document.getElementById('inputNote').value.trim();
  const active = document.getElementById('inputActive').checked;

  if (!name || !key || !expiration) {
    showToast("Please fill all required fields", "error");
    return;
  }

  const dStart = parseDateString(startDate) || new Date();
  const dExp = parseDateString(expiration) || new Date();
  const validDays = Math.max(0, Math.ceil((dExp.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24)));

  const saveBtn = document.getElementById('btnSaveUser');
  saveBtn.disabled = true;
  saveBtn.classList.add('opacity-70');

  try {
    const updatedUserObj = {
      Key: key,
      id: key,
      device_id: key,
      Name: name,
      name: name,
      Price: price,
      price: price,
      StartDate: startDate,
      start_date: startDate,
      Expiration: expiration,
      expiration_date: expiration,
      Valid: validDays,
      valid: validDays,
      AdminNote: note,
      admin_note: note,
      active: active
    };

    // 1. ATOMIC: Fetch latest live users directly from Firebase
    let liveList = [];
    try {
      liveList = await fetchLiveUsersDirectly();
    } catch (e) {
      console.warn("Could not fetch fresh live list, falling back to local list:", e);
      liveList = [...allUsers];
    }

    if (editingIndex >= 0 && editingIndex < allUsers.length) {
      const editTargetKey = allUsers[editingIndex].Key;
      const targetInLive = liveList.findIndex(u => u.Key.toLowerCase() === editTargetKey.toLowerCase());
      if (targetInLive >= 0) {
        liveList[targetInLive] = { ...liveList[targetInLive], ...updatedUserObj };
      } else {
        liveList.unshift(updatedUserObj);
      }
    } else {
      // Check duplicate in live database
      const existingIdx = liveList.findIndex(u => u.Key.toLowerCase() === key.toLowerCase());
      if (existingIdx >= 0) {
        if (!confirm(`Token Key "${key}" already exists for "${liveList[existingIdx].Name}". Update this user?`)) {
          saveBtn.disabled = false;
          saveBtn.classList.remove('opacity-70');
          return;
        }
        liveList[existingIdx] = { ...liveList[existingIdx], ...updatedUserObj };
      } else {
        // Prepend so newly added VIP user is right at index 0!
        liveList.unshift(updatedUserObj);
      }
    }

    // 2. Save entire merged list to Firebase
    await saveToFirebase(liveList);
    closeUserModal();
    showToast(editingIndex >= 0 ? "User updated successfully!" : "New VIP user added!", "success");
    await loadUsers();
  } catch (err) {
    console.error("Save error:", err);
    showToast(`Save failed: ${err.message}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove('opacity-70');
  }
}

// ==========================================
// 8. QUICK RENEW (+30 DAYS) - SAFE LIVE MERGE
// ==========================================

async function quickRenew(globalIdx) {
  if (globalIdx < 0 || globalIdx >= allUsers.length) return;
  const user = allUsers[globalIdx];

  const today = new Date();
  let baseDate = today;

  const currentExp = parseDateString(user.Expiration);
  if (currentExp && currentExp > today) {
    baseDate = currentExp;
  }

  const newExp = new Date(baseDate);
  newExp.setDate(newExp.getDate() + 30);
  const newExpStr = formatDate(newExp);

  if (!confirm(`Renew subscription for "${user.Name}" (+30 days)?\nNew Expiration: ${newExpStr}`)) {
    return;
  }

  showToast(`Renewing ${user.Name}...`, "info");

  try {
    let liveList = await fetchLiveUsersDirectly();
    const targetIdx = liveList.findIndex(u => u.Key.toLowerCase() === user.Key.toLowerCase());

    const updated = {
      ...user,
      Expiration: newExpStr,
      expiration_date: newExpStr,
      active: true,
      Valid: (user.Valid || 0) + 30
    };

    if (targetIdx >= 0) {
      liveList[targetIdx] = { ...liveList[targetIdx], ...updated };
    } else {
      liveList.unshift(updated);
    }

    await saveToFirebase(liveList);
    showToast(`"${user.Name}" renewed until ${newExpStr}!`, "success");
    await loadUsers();
  } catch (err) {
    console.error("Renew error:", err);
    showToast(`Renewal failed: ${err.message}`, "error");
  }
}

// ==========================================
// 9. DELETE / REVOKE USER - SAFE LIVE MERGE
// ==========================================

async function deleteUser(globalIdx) {
  if (globalIdx < 0 || globalIdx >= allUsers.length) return;
  const user = allUsers[globalIdx];

  if (!confirm(`Are you sure you want to REVOKE and DELETE "${user.Name}"?\nToken: ${user.Key}\nThis action cannot be undone.`)) {
    return;
  }

  showToast(`Deleting ${user.Name}...`, "info");

  try {
    let liveList = await fetchLiveUsersDirectly();
    liveList = liveList.filter(u => u.Key.toLowerCase() !== user.Key.toLowerCase());

    await saveToFirebase(liveList);
    showToast(`User "${user.Name}" removed from database`, "success");
    await loadUsers();
  } catch (err) {
    console.error("Delete error:", err);
    showToast(`Delete failed: ${err.message}`, "error");
  }
}

// ==========================================
// 10. SAVE TO FIREBASE REALTIME DATABASE (PUT)
// ==========================================

async function saveToFirebase(userList) {
  const url = getDbUrl();

  // Strip internal _original property before writing to DB
  const cleanArray = userList.map(u => {
    const clone = { ...(u._original || u) };
    delete clone._original;
    return clone;
  });

  // Always write clean JSON array directly to endpoint
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(cleanArray)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Firebase error (${res.status}): ${errorText || res.statusText}`);
  }

  return await res.json();
}

// ==========================================
// 11. EXPORT TO JSON / CSV
// ==========================================

function exportData(format) {
  if (allUsers.length === 0) {
    showToast("No data to export", "error");
    return;
  }

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const exportClean = allUsers.map(u => {
      const c = { ...(u._original || u) };
      delete c._original;
      return c;
    });

    const jsonStr = JSON.stringify(exportClean, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mzz_vip_users_backup_${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("JSON backup downloaded", "success");
  }
}

async function clearAllUsers() {
  if (allUsers.length === 0) {
    showToast("Database is already empty", "info");
    return;
  }

  const confirmed = confirm(
    `⚠️ DANGER: Are you sure you want to DELETE ALL ${allUsers.length} VIP users?\n\n` +
    `A backup JSON file will be downloaded to your computer automatically before clearing.`
  );

  if (!confirmed) return;

  // 1. Auto backup first
  exportData('json');

  showToast("Clearing all VIP users from database...", "info");

  try {
    const url = getDbUrl();
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify([])
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firebase error (${res.status}): ${err}`);
    }

    showToast("All VIP users have been cleared!", "success");
    await loadUsers();
  } catch (err) {
    console.error("Clear error:", err);
    showToast(`Clear failed: ${err.message}`, "error");
  }
}

// ==========================================
// 12. SETTINGS & UTILS
// ==========================================

function openSettingsModal() {
  document.getElementById('inputDbUrl').value = getDbUrl();
  settingsModal.classList.remove('hidden');
  lucide.createIcons();
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

function saveDbSettings() {
  const url = document.getElementById('inputDbUrl').value.trim();
  if (!url || !url.startsWith('http')) {
    showToast("Please enter a valid HTTP/HTTPS database URL", "error");
    return;
  }
  setDbUrl(url);
  closeSettingsModal();
  showToast("Database endpoint updated", "success");
  loadUsers();
}

function resetDbUrl() {
  document.getElementById('inputDbUrl').value = DEFAULT_RTDB_URL;
}

function copyToClipboard(text, label) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label || 'Text'} copied to clipboard!`, "success");
  }).catch(() => {
    window.prompt("Copy token manually:", text);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Toast Notifications System
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClasses = type === 'success' 
    ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200'
    : type === 'error'
    ? 'bg-rose-950/95 border-rose-500/40 text-rose-200'
    : 'bg-dark-900/95 border-cyan-500/40 text-cyan-200';

  const iconName = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'info');

  toast.className = `flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md text-xs sm:text-sm font-medium transition-all pointer-events-auto transform translate-y-2 opacity-0 ${bgClasses}`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons({ root: toast });

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// 13. APP ENTRYPOINT
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  updateDbStatusUI();
  lucide.createIcons();
  loadUsers();
});
