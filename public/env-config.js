window.__CHAT_PROD_URL__ = 'https://chat.uft1.com';
window.__CHAT_PROD_HOSTS__ = ['chat.uft1.com', 'www.chat.uft1.com'];
window.__CHAT_getApiRoot = function () {
  const origin = (window.location.origin || '').toLowerCase();
  if (window.__CHAT_PROD_HOSTS__.some(host => origin.includes(host))) {
    return origin; // stay on the current production host
  }
  if (origin.startsWith('capacitor://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return window.__CHAT_PROD_URL__;
  }
  return origin || window.__CHAT_PROD_URL__;
};
