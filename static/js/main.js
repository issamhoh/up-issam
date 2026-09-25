/**
 * HOSTX VIP — CLIENT CONTROLS & LIVE TERMINAL LOG ENGINE
 * High-performance, memory-leak free polling & async UI updates
 */

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;

  let icon = '✓';
  if (type === 'danger') icon = '✕';
  else if (type === 'warning') icon = '⚠️';

  // textContent, never innerHTML: server messages can contain user-controlled text
  const iconEl = document.createElement('span');
  iconEl.textContent = icon;
  const textEl = document.createElement('span');
  textEl.textContent = String(message == null ? '' : message);
  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 3500);
}

// Global Server Operation Controller
async function executeServerAction(serverId, action) {
  const startBtn = document.getElementById('btn-start-server');
  const stopBtn = document.getElementById('btn-stop-server');
  const restartBtn = document.getElementById('btn-restart-server');
  
  // Disable buttons while executing action
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  if (restartBtn) restartBtn.disabled = true;

  try {
    const res = await fetch(`/api/servers/${serverId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });

    const data = await res.json();

    if (data.no_entry_file) {
      const modal = document.getElementById('no-entry-modal');
      if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
      return;
    }

    if (data.package_required) {
      showToast(data.message || 'Required python packages missing!', 'warning');
      updateServerUIStatus('package_required', 0);
      return;
    }

    if (data.success) {
      showToast(data.message || 'Operation completed.', 'success');
      updateServerUIStatus(data.status, data.pid);
    } else {
      showToast(data.message || 'Action failed.', 'danger');
    }
  } catch (err) {
    showToast('Network error executing server command.', 'danger');
  } finally {
    // Re-enable buttons based on status
    setTimeout(() => refreshServerButtons(), 400);
  }
}

// Update UI badges and status (works with both the legacy .status-badge and the
// dark .vh-chip markup — state is read from data-status, never from text)
function updateServerUIStatus(status, pid) {
  const badge = document.getElementById('server-status-badge');
  const pidBadge = document.getElementById('server-pid-badge');
  const cardDot = document.getElementById('card-status-dot');
  const cardText = document.getElementById('card-status-text');

  const running = status === 'running';
  const expired = status === 'expired';
  const pkgNeeded = status === 'package_required';

  if (badge) {
    badge.dataset.status = status;
    const label = running ? 'Running' : (pkgNeeded ? 'Packages needed' : (expired ? 'Expired' : 'Stopped'));
    const labelEl = badge.querySelector('.vh-chip-text');
    if (labelEl) {
      labelEl.textContent = label;
    } else {
      badge.textContent = (running ? '🟢 ' : (pkgNeeded ? '🟡 ' : '🔴 ')) + label.toUpperCase();
    }
    badge.className = 'vh-chip ' + (running ? 'vh-chip-ok vh-chip-pulse' : (pkgNeeded ? 'vh-chip-warn' : 'vh-chip-bad'));
  }

  if (pidBadge) {
    pidBadge.dataset.running = running && pid ? '1' : '0';
    pidBadge.textContent = running && pid ? `PID: ${pid}` : 'PID: Offline';
    pidBadge.className = 'vh-chip vh-mono ' + (running && pid ? 'vh-chip-ok' : '');
  }

  if (cardDot && cardText) {
    cardDot.style.background = running ? 'var(--vh-ok, #22C55E)' : 'var(--vh-bad, #EF4444)';
    cardText.style.color = running ? 'var(--vh-ok, #22C55E)' : 'var(--vh-bad, #EF4444)';
    cardText.textContent = running ? 'Running' : 'Offline';
  }

  refreshServerButtons();
}

function refreshServerButtons() {
  const badge = document.getElementById('server-status-badge');
  const startBtn = document.getElementById('btn-start-server');
  const stopBtn = document.getElementById('btn-stop-server');
  const restartBtn = document.getElementById('btn-restart-server');

  const isRunning = badge ? badge.dataset.status === 'running' : false;

  if (startBtn) {
    startBtn.disabled = isRunning;
    startBtn.style.opacity = isRunning ? '0.5' : '1';
    startBtn.style.cursor = isRunning ? 'not-allowed' : 'pointer';
  }
  if (stopBtn) {
    stopBtn.disabled = !isRunning;
    stopBtn.style.opacity = !isRunning ? '0.5' : '1';
    stopBtn.style.cursor = !isRunning ? 'not-allowed' : 'pointer';
  }
  if (restartBtn) {
    restartBtn.disabled = false;
    restartBtn.style.opacity = '1';
    restartBtn.style.cursor = 'pointer';
  }
}

// Live Logs Streamer & Uptime Counter
let logPollingInterval = null;
let uptimeTimerInterval = null;

function startLiveLogs(serverId, initialStatus, serverStartTime) {
  const terminal = document.getElementById('live-terminal');
  if (!terminal) return;

  let lastLogText = '';

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/logs`);
      const data = await res.json();

      if (data.raw_logs && data.raw_logs !== lastLogText) {
        lastLogText = data.raw_logs;
        formatAndDisplayLogs(terminal, data.raw_logs);
      }

      if (data.status) {
        updateServerUIStatus(data.status, data.pid);
      }

      // Update uptime start reference if running
      if (data.status === 'running' && data.start_time) {
        initUptimeCounter(data.start_time);
      } else {
        resetUptimeCounter();
      }
    } catch (e) {
      // Network hiccup - ignore and retry next cycle
    }
  };

  fetchLogs();
  if (logPollingInterval) clearInterval(logPollingInterval);
  logPollingInterval = setInterval(fetchLogs, 2500);

  if (initialStatus === 'running' && serverStartTime > 0) {
    initUptimeCounter(serverStartTime);
  }
}

function formatAndDisplayLogs(terminal, rawText) {
  const lines = rawText.split('\n');
  terminal.innerHTML = '';

  const fragment = document.createDocumentFragment();

  lines.forEach(line => {
    if (!line.trim()) return;
    const div = document.createElement('div');
    div.className = 'log-line';

    if (line.includes('[ERROR]') || line.includes('Error:') || line.includes('Traceback')) {
      div.className += ' log-error';
    } else if (line.includes('[WARNING]') || line.includes('Warning:')) {
      div.className += ' log-warning';
    } else if (line.includes('[INFO]') || line.includes('SUCCESS')) {
      div.className += ' log-info';
    } else {
      div.className += ' log-dim';
    }

    div.textContent = line;
    fragment.appendChild(div);
  });

  terminal.appendChild(fragment);
  terminal.scrollTop = terminal.scrollHeight;
}

// Clear Terminal Logs
async function clearLogs(serverId) {
  try {
    const res = await fetch(`/api/servers/${serverId}/logs/clear`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const terminal = document.getElementById('live-terminal');
      if (terminal) {
        terminal.textContent = '';
        const line = document.createElement('div');
        line.className = 'log-line log-info';
        line.textContent = '[INFO] Logs cleared.';
        terminal.appendChild(line);
      }
      showToast('Logs cleared.', 'success');
    }
  } catch (e) {
    showToast('Failed to clear logs.', 'danger');
  }
}

// Uptime Realtime Tick Counter
function initUptimeCounter(startTimeSecs) {
  if (uptimeTimerInterval) clearInterval(uptimeTimerInterval);
  const counterEl = document.getElementById('card-uptime-counter');
  if (!counterEl) return;

  function tick() {
    const now = Date.now() / 1000;
    let diff = Math.max(0, Math.floor(now - startTimeSecs));

    const hrs = Math.floor(diff / 3600);
    diff %= 3600;
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;

    counterEl.textContent = 
      String(hrs).padStart(2, '0') + ':' +
      String(mins).padStart(2, '0') + ':' +
      String(secs).padStart(2, '0');
  }

  tick();
  uptimeTimerInterval = setInterval(tick, 1000);
}

function resetUptimeCounter() {
  if (uptimeTimerInterval) clearInterval(uptimeTimerInterval);
  const counterEl = document.getElementById('card-uptime-counter');
  if (counterEl) counterEl.textContent = '00:00:00';
}

// Daily Coins Claim Function
async function claimDailyCoins() {
  const btn = document.getElementById('claim-daily-btn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/coins/claim-daily', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      document.querySelectorAll('.user-coin-val').forEach(el => {
        el.textContent = data.new_balance;
      });
      if (btn) {
        btn.textContent = '✓ Claimed for Today';
        btn.style.background = '#10B981';
      }
      setTimeout(() => location.reload(), 1500);
    } else {
      showToast(data.message || 'Already claimed today!', 'warning');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast('Error claiming coins.', 'danger');
    if (btn) btn.disabled = false;
  }
}

// Notifications Bell Engine
async function onNotificationBellClick(e) {
  e.stopPropagation();
  const popover = document.getElementById('notif-popover');
  const wrapper = document.getElementById('notif-wrapper');
  if (!popover || !wrapper) return;

  const isOpen = wrapper.classList.contains('show');
  if (isOpen) {
    wrapper.classList.remove('show');
  } else {
    wrapper.classList.add('show');
    loadNotifications();
  }
}

async function loadNotifications() {
  const container = document.getElementById('notif-list-container');
  const badge = document.getElementById('notif-badge');
  if (!container) return;

  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();

    if (data.notifications && data.notifications.length > 0) {
      container.innerHTML = '';
      data.notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = `notif-item ${n.is_read ? '' : 'unread'}`;

        // Built with DOM nodes (not innerHTML) so admin/user supplied text can't inject markup
        const icon = document.createElement('div');
        icon.style.fontSize = '1.1rem';
        icon.textContent = '🔔';

        const body = document.createElement('div');
        body.style.flex = '1';

        const title = document.createElement('div');
        title.className = 'notif-item-title';
        title.textContent = n.title || '';

        const msg = document.createElement('div');
        msg.className = 'notif-item-msg';
        msg.textContent = n.message || '';

        const time = document.createElement('div');
        time.className = 'notif-item-time';
        time.textContent = n.created_at || '';

        body.appendChild(title);
        body.appendChild(msg);
        body.appendChild(time);
        item.appendChild(icon);
        item.appendChild(body);
        container.appendChild(item);
      });
    } else {
      container.innerHTML = '<div style="text-align: center; color: #94A3B8; font-size: 0.85rem; padding: 24px;">No notifications yet.</div>';
    }

    if (badge) {
      if (data.unread_count > 0) {
        badge.textContent = data.unread_count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Auto mark as read on open
    fetch('/api/notifications/mark-read', { method: 'POST' });
  } catch (err) {
    container.innerHTML = '<div style="text-align: center; color: #EF4444; font-size: 0.85rem; padding: 20px;">Failed to load notifications.</div>';
  }
}

async function clearAllNotifications(e) {
  e.stopPropagation();
  try {
    const res = await fetch('/api/notifications/clear-all', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('notif-list-container');
      const badge = document.getElementById('notif-badge');
      if (container) container.innerHTML = '<div style="text-align: center; color: #94A3B8; font-size: 0.85rem; padding: 24px;">All caught up!</div>';
      if (badge) badge.style.display = 'none';
      showToast('All notifications cleared.', 'success');
    }
  } catch (err) {
    showToast('Failed to clear notifications.', 'danger');
  }
}

// Close Dropdowns on Click Outside
document.addEventListener('click', (e) => {
  document.querySelectorAll('.dropdown-menu-wrapper.show').forEach(wrapper => {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove('show');
    }
  });
});

// Auto Check Unread Notifications on page load
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('notif-badge');
  if (badge) {
    fetch('/api/notifications')
      .then(res => res.json())
      .then(data => {
        if (data.unread_count > 0) {
          badge.textContent = data.unread_count;
          badge.style.display = 'flex';
        }
      })
      .catch(() => {});
  }
});
