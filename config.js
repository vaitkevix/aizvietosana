// ===== IESTATĪJUMI — aizpildi pēc README.md =====
self.APP_CONFIG = {
  // Apps Script Web app URL (beidzas ar /exec)
  API_URL: 'https://script.google.com/macros/s/IELIEC_SEIT/exec',

  // Firebase → Project settings → General → Your apps → Web app → firebaseConfig
  // Atstāj tukšu apiKey, ja paziņojumi vēl nav vajadzīgi.
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    messagingSenderId: '',
    appId: ''
  },

  // Firebase → Project settings → Cloud Messaging → Web Push certificates → Key pair
  VAPID_KEY: ''
};
