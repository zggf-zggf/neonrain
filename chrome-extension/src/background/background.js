// Background service worker for Chrome extension

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received message:', request.type, 'from:', sender.tab?.url || 'popup');

  if (request.type === 'CONTENT_SCRIPT_READY') {
    console.log('[Background] Content script ready on:', request.url);
    sendResponse({ success: true, message: 'Background received' });
    return true;
  }

  if (request.type === 'API_CALL') {
    // This is where you'll handle API calls in the future
    handleApiCall(request.payload)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // Keep message channel open for async response
  }

  // Note: DISCORD_TOKEN_READY is now sent directly from content script to popup
  // No need for background script to handle token storage
});

// Mock API call handler (to be replaced with real backend calls)
async function handleApiCall(payload) {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));

  return {
    message: 'Mock API response',
    timestamp: Date.now(),
    payload: payload
  };
}

// Function to get auth token from storage
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (result) => {
      resolve(result.authToken);
    });
  });
}
