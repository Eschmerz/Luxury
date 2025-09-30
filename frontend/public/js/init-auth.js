import { onAuthChange, signInWithGoogle, signOutUser } from './firebase-auth.js';

// Ensure sign-in button exists in modal
function ensureSignInButton() {
  const container = document.getElementById('gsi-button');
  if (!container) return;
  if (!document.getElementById('btnFirebaseGoogle')) {
    const btn = document.createElement('button');
    btn.id = 'btnFirebaseGoogle';
    btn.textContent = 'Iniciar sesión con Google';
    btn.style.background = 'linear-gradient(90deg,#4285F4,#34A853)';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    btn.style.padding = '10px 16px';
    btn.style.borderRadius = '10px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '700';
    container.appendChild(btn);
  }
}

let DRIVE_FOLDER_URL = null;
let USER_ACCESS = false;
async function loadPublicConfig() {
  try {
    const meta = document.querySelector('meta[name="backend-origin"]');
    const configured = window.BACKEND_ORIGIN || (meta && meta.content) || null;
    const base = configured ? configured.replace(/\/$/, '') : location.origin;
    const url = base + '/config';
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    DRIVE_FOLDER_URL = data && data.driveFolderUrl ? data.driveFolderUrl : null;
  } catch {}
}

function hasAccess() {
  try {
    const stored = localStorage.getItem('luxury_nyx_user');
    if (!stored) return false;
    const u = JSON.parse(stored);
    return !!u.access;
  } catch {
    return false;
  }
}

function renderDriveLink() {
  const container = document.getElementById('signedInArea');
  if (!container) return;
  let driveBtn = document.getElementById('btnDriveFolder');
  const allowed = (USER_ACCESS || hasAccess());
  if (!allowed) {
    if (driveBtn) driveBtn.remove();
    return;
  }
  if (!driveBtn) {
    driveBtn = document.createElement('a');
    driveBtn.id = 'btnDriveFolder';
    driveBtn.className = 'btn btn-primary';
    driveBtn.target = '_blank';
    driveBtn.rel = 'noopener';
    driveBtn.style.textDecoration = 'none';
    driveBtn.style.display = 'inline-flex';
    driveBtn.style.alignItems = 'center';
    driveBtn.style.gap = '8px';
    driveBtn.innerHTML = '📂 Biblioteca en Drive';
    const actions = container.querySelector('.account-actions');
    if (actions) actions.prepend(driveBtn); else container.appendChild(driveBtn);
  }
  driveBtn.href = '#';
  driveBtn.onclick = async (e) => {
    e.preventDefault();
    let popup = null;
    try { popup = window.open('about:blank', '_blank'); } catch {}
    await openDriveNow(popup);
  };
}

// Update account UI (exposed globally for inline handlers and other scripts)
function updateAccountUI(user) {
  const signedInArea = document.getElementById('signedInArea');
  const signInArea = document.getElementById('signInArea');
  const profilePic = document.getElementById('profilePic');
  const displayName = document.getElementById('displayName');
  const displayEmail = document.getElementById('displayEmail');
  const accountLabel = document.getElementById('accountLabel');
  const accountAvatar = document.getElementById('accountAvatar');

  if (user) {
    // populate modal
    if (profilePic && user.picture) profilePic.src = user.picture;
    if (displayName) displayName.textContent = user.name || user.displayName || 'Usuario';
    if (displayEmail) displayEmail.textContent = user.email || '';

    if (signedInArea) signedInArea.style.display = 'block';
    if (signInArea) signInArea.style.display = 'none';

    // update header
    if (accountLabel) accountLabel.textContent = user.name || user.displayName || 'Mi cuenta';
    if (accountAvatar) {
      accountAvatar.innerHTML = '';
      if (user.picture) {
        const img = document.createElement('img');
        img.src = user.picture;
        img.alt = user.name || 'avatar';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        accountAvatar.appendChild(img);
      } else if (user.name) {
        accountAvatar.textContent = (user.name[0] || 'U').toUpperCase();
      } else {
        accountAvatar.innerHTML = '<span style="font-size:1.2rem;">👤</span>';
      }
    }

    // badge + drive link gating
    updateBadgesFromUser(user);
    renderDriveLink();
  } else {
    // not signed in
    if (signedInArea) signedInArea.style.display = 'none';
    if (signInArea) signInArea.style.display = 'block';
    if (profilePic) profilePic.src = '';
    if (displayName) displayName.textContent = 'Usuario';
    if (displayEmail) displayEmail.textContent = 'correo@ejemplo.com';
    if (accountLabel) accountLabel.textContent = 'Mi cuenta';
    if (accountAvatar) accountAvatar.innerHTML = '<span style="font-size:1.2rem;">👤</span>';
    renderDriveLink();
  }
}

// Expose globally so index.html inline handlers and other scripts can call it
window.updateAccountUI = updateAccountUI;

// Provide a global signOut() that calls the module signOutUser() and hides the modal
window.signOut = async function() {
  try {
    await signOutUser();
    localStorage.removeItem('luxury_nyx_user');
    updateAccountUI(null);
    const modal = document.getElementById('accountModal');
    if (modal) modal.style.display = 'none';
  } catch (err) {
    console.error('signOut error', err);
  }
};

// Provide a global closeAccountModal so inline handlers in index.html work
window.closeAccountModal = function() {
  try {
    const modal = document.getElementById('accountModal');
    if (modal) modal.style.display = 'none';
  } catch (e) {
    console.error('closeAccountModal error', e);
  }
};

// Wire UI actions
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btnFirebaseGoogle') {
    signInWithGoogle().catch(err => console.error(err));
  }
  // keep support for elements that used inline onclick="signOut()"
  if (e.target && (e.target.matches('[onclick*="signOut"]') || e.target.id === 'btnSignOut')) {
    if (window.signOut) window.signOut();
  }
});

// Show modal when header trigger clicked
const accountTrigger = document.getElementById('accountTrigger');
if (accountTrigger) accountTrigger.addEventListener('click', () => {
  const modal = document.getElementById('accountModal');
  if (modal) modal.style.display = 'flex';
  ensureSignInButton();
  // try to populate UI from localStorage while Firebase resolves
  const stored = localStorage.getItem('luxury_nyx_user');
  if (stored) {
    try { updateAccountUI(JSON.parse(stored)); } catch(e){}
  }
});

// Handler: abrir Billing Portal
async function openBillingPortal() {
  try {
    const meta = document.querySelector('meta[name="backend-origin"]');
    const configured = window.BACKEND_ORIGIN || (meta && meta.content) || null;
    const base = configured ? configured.replace(/\/$/, '') : location.origin;
    const url = base + '/billing-portal';

    // idToken
    let idToken = null;
    try {
      const mod = await import('./firebase-auth.js');
      if (mod && typeof mod.getCurrentIdToken === 'function') {
        idToken = await mod.getCurrentIdToken();
      }
    } catch {}

    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!resp.ok) throw new Error('No se pudo crear sesión del portal');
    const data = await resp.json();
    if (data && data.url) window.open(data.url, '_blank', 'noopener');
  } catch (err) {
    console.error('openBillingPortal error', err);
    alert('No se pudo abrir el portal de pagos.');
  }
}

// Wire billing portal button when modal opens
const accountModal = document.getElementById('accountModal');
if (accountModal) {
  accountModal.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btnBillingPortal') {
      openBillingPortal();
    }
  });
}

// Update badge depending on stored info
function updateBadgesFromUser(user) {
  const badge = document.getElementById('badgeStatus');
  if (!badge) return;
  const hasStripe = !!(user && user.stripeCustomerId);
  const hasAcc = !!(user && user.access);
  badge.classList.add('badge-status');
  if (hasAcc) {
    badge.textContent = 'Acceso activo';
  } else if (hasStripe) {
    badge.textContent = 'Miembro registrado';
  } else {
    badge.textContent = 'Miembro invitado';
  }
}

async function fetchMeAndUpdate() {
  try {
    const meta = document.querySelector('meta[name="backend-origin"]');
    const configured = window.BACKEND_ORIGIN || (meta && meta.content) || null;
    const base = configured ? configured.replace(/\/$/, '') : location.origin;
    const url = base + '/me';

    let idToken = null;
    try {
      const mod = await import('./firebase-auth.js');
      if (mod && typeof mod.getCurrentIdToken === 'function') idToken = await mod.getCurrentIdToken();
    } catch {}

    const headers = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return;
    const data = await resp.json();
    USER_ACCESS = !!data.access;

    const stored = localStorage.getItem('luxury_nyx_user');
    let u = stored ? JSON.parse(stored) : {};
    u = { ...u, access: !!data.access, stripeCustomerId: data.stripeCustomerId || u.stripeCustomerId };
    localStorage.setItem('luxury_nyx_user', JSON.stringify(u));
    updateAccountUI(u);
  } catch {}
}

// Backend helpers (faltaban estas funciones)
function getBackendBase() {
  const meta = document.querySelector('meta[name="backend-origin"]');
  const configured = window.BACKEND_ORIGIN || (meta && meta.content) || null;
  const base = configured ? configured.replace(/\/$/, '') : location.origin;
  return { base, isLocal: /localhost:\d+$/.test(base) };
}

async function getIdTokenSafe() {
  try {
    const mod = await import('./firebase-auth.js');
    if (mod && typeof mod.getCurrentIdToken === 'function') {
      return await mod.getCurrentIdToken();
    }
  } catch {}
  return null;
}

// Abrir carpeta de Drive respetando políticas de iOS/Safari
async function openDriveNow(popup) {
  const { base } = getBackendBase();
  const idToken = await getIdTokenSafe();
  if (!idToken) {
    try { if (popup && !popup.closed) popup.close(); } catch {}
    alert('Inicia sesión para acceder');
    return;
  }
  const finalUrl = `${base}/drive?token=${encodeURIComponent(idToken)}`;
  if (popup && !popup.closed) {
    try { popup.location.href = finalUrl; return; } catch {}
  }
  window.location.href = finalUrl;
}

// Global purchase handler usado por los botones CTA
window.handlePurchase = async function(e) {
  // iOS/Safari: abrir ventana en el gesto del usuario y redirigir luego
  let popup = null;
  try { popup = window.open('about:blank', '_blank'); } catch {}

  let fallbackUrl = null;
  if (e) {
    if (e.preventDefault) e.preventDefault();
    const target = e.currentTarget || e.target;
    if (target && typeof target.getAttribute === 'function') {
      const href = target.getAttribute('href') || '';
      if (href && href !== '#' && href !== '' && href !== '/' && href !== window.location.href) {
        fallbackUrl = href;
      }
    }
  }

  // Si ya tiene acceso, llevar directo a Drive
  if (USER_ACCESS || hasAccess()) {
    await openDriveNow(popup);
    return;
  }

  const navigate = (url) => {
    if (!url) return false;
    if (popup && !popup.closed) {
      try { popup.location.href = url; return true; } catch {}
    }
    window.location.href = url; // fallback mismo tab (compat iOS)
    return true;
  };

  const closePopupIfOpen = () => { try { if (popup && !popup.closed) popup.close(); } catch {} };

  try {
    const stored = localStorage.getItem('luxury_nyx_user');
    const isLoggedIn = !!stored;
    if (!isLoggedIn) {
      closePopupIfOpen();
      const modal = document.getElementById('accountModal');
      if (modal) modal.style.display = 'flex';
      ensureSignInButton();
      return; // requiere login
    }

    // Payment Link personalizado (preferido)
    try {
      const pl = await getUserPaymentLink(1200, 'Luxury NYX - Full Access');
      if (pl && pl.url) {
        navigate(pl.url);
        return;
      }
    } catch (e1) {
      console.warn('Fallo user-paylink, intento Checkout', e1 && e1.message);
    }

    // Fallback a Checkout
    try {
      const { url } = await createCheckoutSession(1200, 'Luxury NYX - Full Access');
      if (url) {
        navigate(url);
        return;
      }
    } catch (e2) {
      console.warn('Fallo create-checkout-session, intento Payment Link genérico', e2 && e2.message);
    }

    // Fallback final a Payment Link genérico
    const pay = await createPaymentLink(1200, 'Luxury NYX - Full Access');
    if (pay && pay.url) {
      navigate(pay.url);
    } else if (fallbackUrl) {
      navigate(fallbackUrl);
    } else {
      closePopupIfOpen();
      alert('No se pudo generar el enlace de pago.');
    }
  } catch (err) {
    console.error('handlePurchase error', err);
    if (fallbackUrl) {
      navigate(fallbackUrl);
    } else {
      closePopupIfOpen();
      alert('Error al procesar la compra. Intenta iniciar sesión nuevamente.');
    }
  }
};

// Observe auth state and update UI
onAuthChange(async (user) => {
  if (!user) {
    updateAccountUI(null);
    USER_ACCESS = false;
    return;
  }

  const uiUser = { name: user.displayName, email: user.email, picture: user.photoURL, uid: user.uid };
  localStorage.setItem('luxury_nyx_user', JSON.stringify(uiUser));
  updateAccountUI(uiUser);

  try {
    const idToken = await user.getIdToken();
    const result = await tryCreateStripeCustomerWithBackend(idToken);
    if (result && result.ok && result.body && result.body.customerId) {
      uiUser.stripeCustomerId = result.body.customerId;
      localStorage.setItem('luxury_nyx_user', JSON.stringify(uiUser));
      updateAccountUI(uiUser);
    }
  } catch {}

  // Always fetch access status from backend
  await fetchMeAndUpdate();
});

// Initialize on load
window.addEventListener('load', async () => {
  await loadPublicConfig();
  ensureSignInButton();
  const stored = localStorage.getItem('luxury_nyx_user');
  if (stored) {
    try { updateAccountUI(JSON.parse(stored)); } catch (e) {}
  }
  await fetchMeAndUpdate();
  // Reintento breve por si el token aún no estaba listo en el primer fetch
  setTimeout(fetchMeAndUpdate, 1500);
  setTimeout(fetchMeAndUpdate, 3500);
});
