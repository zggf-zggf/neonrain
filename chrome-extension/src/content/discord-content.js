// Content script that bridges between page and extension
console.log('[Neonrain Discord Content] Content script loaded on:', window.location.href);

let capturedToken = null;
let isCapturingEnabled = false;

// Notify that content script is ready
chrome.runtime.sendMessage({
  type: 'CONTENT_SCRIPT_READY',
  url: window.location.href
}, response => {
  console.log('[Neonrain Discord Content] Background acknowledged:', response);
});

// Inject the script that can access Discord's requests
function injectScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('discord-injector.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Listen for messages from the injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data.type === 'DISCORD_TOKEN_CAPTURED') {
    const token = event.data.token;
    console.log('[Neonrain] Discord token captured, isCapturingEnabled:', isCapturingEnabled);
    capturedToken = token;

    if (isCapturingEnabled) {
      console.log('[Neonrain] Sending token directly to popup via runtime message');
      // Send directly to whoever is listening (popup)
      chrome.runtime.sendMessage({
        type: 'DISCORD_TOKEN_READY',
        token: token
      }, (response) => {
        console.log('[Neonrain] Token sent, response:', response);
      });

      // Disable further capturing
      isCapturingEnabled = false;
    } else {
      console.log('[Neonrain] Token captured but capturing not enabled yet - will send when user clicks Connect');
    }
  }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_DISCORD_CAPTURE') {
    console.log('[Neonrain] Starting Discord token capture');
    isCapturingEnabled = true;

    // If we already captured the token, send it immediately
    if (capturedToken) {
      console.log('[Neonrain] Token already captured, sending directly to popup');
      chrome.runtime.sendMessage({
        type: 'DISCORD_TOKEN_READY',
        token: capturedToken
      });
      isCapturingEnabled = false;
      sendResponse({ success: true, tokenReady: true });
    } else {
      // Trigger immediate token extraction attempt
      console.log('[Neonrain] No token yet, triggering extraction');
      window.postMessage({ type: 'EXTRACT_TOKEN_NOW' }, '*');
      sendResponse({ success: true, tokenReady: false });
    }
  }

  if (request.type === 'GET_CAPTURED_TOKEN') {
    sendResponse({ token: capturedToken });
  }

  return true;
});

// Inject the script when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectScript);
} else {
  injectScript();
}
