<script>
  import { onMount } from 'svelte';

  const BACKEND_URL = 'http://localhost:3000';

  let isLoggedIn = false;
  let isRegistering = false;
  let email = '';
  let password = '';
  let error = '';
  let loading = false;
  let backendStatus = 'checking';
  let backendMessage = 'Checking backend connection...';
  let userEmail = '';
  let discordConnected = false;
  let connectingDiscord = false;
  let discordStatusMessage = '';
  let successMessage = '';

  // Check backend health
  async function checkBackendHealth() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/status`);
      const data = await response.json();

      if (data.online) {
        backendStatus = 'online';
        backendMessage = 'Backend connected';
      } else {
        backendStatus = 'offline';
        backendMessage = 'Backend offline';
      }
    } catch (err) {
      backendStatus = 'offline';
      backendMessage = 'Cannot connect to backend';
    }
  }

  onMount(() => {
    checkBackendHealth();
    checkAuth();

    // Listen for token from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'DISCORD_TOKEN_READY') {
        console.log('[Discord Connect] Token received from content script!');
        handleTokenReceived(request.token);
        sendResponse({ success: true });
      }
      return true;
    });
  });

  async function checkDiscordStatus() {
    const authToken = await getAuthToken();
    if (!authToken) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/status`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        discordConnected = data.connected;
      }
    } catch (err) {
      console.error('Failed to check Discord status:', err);
    }
  }

  async function getAuthToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['authToken'], (result) => {
        resolve(result.authToken);
      });
    });
  }

  // Check if user is already logged in
  function checkAuth() {
    chrome.storage.local.get(['authToken', 'userEmail'], (result) => {
      if (result.authToken) {
        isLoggedIn = true;
        userEmail = result.userEmail || 'User';
        checkDiscordStatus();
      }
    });
  }

  async function handleTokenReceived(discordToken) {
    discordStatusMessage = 'Token captured! Saving to backend...';

    const authToken = await getAuthToken();
    console.log('[Discord Connect] Sending token to backend...');

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ discordToken })
      });

      console.log('[Discord Connect] Backend response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[Discord Connect] Success!', data);
        discordConnected = true;
        successMessage = 'Discord connected successfully!';
        connectingDiscord = false;
        discordStatusMessage = '';

        // Clear success message after 3 seconds
        setTimeout(() => {
          successMessage = '';
        }, 3000);
      } else {
        const data = await response.json();
        console.error('[Discord Connect] Backend error:', data);
        error = `Backend error: ${data.error || 'Failed to connect Discord'}`;
        connectingDiscord = false;
        discordStatusMessage = '';
      }
    } catch (fetchErr) {
      console.error('[Discord Connect] Fetch error:', fetchErr);
      error = 'Cannot connect to backend. Make sure backend is running.';
      connectingDiscord = false;
      discordStatusMessage = '';
    }
  }

  async function handleConnectDiscord() {
    connectingDiscord = true;
    error = '';
    successMessage = '';
    discordStatusMessage = 'Checking current tab...';

    try {
      // Query the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[Discord Connect] Current tab:', tab.url);

      // Check if we're on Discord
      if (!tab.url || !tab.url.includes('discord.com')) {
        error = 'Please open Discord in your browser first, then click Connect Discord';
        discordStatusMessage = '';
        connectingDiscord = false;
        return;
      }

      discordStatusMessage = 'Capturing Discord token...';
      console.log('[Discord Connect] Tab ID:', tab.id, 'URL:', tab.url);

      // Send message to content script to start capture
      try {
        console.log('[Discord Connect] Sending START_DISCORD_CAPTURE message...');
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_DISCORD_CAPTURE' });
        console.log('[Discord Connect] Content script responded:', response);

        // If token was already ready, it will be sent via DISCORD_TOKEN_READY message
        // The handleTokenReceived function will handle it
      } catch (msgErr) {
        console.error('[Discord Connect] Failed to send message:', msgErr);
        error = `Content script not loaded on Discord page. Error: ${msgErr.message}.

Instructions:
1. Make sure you're on discord.com (not the app)
2. Refresh the Discord page (Ctrl+R or Cmd+R)
3. Wait 2 seconds after refresh
4. Try clicking Connect Discord again

If this still doesn't work, check the Console for errors.`;
        discordStatusMessage = '';
        connectingDiscord = false;
        return;
      }

    } catch (err) {
      console.error('[Discord Connect] Error:', err);
      error = 'Failed to connect Discord: ' + err.message;
      connectingDiscord = false;
      discordStatusMessage = '';
    }
  }

  async function handleLogin() {
    error = '';
    loading = true;

    if (!email.trim() || !password.trim()) {
      error = 'Please enter email and password';
      loading = false;
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        error = data.error || 'Login failed';
        loading = false;
        return;
      }

      // Store token and user info
      chrome.storage.local.set({
        authToken: data.token,
        userEmail: data.user.email
      }, () => {
        isLoggedIn = true;
        userEmail = data.user.email;
        password = '';
        loading = false;
      });
    } catch (err) {
      error = 'Cannot connect to server';
      loading = false;
    }
  }

  async function handleRegister() {
    error = '';
    loading = true;

    if (!email.trim() || !password.trim()) {
      error = 'Please enter email and password';
      loading = false;
      return;
    }

    if (password.length < 6) {
      error = 'Password must be at least 6 characters';
      loading = false;
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        error = data.error || 'Registration failed';
        loading = false;
        return;
      }

      // Store token and user info
      chrome.storage.local.set({
        authToken: data.token,
        userEmail: data.user.email
      }, () => {
        isLoggedIn = true;
        userEmail = data.user.email;
        password = '';
        loading = false;
      });
    } catch (err) {
      error = 'Cannot connect to server';
      loading = false;
    }
  }

  function handleSubmit() {
    if (isRegistering) {
      handleRegister();
    } else {
      handleLogin();
    }
  }

  function handleLogout() {
    chrome.storage.local.remove(['authToken', 'userEmail'], () => {
      isLoggedIn = false;
      email = '';
      password = '';
      userEmail = '';
    });
  }

  function toggleMode() {
    isRegistering = !isRegistering;
    error = '';
  }
</script>

<div class="container">
  <!-- Backend Status Indicator -->
  <div class="status-bar">
    <div class="status-indicator status-{backendStatus}"></div>
    <span class="status-text">{backendMessage}</span>
  </div>

  {#if isLoggedIn}
    <div class="logged-in">
      <h2>Welcome!</h2>
      <p class="user-email">{userEmail}</p>
      <p>You are successfully logged in.</p>

      <div class="discord-section">
        <h3>Discord Connection</h3>

        {#if successMessage}
          <div class="success">{successMessage}</div>
        {/if}

        {#if discordConnected}
          <p class="discord-status connected">✓ Discord Connected</p>
        {:else}
          <p class="discord-status">Not connected</p>

          {#if discordStatusMessage}
            <div class="status-message">{discordStatusMessage}</div>
          {/if}

          <button
            on:click={handleConnectDiscord}
            class="btn btn-primary"
            disabled={connectingDiscord}
          >
            {connectingDiscord ? 'Connecting...' : 'Connect Discord'}
          </button>
          <p class="hint">Open Discord first, then click Connect</p>
        {/if}
      </div>

      <button on:click={handleLogout} class="btn btn-secondary">Logout</button>
    </div>
  {:else}
    <div class="login-form">
      <h2>{isRegistering ? 'Register' : 'Login'}</h2>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <form on:submit|preventDefault={handleSubmit}>
        <div class="form-group">
          <label for="email">Email</label>
          <input
            type="email"
            id="email"
            bind:value={email}
            placeholder="Enter email"
            disabled={loading}
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            type="password"
            id="password"
            bind:value={password}
            placeholder="Enter password"
            disabled={loading}
          />
        </div>

        <button type="submit" class="btn btn-primary" disabled={loading}>
          {loading ? 'Processing...' : (isRegistering ? 'Register' : 'Login')}
        </button>
      </form>

      <div class="toggle-mode">
        <button type="button" on:click={toggleMode} class="link-btn">
          {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .container {
    padding: 20px;
  }

  h2 {
    margin-top: 0;
    color: #333;
    font-size: 20px;
  }

  .login-form {
    display: flex;
    flex-direction: column;
  }

  .form-group {
    margin-bottom: 15px;
  }

  label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: #555;
    font-size: 14px;
  }

  input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }

  input:focus {
    outline: none;
    border-color: #4CAF50;
  }

  input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: #4CAF50;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: #45a049;
  }

  .btn-secondary {
    background-color: #f44336;
    color: white;
  }

  .btn-secondary:hover {
    background-color: #da190b;
  }

  .error {
    background-color: #ffebee;
    color: #c62828;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 15px;
    font-size: 13px;
  }

  .success {
    background-color: #e8f5e9;
    color: #2e7d32;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 15px;
    font-size: 13px;
    font-weight: 500;
  }

  .status-message {
    background-color: #fff3e0;
    color: #e65100;
    padding: 8px;
    border-radius: 4px;
    margin: 10px 0;
    font-size: 12px;
    text-align: center;
  }

  .logged-in {
    text-align: center;
  }

  .logged-in p {
    color: #666;
    margin: 20px 0;
  }

  .user-email {
    font-weight: 600;
    color: #4CAF50 !important;
    margin: 10px 0 !important;
  }

  .status-bar {
    display: flex;
    align-items: center;
    padding: 10px;
    background-color: #f5f5f5;
    border-radius: 4px;
    margin-bottom: 20px;
    gap: 8px;
  }

  .status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  .status-online {
    background-color: #4CAF50;
  }

  .status-offline {
    background-color: #f44336;
    animation: none;
  }

  .status-checking {
    background-color: #ff9800;
  }

  .status-text {
    font-size: 12px;
    color: #555;
    font-weight: 500;
  }

  .toggle-mode {
    margin-top: 15px;
    text-align: center;
  }

  .link-btn {
    background: none;
    border: none;
    color: #4CAF50;
    cursor: pointer;
    font-size: 13px;
    text-decoration: underline;
    padding: 0;
  }

  .link-btn:hover {
    color: #45a049;
  }

  .discord-section {
    margin: 20px 0;
    padding: 15px;
    background-color: #f9f9f9;
    border-radius: 6px;
    text-align: center;
  }

  .discord-section h3 {
    margin-top: 0;
    font-size: 16px;
    color: #555;
  }

  .discord-status {
    margin: 10px 0;
    font-size: 14px;
    color: #666;
  }

  .discord-status.connected {
    color: #4CAF50;
    font-weight: 600;
  }

  .hint {
    margin-top: 10px;
    font-size: 11px;
    color: #888;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
