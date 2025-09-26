require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
// Servir archivos estáticos (index.html, success.html, assets)
app.use(express.static(path.join(__dirname)));

// Crear sesión de Stripe Checkout
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { price_id, product_id } = req.body;
    if (!price_id) return res.status(400).json({ error: 'price_id required' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/`,
      customer_creation: 'always',
      metadata: { product_id }
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error('create-checkout-session error', err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook de Stripe (usar raw body para verificar firma)
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details && session.customer_details.email;
      const productId = session.metadata && session.metadata.product_id;
      console.log('Pago confirmado:', session.id, 'email:', email, 'product:', productId);

      if (email) {
        try {
          const perm = await grantDriveAccess(email);
          console.log('Drive access granted:', perm);
          // Enviar correo de confirmación con link al folder (si está disponible)
          if (perm && perm.webViewLink) {
            try {
              await sendPurchaseEmail(email, perm.webViewLink, session.id);
              console.log('Confirmation email sent to', email);
            } catch (e) {
              console.error('sendPurchaseEmail failed', e);
            }
          } else {
            console.log('No webViewLink available to include in confirmation email');
          }
          // TODO: guardar registro en DB si necesitas auditar/revocar
        } catch (err) {
          console.error('grantDriveAccess failed', err);
        }
      } else {
        console.warn('No se encontró email en session:', session.id);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Cliente Google Drive usando Service Account JSON (ruta en env)
function getDriveClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error('GOOGLE_APPLICATION_CREDENTIALS no configurado');
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return google.drive({ version: 'v3', auth });
}

// Otorga permiso reader por email a la carpeta (DRIVE_FOLDER_ID)
async function grantDriveAccess(email) {
  const drive = getDriveClient();
  const FOLDER_ID = process.env.DRIVE_FOLDER_ID;
  if (!FOLDER_ID) throw new Error('DRIVE_FOLDER_ID no configurado');

  const permission = {
    type: 'user',
    role: 'reader',
    emailAddress: email
  };

  try {
    const res = await drive.permissions.create({
      fileId: FOLDER_ID,
      requestBody: permission,
      sendNotificationEmail: true,
      emailMessage: 'Gracias por tu compra. Te hemos dado acceso a Luxury NYX.'
    });

    // Obtener enlace view del folder para incluir en correo propio
    const fileInfo = await drive.files.get({ fileId: FOLDER_ID, fields: 'id, name, webViewLink' });
    return { permission: res.data, webViewLink: fileInfo.data.webViewLink || null };
  } catch (err) {
    // manejar caso miembro ya existente
    try {
      const errStr = JSON.stringify(err.errors || err);
      if (errStr.includes('member_already_exists') || errStr.includes('user_already_permission')) {
        console.log('Usuario ya es miembro:', email);
        // aun así obtener webViewLink para enviar correo personalizado
        try {
          const fileInfo = await drive.files.get({ fileId: FOLDER_ID, fields: 'id, name, webViewLink' });
          return { notice: 'already_member', webViewLink: fileInfo.data.webViewLink || null };
        } catch (e) {
          return { notice: 'already_member' };
        }
      }
    } catch (e) {}
    throw err;
  }
}

// Enviar email de confirmación al comprador con el enlace al folder
async function sendPurchaseEmail(toEmail, webViewLink, sessionId) {
  // Verificar si hay configuración SMTP en .env
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('SMTP no configurado. Omite enviar correo personalizado. Confía en la notificación de Google Drive.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const html = `
    <p>Gracias por tu compra. Aquí está el acceso a tu carpeta privada en Google Drive:</p>
    <p><a href="${webViewLink}">${webViewLink}</a></p>
    <p>Importante: asegúrate de abrir el link con la misma cuenta de Google que usaste en el pago.</p>
    <p>ID de la sesión: ${sessionId}</p>
  `;

  const mailOptions = {
    from: FROM_EMAIL,
    to: toEmail,
    subject: 'Acceso a tu compra - Luxury NYX',
    html
  };

  return transporter.sendMail(mailOptions);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
