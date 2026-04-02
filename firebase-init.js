/**
 * firebase-init.js — Shared Firebase initialization
 * Include this ONCE before any other scripts that need Firebase
 */

const firebaseConfig = {
  apiKey: "AIzaSyC_asx16rLu7LmC3d-jRVBESrQvfrceuVo",
  authDomain: "aezoon-app.firebaseapp.com",
  projectId: "aezoon-app",
  storageBucket: "aezoon-app.firebasestorage.app",
  messagingSenderId: "900605885255",
  appId: "1:900605885255:web:ecaddb61a88ad344c1ea62",
  measurementId: "G-BEK3YGHVVH"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();
