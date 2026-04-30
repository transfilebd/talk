// ═══════════════════════════════════════════════════════════
//  ui.js  —  UI Helpers: toast, screens, theme, video grid,
//             draggable PiP
// ═══════════════════════════════════════════════════════════

// ── Toast ─────────────────────────────────────────────────
const TOAST_ICONS = {
  success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`,
  error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#00e5ff"/></svg>`,
  warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="#f59e0b"/></svg>`,
};

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || ''}<span>${message}</span>`;
  container.appendChild(toast);
  const remove = () => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ── Screen Navigation ─────────────────────────────────────
const SCREENS = {
  home:    document.getElementById('screen-home'),
  waiting: document.getElementById('screen-waiting'),
  call:    document.getElementById('screen-call'),
};

function showScreen(name) {
  Object.entries(SCREENS).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ── Connection Badge ──────────────────────────────────────
const connBadge  = document.getElementById('connection-badge');
const badgeLabel = connBadge.querySelector('.badge-label');

function setConnectionStatus(status) {
  connBadge.className = `conn-badge badge-${status}`;
  const labels = { idle: 'Offline', connecting: 'Connecting…', connected: 'Connected', failed: 'Failed' };
  badgeLabel.textContent = labels[status] || status;
}

// ── Peer Count Badge ──────────────────────────────────────
const peerCountBadge = document.getElementById('peer-count-badge');
const peerCountNum   = document.getElementById('peer-count-num');

function updatePeerCount(count) {
  peerCountNum.textContent = count;
  peerCountBadge.classList.toggle('hidden', count === 0);
}

// ── Theme Toggle ──────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle');
const iconSun  = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.style.display  = theme === 'light' ? 'block' : 'none';
  iconMoon.style.display = theme === 'dark'  ? 'block' : 'none';
  localStorage.setItem('p2ptalk_theme', theme);
}
applyTheme(localStorage.getItem('p2ptalk_theme') || 'dark');
themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ══════════════════════════════════════════════════════════
//  Conference Video Grid
// ══════════════════════════════════════════════════════════

const peersGrid   = document.getElementById('peers-grid');
const noPeersMsg  = document.getElementById('no-peers-msg');

// Map of peerId → tile element
const peerTiles = {};

function addPeerTile(peerId, name) {
  if (peerTiles[peerId]) return;

  noPeersMsg.style.display = 'none';

  const tile = document.createElement('div');
  tile.className = 'peer-tile';
  tile.id = `tile-${peerId}`;

  const initial = (name || 'P').charAt(0).toUpperCase();

  tile.innerHTML = `
    <video class="peer-video" id="vid-${peerId}" autoplay playsinline></video>
    <div class="peer-avatar" id="avatar-${peerId}">
      <div class="avatar-circle">${initial}</div>
    </div>
    <div class="peer-label">
      <span>${escapeHtml(name || 'Peer')}</span>
      <div class="peer-audio-icon" id="audio-${peerId}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/></svg>
      </div>
    </div>
    <div class="tile-connecting">
      <div class="tile-spinner"></div>
    </div>
  `;

  peersGrid.appendChild(tile);
  peerTiles[peerId] = tile;
  updateGridLayout();
}

function setPeerStream(peerId, stream) {
  const vid = document.getElementById(`vid-${peerId}`);
  const avatar = document.getElementById(`avatar-${peerId}`);
  const tile = peerTiles[peerId];
  if (!vid) return;

  vid.srcObject = stream;

  // Hide connecting overlay
  const connecting = tile ? tile.querySelector('.tile-connecting') : null;
  if (connecting) connecting.style.display = 'none';

  // Show/hide avatar
  const hasVid = stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
  if (avatar) avatar.style.display = hasVid ? 'none' : 'flex';

  stream.getVideoTracks().forEach(track => {
    track.onended   = () => { if (avatar) avatar.style.display = 'flex'; };
    track.onmute    = () => { if (avatar) avatar.style.display = 'flex'; };
    track.onunmute  = () => { if (avatar) avatar.style.display = 'none'; };
  });
}

function removePeerTile(peerId) {
  const tile = peerTiles[peerId];
  if (tile) {
    tile.classList.add('tile-leaving');
    setTimeout(() => {
      tile.remove();
      delete peerTiles[peerId];
      updateGridLayout();
      if (Object.keys(peerTiles).length === 0) {
        noPeersMsg.style.display = 'flex';
        noPeersMsg.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <p>Waiting for others to join…</p>
        `;
      }
    }, 350);
  }
}

function clearAllPeerTiles() {
  Object.keys(peerTiles).forEach(pid => {
    const tile = peerTiles[pid];
    if (tile) tile.remove();
    delete peerTiles[pid];
  });
  noPeersMsg.style.display = 'flex';
  noPeersMsg.innerHTML = `<div class="overlay-spinner"></div><p>Connecting to peers…</p>`;
}

function updateGridLayout() {
  const count = Object.keys(peerTiles).length;
  peersGrid.setAttribute('data-count', count);
}

// ── Draggable PiP ─────────────────────────────────────────
(function initDraggablePip() {
  const pip = document.getElementById('local-pip');
  if (!pip) return;

  let dragging = false;
  let startX, startY, origLeft, origTop;

  function getPos() {
    const rect = pip.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function onPointerDown(e) {
    // Don't drag on video element itself (allow tap-to-fullscreen etc)
    dragging = true;
    const pos = getPos();
    origLeft = pos.left;
    origTop  = pos.top;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;

    pip.style.transition = 'none';
    pip.classList.add('dragging');

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = clientX - startX;
    const dy = clientY - startY;

    const area = document.getElementById('video-area');
    const areaRect = area.getBoundingClientRect();
    const pipRect  = pip.getBoundingClientRect();

    const newLeft = clamp(origLeft + dx - areaRect.left, 0, areaRect.width  - pipRect.width);
    const newTop  = clamp(origTop  + dy - areaRect.top,  0, areaRect.height - pipRect.height);

    pip.style.left   = newLeft + 'px';
    pip.style.top    = newTop  + 'px';
    pip.style.right  = 'auto';
    pip.style.bottom = 'auto';
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    pip.style.transition = '';
    pip.classList.remove('dragging');
  }

  // Mouse
  pip.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup',   onPointerUp);

  // Touch
  pip.addEventListener('touchstart',  onPointerDown, { passive: false });
  window.addEventListener('touchmove',  onPointerMove, { passive: false });
  window.addEventListener('touchend',   onPointerUp);
})();

// ── Utility ───────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
