import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// Firebase Web App config supplied for The Aurelia 2K26.
// Firebase web config is intentionally client-visible; authorization is enforced by Auth + Rules.
const firebaseConfig = {
  apiKey: 'AIzaSyAY99S0Db5usC0yZe0LaiDPkhVOFGwD75c',
  authDomain: 'the-aurelia-2k26.firebaseapp.com',
  projectId: 'the-aurelia-2k26',
  storageBucket: 'the-aurelia-2k26.firebasestorage.app',
  messagingSenderId: '824969805013',
  appId: '1:824969805013:web:556f47deed3b1d96bcb65c',
  measurementId: 'G-5YN9E6LWKM',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
