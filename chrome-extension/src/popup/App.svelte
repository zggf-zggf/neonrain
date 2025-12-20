<script>
  import { onMount } from 'svelte';

  const BACKEND_URL = 'http://104.154.141.204:3000';

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
  let guilds = [];
  let selectedGuildId = null;
  let channels = [];
  let selectedChannels = new Map(); // Map channelId -> {channelId, guildId}
  let savedChannels = []; // Array of {channelId, guildId}
  let configuringChannels = false;
  let loadingGuilds = false;
  let loadingChannels = false;
  let savingChannels = false;
  let configuringPrompt = false;
  let prompt = '';
  let savedPrompt = '';
  let savingPrompt = false;

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

        if (discordConnected) {
          await loadSavedChannels();
          await loadSavedPrompt();
        }
      } else if (response.status === 401) {
        // Session expired, force logout
        chrome.storage.local.remove(['authToken', 'userEmail'], () => {
          isLoggedIn = false;
          userEmail = '';
        });
      }
    } catch (err) {
      console.error('Failed to check Discord status:', err);
    }
  }

  async function loadSavedChannels() {
    const authToken = await getAuthToken();
    if (!authToken) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/channels`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        savedChannels = data.channels || [];
        // Populate selectedChannels Map from saved data
        selectedChannels = new Map();
        savedChannels.forEach(ch => {
          selectedChannels.set(ch.channelId, ch);
        });
      }
    } catch (err) {
      console.error('Failed to load saved channels:', err);
    }
  }

  async function loadSavedPrompt() {
    const authToken = await getAuthToken();
    if (!authToken) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/prompt`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        savedPrompt = data.prompt || '';
        prompt = savedPrompt;
      }
    } catch (err) {
      console.error('Failed to load saved prompt:', err);
    }
  }

  async function savePrompt() {
    savingPrompt = true;
    error = '';
    successMessage = '';

    const authToken = await getAuthToken();
    if (!authToken) {
      error = 'Not authenticated';
      savingPrompt = false;
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ prompt })
      });

      if (response.ok) {
        const data = await response.json();
        savedPrompt = data.prompt;
        successMessage = 'Prompt saved successfully!';
        configuringPrompt = false;
        setTimeout(() => {
          successMessage = '';
        }, 3000);
      } else {
        const data = await response.json();
        error = data.error || 'Failed to save prompt';
      }
    } catch (err) {
      console.error('Failed to save prompt:', err);
      error = 'Cannot connect to backend';
    } finally {
      savingPrompt = false;
    }
  }

  function startConfiguringPrompt() {
    configuringPrompt = true;
    prompt = savedPrompt;
  }

  function cancelPromptConfiguration() {
    configuringPrompt = false;
    prompt = savedPrompt;
    error = '';
  }

  async function fetchGuilds() {
    loadingGuilds = true;
    error = '';

    const authToken = await getAuthToken();
    if (!authToken) {
      error = 'Not authenticated';
      loadingGuilds = false;
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/guilds`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        guilds = await response.json();
      } else {
        const data = await response.json();
        error = data.error || 'Failed to fetch Discord guilds.';
      }
    } catch (err) {
      console.error('Failed to fetch guilds:', err);
      error = 'Cannot connect to backend. Make sure it is running.';
    } finally {
      loadingGuilds = false;
    }
  }

  async function fetchChannels(guildId) {
    // If clicking the same guild, collapse it
    if (selectedGuildId === guildId) {
      selectedGuildId = null;
      channels = [];
      return;
    }

    // Set guild as selected immediately to show loading state
    selectedGuildId = guildId;
    loadingChannels = true;
    error = '';
    channels = []; // Clear previous channels

    const authToken = await getAuthToken();
    if (!authToken) {
      error = 'Not authenticated';
      loadingChannels = false;
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/discord/guilds/${guildId}/channels`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        channels = await response.json();
      } else {
        const data = await response.json();
        error = data.error || 'Failed to fetch channels for this guild.';
      }
    } catch (err) {
      console.error('Failed to fetch channels:', err);
      error = 'Cannot connect to backend.';
    } finally {
      loadingChannels = false;
    }
  }

  async function saveChannelSelection() {
    savingChannels = true;
    error = '';
    successMessage = '';

    const authToken = await getAuthToken();
    if (!authToken) {
      error = 'Not authenticated';
      savingChannels = false;
      return;
    }

    try {
      // Convert Map to array of {channelId, guildId} objects
      const channelsToSave = Array.from(selectedChannels.values());

      const response = await fetch(`${BACKEND_URL}/api/discord/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          channels: channelsToSave
        })
      });

      if (response.ok) {
        const data = await response.json();
        savedChannels = data.channels || [];
        successMessage = `Successfully saved ${savedChannels.length} channel(s)!`;
        configuringChannels = false;

        setTimeout(() => {
          successMessage = '';
        }, 3000);
      } else {
        const data = await response.json();
        error = data.error || 'Failed to save channel selection';
      }
    } catch (err) {
      console.error('Failed to save channels:', err);
      error = 'Cannot connect to backend.';
    } finally {
      savingChannels = false;
    }
  }

  function toggleChannelSelection(channelId, guildId) {
    if (selectedChannels.has(channelId)) {
      selectedChannels.delete(channelId);
    } else {
      selectedChannels.set(channelId, { channelId, guildId });
    }
    selectedChannels = selectedChannels; // Trigger reactivity
  }

  async function startConfiguringChannels() {
    configuringChannels = true;
    await fetchGuilds();
  }

  function cancelConfiguration() {
    configuringChannels = false;
    guilds = [];
    channels = [];
    selectedGuildId = null;
    // Restore from saved
    selectedChannels = new Map();
    savedChannels.forEach(ch => {
      selectedChannels.set(ch.channelId, ch);
    });
    error = '';
  }

  function guildHasSelectedChannels(guildId) {
    return savedChannels.some(ch => ch.guildId === guildId);
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

        // If 401, clear auth and force re-login
        if (response.status === 401) {
          chrome.storage.local.remove(['authToken', 'userEmail'], () => {
            isLoggedIn = false;
            userEmail = '';
            error = 'Session expired. Please login again.';
          });
        } else {
          error = `Backend error: ${data.error || 'Failed to connect Discord'}`;
        }
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

        {#if error}
          <div class="error">{error}</div>
        {/if}

        {#if !discordConnected}
          <!-- State 1: No Discord Token -->
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

        {:else if configuringChannels}
          <!-- State 2: Token Present, Configuring Channels -->
          <p class="discord-status connected">✓ Discord Connected</p>

          {#if loadingGuilds}
            <p class="loading">Loading guilds...</p>
          {:else if guilds.length > 0}
            <div class="guilds-list">
              <h4>Select Channels to Monitor</h4>

              {#each guilds as guild}
                <div class="guild-item">
                  <button
                    class="guild-button"
                    class:active={selectedGuildId === guild.id}
                    on:click={() => fetchChannels(guild.id)}
                  >
                    <span class="guild-name-text">{guild.name}</span>
                    {#if guildHasSelectedChannels(guild.id)}
                      <span class="guild-indicator"></span>
                    {/if}
                  </button>

                  {#if selectedGuildId === guild.id}
                    {#if loadingChannels}
                      <p class="loading-channels">Loading channels...</p>
                    {:else if channels.length > 0}
                      <div class="channels-list">
                        {#each channels as channel}
                          <label class="channel-item">
                            <span class="channel-name">#{channel.name}</span>
                            <input
                              type="checkbox"
                              checked={selectedChannels.has(channel.id)}
                              on:change={() => toggleChannelSelection(channel.id, selectedGuildId)}
                            />
                          </label>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                </div>
              {/each}

              <div class="config-actions">
                <button
                  class="btn btn-primary"
                  on:click={saveChannelSelection}
                  disabled={savingChannels || selectedChannels.size === 0}
                >
                  {savingChannels ? 'Saving...' : `Save (${selectedChannels.size} selected)`}
                </button>
                <button
                  class="btn btn-secondary"
                  on:click={cancelConfiguration}
                  disabled={savingChannels}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}

        {:else if savedChannels.length > 0}
          <!-- State 3: Token + Channels Selected -->
          <p class="discord-status connected">✓ Discord Connected</p>
          <p class="channels-summary">
            Monitoring <strong>{savedChannels.length}</strong> channel{savedChannels.length !== 1 ? 's' : ''}
          </p>

          {#if configuringPrompt}
            <!-- Prompt Configuration UI -->
            <div class="prompt-config">
              <label for="prompt-input">Enter your prompt:</label>
              <textarea
                id="prompt-input"
                bind:value={prompt}
                placeholder="Enter instructions for processing Discord messages..."
                rows="6"
              />
              <div class="button-group">
                <button
                  class="btn btn-primary"
                  on:click={savePrompt}
                  disabled={savingPrompt}
                >
                  {savingPrompt ? 'Saving...' : 'Save Prompt'}
                </button>
                <button
                  class="btn btn-secondary"
                  on:click={cancelPromptConfiguration}
                  disabled={savingPrompt}
                >
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <button
              class="btn btn-primary"
              on:click={startConfiguringChannels}
            >
              Configure Channels
            </button>
            <button
              class="btn btn-primary"
              on:click={startConfiguringPrompt}
              style="margin-top: 8px;"
            >
              Configure Prompt
            </button>
          {/if}

        {:else}
          <!-- State 2b: Token Present, No Channels Selected Yet -->
          <p class="discord-status connected">✓ Discord Connected</p>
          <p class="discord-status">No channels configured yet</p>
          <button
            class="btn btn-primary"
            on:click={startConfiguringChannels}
          >
            Select Channels
          </button>
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
    width: 350px;
    box-sizing: border-box;
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

  .loading {
    color: #666;
    font-size: 13px;
    margin: 10px 0;
  }

  .guilds-list {
    margin-top: 15px;
    text-align: left;
  }

  .guilds-list h4 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: #555;
    text-align: center;
  }

  .guild-item {
    margin-bottom: 10px;
  }

  .guild-button {
    width: 100%;
    padding: 10px;
    background-color: #fff;
    border: 2px solid #ddd;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .guild-button:hover {
    border-color: #4CAF50;
    background-color: #f9f9f9;
  }

  .guild-button.active {
    border-color: #4CAF50;
    background-color: #e8f5e9;
    color: #2e7d32;
  }

  .guild-name-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guild-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #4CAF50;
    flex-shrink: 0;
    box-shadow: 0 0 3px rgba(76, 175, 80, 0.6);
  }

  .loading-channels {
    font-size: 12px;
    color: #666;
    margin: 5px 0 0 15px;
  }

  .channels-list {
    margin: 10px 0 0 15px;
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    border-left: 2px solid #e0e0e0;
    padding-left: 10px;
    padding-right: 5px;
  }

  .channel-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    margin: 2px 0;
    cursor: pointer;
    border-radius: 3px;
    transition: background-color 0.2s;
  }

  .channel-item:hover {
    background-color: #f5f5f5;
  }

  .channel-item input[type="checkbox"] {
    cursor: pointer;
    margin: 0;
  }

  .channel-name {
    font-size: 12px;
    color: #555;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .config-actions {
    margin-top: 15px;
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .config-actions .btn {
    flex: 1;
  }

  .channels-summary {
    margin: 15px 0;
    font-size: 14px;
    color: #555;
  }

  .channels-summary strong {
    color: #4CAF50;
  }

  .prompt-config {
    margin-top: 15px;
  }

  .prompt-config label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 500;
    color: #333;
  }

  .prompt-config textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    box-sizing: border-box;
  }

  .prompt-config textarea:focus {
    outline: none;
    border-color: #4CAF50;
  }

  .button-group {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }

  .button-group .btn {
    flex: 1;
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
