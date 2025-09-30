const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const admin = require('firebase-admin');
const fs = require('fs');
const { google } = require('googleapis');
const helmet = require('helmet');

const app = express();
app.disable('x-powered-by');
// Trust proxy for correct protocol/IP when behind a load balancer or CDN
app.set('trust proxy', 1);
// Basic security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Configure strict CORS allowlist (env: ALLOWED_ORIGINS comma-separated)
const defaultAllowed = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://luxurynyx.netlify.app'
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const corsAllowlist = allowedOrigins.length ? allowedOrigins : defaultAllowed;
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow same-origin/no-origin (e.g., curl, mobile apps)
    if (corsAllowlist.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};
app.use(cors(corsOptions));

// Serve only the frontend directory, not the whole repo
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));
// Serve the landing page explicitly
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Initialize Firebase Admin with service account from env (JSON/Base64) or file path
let adminInitialized = false;

// 1) JSON directo en variable de entorno (FIREBASE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS_JSON)
try {
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (jsonStr) {
    const creds = JSON.parse(jsonStr);
    admin.initializeApp({ credential: admin.credential.cert(creds) });
    adminInitialized = true;
    console.log('Firebase Admin inicializado desde JSON en variable de entorno');
  }
} catch (e) {
  console.warn('Firebase Admin init (JSON env) failed:', e.message);
}

// 2) JSON en Base64 (FIREBASE_SERVICE_ACCOUNT_B64 o GOOGLE_APPLICATION_CREDENTIALS_B64)
if (!adminInitialized) {
  try {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_APPLICATION_CREDENTIALS_B64;
    if (b64) {
      const json = Buffer.from(b64, 'base64').toString('utf8');
      const creds = JSON.parse(json);
      admin.initializeApp({ credential: admin.credential.cert(creds) });
      adminInitialized = true;
      console.log('Firebase Admin inicializado desde Base64 en variable de entorno');
    }
  } catch (e) {
    console.warn('Firebase Admin init (Base64 env) failed:', e.message);
  }
}

// 3) Ruta a archivo (GOOGLE_APPLICATION_CREDENTIALS)
if (!adminInitialized) {
  try {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      // Resolver rutas relativas respecto al directorio del archivo (no del CWD)
      const serviceAccountPath = path.isAbsolute(credPath)
        ? credPath
        : path.join(__dirname, credPath.replace(/^\.[/\\]/, ''));
      if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`Service account file not found at ${serviceAccountPath}`);
      }
      const creds = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(creds) });
      adminInitialized = true;
      console.log('Firebase Admin inicializado con', serviceAccountPath);
    }
  } catch (e) {
    console.warn('Firebase Admin init (service account file) failed:', e.message);
  }
}

// 4) Credenciales por defecto (gcloud/application default credentials)
if (!adminInitialized) {
  try {
    admin.initializeApp();
    adminInitialized = true;
    console.log('Firebase Admin inicializado con credenciales por defecto');
  } catch (ee) {
    console.warn('Admin init fallback failed', ee.message);
  }
}

const db = admin.apps?.length ? admin.firestore() : null;

// Drive helpers: resolve service account, get Drive client, and add permissions
function resolveServiceAccountPath() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;
  return path.isAbsolute(credPath) ? credPath : path.join(__dirname, credPath.replace(/^\.[/\\]/, ''));
}

let driveClient = null;
async function getDrive() {
  try {
    if (driveClient) return driveClient;
    const keyFile = resolveServiceAccountPath();
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive'],
      ...(keyFile ? { keyFile } : {})
    });
    const client = await auth.getClient();
    driveClient = google.drive({ version: 'v3', auth: client });
    return driveClient;
  } catch (e) {
    console.warn('Drive init failed:', e.message);
    return null;
  }
}

function getDriveFolderId() {
  const id = process.env.DRIVE_FOLDER_ID || null;
  if (id) return id;
  const url = process.env.DRIVE_FOLDER_URL || null;
  if (!url) return null;
  const m = url.match(/\/folders\/([^\/?#]+)/);
  return m ? m[1] : null;
}

async function addDriveReaderPermission(email) {
  if (!email) return false;
  const folderId = getDriveFolderId();
  if (!folderId) {
    console.warn('DRIVE_FOLDER_ID/URL no configurado');
    return false;
  }
  const drive = await getDrive();
  if (!drive) return false;
  try {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { role: 'reader', type: 'user', emailAddress: email },
      sendNotificationEmail: false
    });
    console.log('[Drive] Permiso reader agregado a', email);
    return true;
  } catch (e) {
    const code = e?.code || e?.response?.status;
    if (code === 409) {
      console.log('[Drive] Permiso ya existía para', email);
      return true;
    }
    if (code === 403) console.warn('[Drive] 403. Verifica que el service account tenga permisos sobre la carpeta.');
    else if (code === 404) console.warn('[Drive] 404. DRIVE_FOLDER_ID inválido.');
    else console.warn('[Drive] Error al agregar permiso:', e.message || e);
    return false;
  }
}

// Helper: obtener o crear (una sola vez) el Product/Price por defecto
async function getOrCreateDefaultPrice({ product_name, unit_amount, currency }) {
  const fixedName = process.env.STRIPE_PRODUCT_NAME || product_name || 'Luxury NYX - Full Access';
  const fixedDescription = process.env.STRIPE_PRODUCT_DESCRIPTION || 'Acceso completo • Descarga inmediata • Licencia comercial';
  const fixedImage = process.env.STRIPE_PRODUCT_IMAGE_URL || null;
  const fixedCurrency = (process.env.STRIPE_CURRENCY || currency || 'usd').toLowerCase();
  const fixedAmount = Number(process.env.STRIPE_UNIT_AMOUNT || unit_amount || 1200);

  // Detect mode strictly from secret
  const mode = (process.env.STRIPE_SECRET || '').startsWith('sk_test') ? 'test' : 'live';

  // Strict: use only mode-specific IDs to avoid mixing LIVE/TEST
  let priceIdEnv = null;
  let productIdEnv = null;
  if (mode === 'test') {
    priceIdEnv = process.env.STRIPE_TEST_PRICE_ID || null;
    productIdEnv = process.env.STRIPE_TEST_PRODUCT_ID || null;
  } else {
    priceIdEnv = process.env.STRIPE_LIVE_PRICE_ID || null;
    productIdEnv = process.env.STRIPE_LIVE_PRODUCT_ID || null;
  }

  if (priceIdEnv) {
    console.log(`[Stripe] Using ${mode.toUpperCase()} price:`, priceIdEnv);
    return {
      mode,
      priceId: priceIdEnv,
      productId: productIdEnv || null,
      name: fixedName,
      currency: fixedCurrency,
      unit_amount: fixedAmount
    };
  }

  // Optional legacy support: if user explicitly set generic STRIPE_PRICE_ID and secret matches TEST, warn and use only if also provided as STRIPE_TEST_PRICE_ID
  if (process.env.STRIPE_PRICE_ID) {
    throw new Error(`Configurar IDs por modo. Falta ${mode === 'test' ? 'STRIPE_TEST_PRICE_ID' : 'STRIPE_LIVE_PRICE_ID'}. No se usarán STRIPE_PRICE_ID/STRIPE_PRODUCT_ID para evitar mezclar modos.`);
  }

  // Optionally load from Firestore config (mode-specific fields could be added in the future)
  if (!db) throw new Error('Firestore no disponible');
  const cfgRef = db.collection('config').doc('stripe');
  const cfgSnap = await cfgRef.get();
  if (cfgSnap.exists) {
    const d = cfgSnap.data();
    if (d && d.defaultPriceId) {
      return {
        mode,
        priceId: d.defaultPriceId,
        productId: d.defaultProductId || null,
        name: d.defaultProductName || fixedName,
        currency: d.defaultCurrency || fixedCurrency,
        unit_amount: d.defaultUnitAmount || fixedAmount
      };
    }
  }

  throw new Error(`Faltan IDs de ${mode.toUpperCase()} (usa ${mode === 'test' ? 'STRIPE_TEST_PRICE_ID' : 'STRIPE_LIVE_PRICE_ID'}).`);
}

// Simple request logger to help debug incoming calls (method, path, origin)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Origin: ${req.headers.origin || req.ip}`);
  next();
});

// IMPORTANT: Use raw body ONLY for Stripe webhook; JSON for all other routes
const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.originalUrl === '/stripe/webhook') return next();
  return jsonParser(req, res, next);
});

// Ensure preflight for create-stripe-customer is handled
app.options('/create-stripe-customer', cors());

// Endpoint: crea/recupera Stripe Customer para el user verificado por idToken
app.post('/create-stripe-customer', async (req, res) => {
  console.log('Received request to /create-stripe-customer');
  try {
    if (!admin.apps?.length || !db) {
      return res.status(500).json({ error: 'Firebase Admin no inicializado' });
    }

    // idToken en header Authorization: Bearer <idToken> o en body.idToken
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || req.body.email || null;
    const name = decoded.name || req.body.name || null;

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data().stripeCustomerId) {
      return res.json({ customerId: userDoc.data().stripeCustomerId, exists: true });
    }

    if (!process.env.STRIPE_SECRET) {
      return res.status(500).json({ error: 'Stripe no configurado' });
    }

    // crear customer en Stripe
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { firebaseUid: uid }
    });

    await userRef.set({
      email,
      name,
      stripeCustomerId: customer.id,
      stripeCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ customerId: customer.id, exists: false });
  } catch (err) {
    console.error('create-stripe-customer error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Webhook endpoint (usa raw body). Define ANTES de json parser (o exclúyelo, como arriba)
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // fija para este endpoint
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET no configurado');
    return res.status(500).send('Webhook no configurado');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  async function grantAccessByUid(uid, data = {}) {
    if (!db) return;
    const ref = db.collection('users').doc(uid);
    const base = { access: true, lastPaymentAt: admin.firestore.FieldValue.serverTimestamp() };
    // Evitar campos undefined en Firestore
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await ref.set({ ...base, ...clean }, { merge: true });
  }
  async function grantAccessByCustomerId(customerId, data = {}) {
    if (!db) return false;
    const snap = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const base = { access: true, lastPaymentAt: admin.firestore.FieldValue.serverTimestamp() };
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      await doc.ref.set({ ...base, ...clean }, { merge: true });
      return true;
    }
    return false;
  }
  async function grantAccessByEmail(email, customerId, data = {}) {
    if (!db || !email) return false;
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const base = { access: true, lastPaymentAt: admin.firestore.FieldValue.serverTimestamp() };
      const extra = { stripeCustomerId: customerId || doc.get('stripeCustomerId') || null };
      const clean = Object.fromEntries(Object.entries({ ...data, ...extra }).filter(([, v]) => v !== undefined));
      await doc.ref.set({ ...base, ...clean }, { merge: true });
      return true;
    }
    return false;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.client_reference_id || session.metadata?.firebaseUid || null;
        const customerId = session.customer || null;
        const email = session.customer_details?.email || null;
        const paymentLinkId = session.payment_link || null;
        const data = { lastCheckoutSessionId: session.id, lastPaymentLinkId: paymentLinkId || null };
        if (uid) {
          await grantAccessByUid(uid, { ...(customerId ? { stripeCustomerId: customerId } : {}), ...data });
        } else if (customerId) {
          const ok = await grantAccessByCustomerId(customerId, data);
          if (!ok && email) await grantAccessByEmail(email, customerId, data);
        } else if (email) {
          await grantAccessByEmail(email, null, data);
        }
        // Dar permiso de Drive si tenemos email
        if (email) {
          await addDriveReaderPermission(email).catch((e) => console.warn('[Drive] permiso error:', e?.message || e));
        }
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const customerId = pi.customer || null;
        const email = (pi.charges && pi.charges.data && pi.charges.data[0]?.billing_details?.email) || null;
        const data = { lastPaymentIntentId: pi.id };
        if (customerId) {
          const ok = await grantAccessByCustomerId(customerId, data);
          if (!ok && email) await grantAccessByEmail(email, customerId, data);
        } else if (email) {
          await grantAccessByEmail(email, null, data);
        }
        if (email) {
          await addDriveReaderPermission(email).catch((e) => console.warn('[Drive] permiso error:', e?.message || e));
        }
        break;
      }
      default:
        console.log('Unhandled event type', event.type);
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handling error', e);
    res.status(500).send('Webhook handler failed');
  }
});

// Endpoint: crear Payment Link (crea Price y Payment Link)
// Body: { unit_amount: 1200, currency: 'usd', product_name: 'Luxury NYX - Full Access' }
app.post('/create-paylink', async (req, res) => {
  try {
    const { unit_amount, currency = 'usd', product_name } = req.body || {};
    if (!unit_amount || !product_name) return res.status(400).json({ error: 'unit_amount and product_name required' });

    // Reutilizar Price/Product globales
    const { priceId } = await getOrCreateDefaultPrice({ product_name, unit_amount, currency });
    const paymentLink = await stripe.paymentLinks.create({ line_items: [{ price: priceId, quantity: 1 }] });

    return res.json({ url: paymentLink.url, paymentLinkId: paymentLink.id, priceId });
  } catch (err) {
    console.error('create-paylink error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Ensure preflight for create-checkout-session is handled
app.options('/create-checkout-session', cors());

// Endpoint: crear Checkout Session de Stripe asociada al customer del usuario
// Body: { unit_amount: 1200, currency: 'usd', product_name: 'Luxury NYX - Full Access', success_path?: '/success', cancel_path?: '/cancel' }
app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!admin.apps?.length || !db) return res.status(500).json({ error: 'Firebase Admin no inicializado' });
    if (!process.env.STRIPE_SECRET) return res.status(500).json({ error: 'Stripe no configurado' });

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || req.body.email || null;
    const name = decoded.name || req.body.name || null;

    const { unit_amount, currency = 'usd', product_name } = req.body || {};
    if (!unit_amount || !product_name) return res.status(400).json({ error: 'unit_amount and product_name required' });

    // Asegurar customer
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    let customerId = userDoc.exists ? userDoc.data().stripeCustomerId : null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, name, metadata: { firebaseUid: uid } });
      customerId = customer.id;
      await userRef.set({
        email,
        name,
        stripeCustomerId: customer.id,
        stripeCreatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Reutilizar Price/Product globales
    const { priceId } = await getOrCreateDefaultPrice({ product_name, unit_amount, currency });

    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const success_path = req.body.success_path || '/';
    const cancel_path = req.body.cancel_path || '/';
    const success_url = `${origin.replace(/\/$/, '')}${success_path}?success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${origin.replace(/\/$/, '')}${cancel_path}?canceled=true`;

    // Crear sesión de Checkout usando el mismo price
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      client_reference_id: uid,
      metadata: { firebaseUid: uid }
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Preflight CORS para user-paylink
app.options('/user-paylink', cors());

// Helper: añadir query param a una URL (usado para prefilled_email en Payment Links)
function appendQueryParam(url, key, value) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + encodeURIComponent(key) + '=' + encodeURIComponent(value);
  }
}

// Endpoint: crear o recuperar Payment Link único por usuario
// Body: { unit_amount: 1200, currency: 'usd', product_name: 'Luxury NYX - Full Access', success_path?: '/success', cancel_path?: '/cancel' }
app.post('/user-paylink', async (req, res) => {
  try {
    if (!admin.apps?.length || !db) return res.status(500).json({ error: 'Firebase Admin no inicializado' });
    if (!process.env.STRIPE_SECRET) return res.status(500).json({ error: 'Stripe no configurado' });

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || req.body.email || null;
    const name = decoded.name || req.body.name || null;

    const { unit_amount = 1200, currency = 'usd', product_name = 'Luxury NYX - Full Access' } = req.body || {};

    // Use global Price/Product (respect env STRIPE_* and mode)
    const { priceId, productId, mode } = await getOrCreateDefaultPrice({ product_name, unit_amount, currency });

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    // Reuse only if price AND mode match
    if (userDoc.exists) {
      const d = userDoc.data();
      if (d && d.stripePaylinkUrl && d.stripePaylinkId && d.stripePriceId === priceId && d.stripeMode === mode) {
        const url = email ? appendQueryParam(d.stripePaylinkUrl, 'prefilled_email', email) : d.stripePaylinkUrl;
        return res.json({ url, paymentLinkId: d.stripePaylinkId, priceId });
      }
    }

    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const success_path = req.body.success_path || '/';
    const success_url = `${origin.replace(/\/$/, '')}${success_path}?paid=true`;

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { firebaseUid: uid },
      customer_creation: 'if_required',
      after_completion: { type: 'redirect', redirect: { url: success_url } },
    });

    const returnUrl = email ? appendQueryParam(paymentLink.url, 'prefilled_email', email) : paymentLink.url;

    await userRef.set({
      email,
      name,
      stripeMode: mode,
      stripePaylinkId: paymentLink.id,
      stripePaylinkUrl: paymentLink.url,
      stripePriceId: priceId,
      stripeProductId: productId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ url: returnUrl, paymentLinkId: paymentLink.id, priceId, productId });
  } catch (err) {
    console.error('user-paylink error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Preflight CORS para billing-portal
app.options('/billing-portal', cors());

// Endpoint: crear sesión del Billing Portal de Stripe para que el usuario gestione pagos y métodos
app.post('/billing-portal', async (req, res) => {
  try {
    if (!admin.apps?.length || !db) return res.status(500).json({ error: 'Firebase Admin no inicializado' });
    if (!process.env.STRIPE_SECRET) return res.status(500).json({ error: 'Stripe no configurado' });

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || req.body.email || null;
    const name = decoded.name || req.body.name || null;

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    let customerId = userDoc.exists ? userDoc.data().stripeCustomerId : null;
    if (!customerId) {
      // Crear customer si no existe
      const customer = await stripe.customers.create({ email, name, metadata: { firebaseUid: uid } });
      customerId = customer.id;
      await userRef.set({
        email,
        name,
        stripeCustomerId: customer.id,
        stripeCreatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const return_url = `${origin.replace(/\/$/, '')}/?billing=done`;

    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url });
    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('billing-portal error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Public config for client (Drive folder URL)
app.get('/config', (req, res) => {
  const folderId = process.env.DRIVE_FOLDER_ID || null;
  const driveFolderUrlEnv = process.env.DRIVE_FOLDER_URL || null;
  const driveFolderUrl = driveFolderUrlEnv || (folderId ? `https://drive.google.com/drive/folders/${folderId}?usp=sharing` : null);
  res.json({ driveFolderId: folderId, driveFolderUrl });
});

// Simple health endpoint for client-side health checks
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Use port 3000 by default (avoids conflict with Live Server on 5500)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

// Endpoint protegido: datos del usuario autenticado
app.get('/me', async (req, res) => {
  try {
    if (!admin.apps?.length || !db) return res.status(500).json({ error: 'Firebase Admin no inicializado' });
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!idToken) return res.status(401).json({ error: 'Missing idToken' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return res.json({ uid, email: decoded.email || null, name: decoded.name || null, access: false });
    const d = doc.data();
    return res.json({
      uid,
      email: d.email || decoded.email || null,
      name: d.name || decoded.name || null,
      access: !!d.access,
      stripeCustomerId: d.stripeCustomerId || null,
      stripePaylinkUrl: d.stripePaylinkUrl || null,
      stripePaylinkId: d.stripePaylinkId || null
    });
  } catch (err) {
    console.error('/me error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Endpoint protegido: redirige a la carpeta de Drive solo si access === true
app.get('/drive', async (req, res) => {
  try {
    if (!admin.apps?.length || !db) return res.status(500).send('Firebase Admin no inicializado');
    const driveUrl = process.env.DRIVE_FOLDER_URL || (process.env.DRIVE_FOLDER_ID ? `https://drive.google.com/drive/folders/${process.env.DRIVE_FOLDER_ID}?usp=sharing` : null);
    if (!driveUrl) return res.status(500).send('Drive no configurado');

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const token = bearer || req.query.token || null;
    if (!token) return res.status(401).send('Missing token');

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const doc = await db.collection('users').doc(uid).get();
    const access = doc.exists ? !!doc.data().access : false;
    if (!access) return res.status(403).send('No autorizado');

    // Redirigir a Drive
    return res.redirect(driveUrl);
  } catch (err) {
    console.error('/drive error', err);
    return res.status(500).send('server error');
  }
});

// Admin endpoint: reset user paylink cache so a new one is generated (e.g., when switching modes)
app.post('/admin/reset-paylink', async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: 'Firestore no disponible' });
    const token = req.headers['x-admin-token'];
    if (!token || token !== process.env.STRIPE_ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const targetUid = req.body && req.body.uid;

    let uid = targetUid;
    if (!uid) {
      if (!idToken) return res.status(400).json({ error: 'Missing idToken or uid' });
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    }

    await db.collection('users').doc(uid).set({
      stripePaylinkId: admin.firestore.FieldValue.delete(),
      stripePaylinkUrl: admin.firestore.FieldValue.delete(),
      stripePriceId: admin.firestore.FieldValue.delete(),
      stripeProductId: admin.firestore.FieldValue.delete(),
      stripeMode: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    return res.json({ ok: true, uid });
  } catch (e) {
    console.error('reset-paylink error', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
});

// Admin: probar acceso a Drive y listar metadatos básicos de la carpeta
app.get('/admin/test-drive', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'];
    if (!token || token !== process.env.STRIPE_ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

    const folderId = getDriveFolderId();
    if (!folderId) return res.status(400).json({ error: 'DRIVE_FOLDER_ID/URL no configurado' });
    const drive = await getDrive();
    if (!drive) return res.status(500).json({ error: 'No se pudo inicializar Drive' });

    const meta = await drive.files.get({ fileId: folderId, fields: 'id,name,permissions(kind,role,emailAddress,domain),owners(emailAddress),shared' });
    return res.json({ ok: true, folder: meta.data });
  } catch (e) {
    const code = e?.code || e?.response?.status || 500;
    return res.status(500).json({ ok: false, code, error: e?.message || String(e) });
  }
});

// Admin: otorgar permiso de lector a un email manualmente
app.post('/admin/grant-drive', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'];
    if (!token || token !== process.env.STRIPE_ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    const email = (req.body && req.body.email) || req.query.email;
    if (!email) return res.status(400).json({ error: 'email requerido' });

    const ok = await addDriveReaderPermission(email);
    return res.json({ ok, email });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

//# sourceMappingURL=index.js.map
