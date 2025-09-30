// Simple test script to validate Stripe API key and create a test customer
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
(async () => {
  try {
    console.log('Using STRIPE_SECRET from env (masked):', !!process.env.STRIPE_SECRET);
    const c = await stripe.customers.create({ email: 'test@example.com', name: 'Test User' });
    console.log('Created customer:', c.id);
  } catch (err) {
    console.error('Stripe test error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
