// script.js

// ─── Double-click logout ──────────────────────────────────────────────────────
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  let clicks = 0;
  logoutBtn.addEventListener('click', () => {
    clicks++;
    if (clicks === 1) {
      logoutBtn.innerText = '⚠️ Click again to confirm';
      setTimeout(() => {
        clicks = 0;
        logoutBtn.innerText = '🚪 Logout';
      }, 2500);
    } else {
      fetch('/logout', { method: 'POST' })
        .then(() => window.location.href = '/');
    }
  });
}

// ─── Live recipient counter ───────────────────────────────────────────────────
const rcEl    = document.getElementById('recipients');
const rcCount = document.getElementById('rcCount');
if (rcEl && rcCount) {
  rcEl.addEventListener('input', () => {
    const count = rcEl.value
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r)).length;
    rcCount.innerText   = count + ' recipient' + (count !== 1 ? 's' : '');
    rcCount.style.color = count > 500 ? '#ef4444' : '#10b981';
  });
}

// ─── Send ─────────────────────────────────────────────────────────────────────
document.getElementById('sendBtn')?.addEventListener('click', () => {
  const senderName = document.getElementById('senderName').value.trim();
  const email      = document.getElementById('email').value.trim();
  const password   = document.getElementById('pass').value.trim();
  const subject    = document.getElementById('subject').value.trim();
  const message    = document.getElementById('message').value.trim();
  const recipients = document.getElementById('recipients').value.trim();
  const status     = document.getElementById('statusMessage');
  const btn        = document.getElementById('sendBtn');

  if (!email || !password || !recipients) {
    status.innerText   = '❌ Gmail, App Password and Recipients required';
    status.style.color = '#ef4444';
    return;
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(email)) {
    status.innerText   = '❌ Enter a valid Gmail address';
    status.style.color = '#ef4444';
    return;
  }
  const count = recipients.split(/[\n,]+/).map(r=>r.trim()).filter(r=>emailRe.test(r)).length;
  if (count === 0) { status.innerText = '❌ No valid emails found'; status.style.color='#ef4444'; return; }
  if (count > 500) { status.innerText = '❌ Max 500 recipients'; status.style.color='#ef4444'; return; }

  btn.disabled       = true;
  btn.innerText      = '⏳ Sending...';
  status.innerText   = `📤 Sending to ${count} recipients...`;
  status.style.color = '#3b82f6';

  fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, email, password, subject, message, recipients })
  })
  .then(r => r.json())
  .then(data => {
    status.innerText   = data.message;
    status.style.color = data.success ? '#10b981' : '#ef4444';
    btn.disabled  = false;
    btn.innerText = '🚀 Send All';
    if (data.success) alert(data.message);
  })
  .catch(err => {
    status.innerText   = '❌ Network error: ' + err.message;
    status.style.color = '#ef4444';
    btn.disabled  = false;
    btn.innerText = '🚀 Send All';
  });
});
