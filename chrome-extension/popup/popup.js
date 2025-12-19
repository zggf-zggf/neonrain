const BACKEND_URL = 'http://localhost:3000';

let capturedToken = null;
let countdownInterval = null;
let claimCode = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('capture-btn').addEventListener('click', captureToken);
  document.getElementById('retry-btn').addEventListener('click', resetUI);
  document.getElementById('copy-btn').addEventListener('click', copyCode);
});

async function captureToken() {
  const captureBtn = document.getElementById('capture-btn');
  const statusEl = document.getElementById('status');

  captureBtn.disabled = true;
  statusEl.textContent = 'Checking Discord tab...';
  statusEl.classList.remove('hidden');

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('discord.com')) {
      showError('Please open Discord in your browser first.\n\nGo to discord.com and log in, then try again.');
      return;
    }

    statusEl.textContent = 'Capturing token...';

    // Send message to content script to start capture
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_DISCORD_CAPTURE' });
      // Token will be received via message listener below
    } catch (msgErr) {
      console.error('[Popup] Failed to send message:', msgErr);
      showError('Content script not loaded.\n\n1. Refresh the Discord page (Ctrl+R)\n2. Wait 2 seconds\n3. Try again');
    }
  } catch (err) {
    console.error('[Popup] Error:', err);
    showError('Failed to capture token: ' + err.message);
  }
}

// Listen for token from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'DISCORD_TOKEN_READY') {
    console.log('[Popup] Received token from content script');
    capturedToken = request.token;
    submitToken(capturedToken);
    sendResponse({ success: true });
  }
  return true;
});

async function submitToken(token) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Submitting token...';

  try {
    const response = await fetch(`${BACKEND_URL}/api/discord/submit-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordToken: token })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to submit token');
    }

    console.log('[Popup] Token submitted, claim code:', data.claimCode);
    showClaimCode(data.claimCode, data.expiresAt);
  } catch (err) {
    console.error('[Popup] Submit error:', err);
    showError(err.message || 'Failed to connect to backend.\n\nMake sure the backend server is running.');
  }
}

function showClaimCode(code, expiresAt) {
  claimCode = code;

  document.getElementById('capture-section').classList.add('hidden');
  document.getElementById('error-section').classList.add('hidden');
  document.getElementById('code-section').classList.remove('hidden');
  document.getElementById('claim-code').textContent = code;

  // Start countdown
  const expiryTime = new Date(expiresAt).getTime();
  updateCountdown(expiryTime);

  countdownInterval = setInterval(() => {
    const remaining = updateCountdown(expiryTime);
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      showError('Code expired. Please try again.');
    }
  }, 1000);
}

function updateCountdown(expiryTime) {
  const now = Date.now();
  const remaining = Math.max(0, expiryTime - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  document.getElementById('countdown').textContent =
    `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return remaining;
}

function showError(message) {
  document.getElementById('capture-section').classList.add('hidden');
  document.getElementById('code-section').classList.add('hidden');
  document.getElementById('error-section').classList.remove('hidden');
  document.getElementById('error-message').textContent = message;

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function resetUI() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  document.getElementById('capture-section').classList.remove('hidden');
  document.getElementById('code-section').classList.add('hidden');
  document.getElementById('error-section').classList.add('hidden');
  document.getElementById('status').classList.add('hidden');
  document.getElementById('capture-btn').disabled = false;

  capturedToken = null;
  claimCode = null;
}

async function copyCode() {
  if (!claimCode) return;

  try {
    await navigator.clipboard.writeText(claimCode);

    const copyBtn = document.getElementById('copy-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copy-success');

    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.classList.remove('copy-success');
    }, 2000);
  } catch (err) {
    console.error('[Popup] Failed to copy:', err);
  }
}
