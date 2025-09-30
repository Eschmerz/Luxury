// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyAcxR3B7-nTudqpCPsL3ynWGe7vJbUTpJo",
    authDomain: "sitio-105.firebaseapp.com",
    projectId: "sitio-105",
    storageBucket: "sitio-105.firebasestorage.app",
    messagingSenderId: "435279624261",
    appId: "1:435279624261:web:ce1acf48a66e306b738b2c",
    measurementId: "G-MKLN1DVEZM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
getAnalytics(app);

// Initialize Firebase (for compat libraries, if needed)
// firebase.initializeApp(firebaseConfig);

// Open modal when clicking the header account area
document.getElementById('accountTrigger').addEventListener('click', function() {
    const modal = document.getElementById('accountModal');
    modal.style.display = 'flex';
    // Update UI based on stored user
    const stored = localStorage.getItem('luxury_nyx_user');
    if (stored) {
        updateAccountUI(JSON.parse(stored));
    }
});

function closeAccountModal() {
    var modal = document.getElementById('accountModal');
    modal.style.display = 'none';
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    var modal = document.getElementById('accountModal');
    if (modal.style.display === 'flex' && e.target === modal) {
        closeAccountModal();
    }
});

// Close modal with ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAccountModal();
});

// Update modal and header UI from user object
function updateAccountUI(user) {
    if (user) {
        document.getElementById('displayName').textContent = user.displayName || 'Usuario';
        document.getElementById('displayEmail').textContent = user.email || '';
        document.getElementById('profilePic').src = user.photoURL || '';
        document.getElementById('signedInArea').style.display = 'block';
        document.getElementById('signInArea').style.display = 'none';

        // Header
        document.getElementById('accountLabel').textContent = user.displayName ? user.displayName.split(' ')[0] : 'Mi cuenta';
        document.getElementById('accountAvatar').innerHTML = `<img src="${user.photoURL || ''}" alt="" style="width:32px;height:32px;border-radius:50%; object-fit:cover;">`;
    } else {
        document.getElementById('signedInArea').style.display = 'none';
        document.getElementById('signInArea').style.display = 'block';
        document.getElementById('accountLabel').textContent = 'Mi cuenta';
        document.getElementById('accountAvatar').innerHTML = '<span style="font-size:1.2rem;">👤</span>';
    }
}

// Restore UI on page load
window.addEventListener('load', () => {
    const stored = localStorage.getItem('luxury_nyx_user');
    if (stored) updateAccountUI(JSON.parse(stored));
});