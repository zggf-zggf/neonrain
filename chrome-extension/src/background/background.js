// Background service worker for NeonRain Chrome extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('[NeonRain] Extension installed');
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[NeonRain Background] Message:', request.type);

  if (request.type === 'CONTENT_SCRIPT_READY') {
    console.log('[NeonRain Background] Content script ready on:', request.url);
    sendResponse({ success: true });
  }

  // DISCORD_TOKEN_READY is sent directly from content script to popup
  return true;
});
