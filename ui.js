// ═══════════════════════════════════════════════════════════
//  ui.js  —  UI Helpers: toast, screen, theme, connection badge
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

// ── Theme Toggle ──────────────────────────────────────────

const themeBtn = document.getElementById('theme-toggle');
const iconSun  = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.style.display  = theme === 'light' ? 'block' : 'none';
  iconMoon.style.display = theme === 'dark'  ? 'block' : 'none';
  localStorage.setItem('p2pcall_theme', theme);
}
applyTheme(localStorage.getItem('p2pcall_theme') || 'dark');
themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ── Utility ───────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
