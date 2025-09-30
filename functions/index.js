const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const Stripe = require('stripe');

admin.initializeApp();

// Secrets (configúralos con: firebase functions:secrets:set STRIPE_SECRET y STRIPE_WEBHOOK_SECRET)
const STRIPE_SECRET = defineSecret('STRIPE_SECRET');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

// Helper: get Stripe instance
function getStripe() {
  const key = process.env.STRIPE_SECRET;
  if (!key) throw new Error('STRIPE_SECRET no configurado');
  return new Stripe(key);
}

// Health check
exports.health = onRequest((req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), env: 'functions' });
});

// Create/Retrieve Stripe Customer for authenticated user
exports.createStripeCustomer = onRequest({ secrets: [STRIPE_SECRET] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (req.body && req.body.idToken);
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || (req.body && req.body.email) || null;
    const name = decoded.name || (req.body && req.body.name) || null;

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data().stripeCustomerId) {
      return res.json({ customerId: userDoc.data().stripeCustomerId, exists: true });
    }

    const stripe = getStripe();
    const customer = await stripe.customers.create({ email, name, metadata: { firebaseUid: uid } });

    await userRef.set({
      email,
      name,
      stripeCustomerId: customer.id,
      stripeCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ customerId: customer.id, exists: false });
  } catch (err) {
    console.error('createStripeCustomer error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Create a Stripe Payment Link
exports.createPaylink = onRequest({ secrets: [STRIPE_SECRET] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { unit_amount, currency = 'usd', product_name } = req.body || {};
    if (!unit_amount || !product_name) return res.status(400).json({ error: 'unit_amount and product_name required' });

    const stripe = getStripe();
    const product = await stripe.products.create({ name: product_name });
    const price = await stripe.prices.create({ unit_amount, currency, product: product.id });
    const paymentLink = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }] });

    return res.json({ url: paymentLink.url, paymentLinkId: paymentLink.id, priceId: price.id, productId: product.id });
  } catch (err) {
    console.error('createPaylink error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Stripe Webhook (use req.rawBody)
exports.stripeWebhook = onRequest({ secrets: [STRIPE_WEBHOOK_SECRET] }, (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET no configurado');
      return res.status(500).send('Webhook no configurado');
    }

    const stripe = getStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed':
        console.log('checkout.session.completed', event.data.object.id);
        break;
      case 'payment_intent.succeeded':
        console.log('payment_intent.succeeded', event.data.object.id);
        break;
      default:
        console.log('Unhandled event type', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('stripeWebhook error', err);
    res.status(500).send('server error');
  }
});

// v1-style auth triggers retained for convenience
const functionsV1 = require('firebase-functions');
exports.createUser = functionsV1.auth.user().onCreate((user) => {
  const userData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  return admin.firestore().collection('users').doc(user.uid).set(userData);
});

exports.deleteUser = functionsV1.auth.user().onDelete((user) => {
  return admin.firestore().collection('users').doc(user.uid).delete();
});