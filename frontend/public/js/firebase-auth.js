// Firebase auth module (ES module, uses Firebase modular SDK via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-analytics.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

// REPLACE with your config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyAcxR3B7-nTudqpCPsL3ynWGe7vJbUTpJo",
  authDomain: "sitio-105.firebaseapp.com",
  projectId: "sitio-105",
  storageBucket: "sitio-105.firebasestorage.app",
  messagingSenderId: "435279624261",
  appId: "1:435279624261:web:ce1acf48a66e306b738b2c",
  measurementId: "G-MKLN1DVEZM"
};

// Initialize Firebase app once
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  // already initialized in some environments
  // ignore
}
try { getAnalytics(app); } catch(e) { /* optional */ }

// Initialize Firestore
let db;
try {
  db = getFirestore(app);
} catch (e) {
  console.warn('Firestore init failed', e);
}

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Sign in helper
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    // Optionally persist user right away
    try {
      const u = result.user;
      if (u && db) {
        const ref = doc(db, 'users', u.uid);
        await setDoc(ref, {
          uid: u.uid,
          email: u.email || null,
          name: u.displayName || null,
          picture: u.photoURL || null,
          lastSeen: serverTimestamp(),
          provider: 'google'
        }, { merge: true });
      }
    } catch (e) {
      console.warn('Could not save user after signIn:', e);
    }
    return result.user;
  } catch (err) {
    console.error('signInWithGoogle error', err);
    throw err;
  }
}

// Sign out helper
export async function signOutUser() {
  try {
    await signOut(auth);
    // clear local storage, UI module can handle update
    localStorage.removeItem('luxury_nyx_user');
  } catch (err) {
    console.error('signOutUser error', err);
    throw err;
  }
}

// Helper to save/update user profile in Firestore
export async function saveUserToFirestore(user) {
  if (!user || !user.uid || !db) return;
  try {
    const ref = doc(db, 'users', user.uid);
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || null,
      name: user.displayName || user.name || null,
      picture: user.photoURL || user.picture || null,
      lastSeen: serverTimestamp(),
      provider: 'google'
    }, { merge: true });
  } catch (e) {
    console.error('saveUserToFirestore error', e);
    throw e;
  }
}

// Observe auth state
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Get ID token of the current user
export async function getCurrentIdToken() {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}