# Luxury NYX

Landing page with backend to grant Google Drive access after Stripe Checkout.

Setup

1. Copy `.env.example` to `.env` and fill the values.
2. Download a Google Service Account JSON and save it as `credentials-service-account.json` (or change `GOOGLE_APPLICATION_CREDENTIALS` in `.env`).
3. Install dependencies:

   npm install

4. Start the server:

   npm start

Local webhook testing

- Use ngrok to expose your local server: `ngrok http 3000` and copy the HTTPS URL.
- In Stripe Dashboard -> Developers -> Webhooks add endpoint: `https://<NGROK_ID>.ngrok.io/webhook/stripe` and copy the signing secret into `.env` as `STRIPE_WEBHOOK_SECRET`.

Stripe

- Use your Stripe Dashboard to create a Product and Price. Put the Price ID in the frontend `index.html` when creating the checkout session.

Google Drive

- Ensure the Service Account has access to the Drive folder (share the folder with the service account email or make the service account the folder owner).
- Set `DRIVE_FOLDER_ID` in `.env` to the folder ID.

Security

- Do not commit `.env` or `credentials-service-account.json` to the repository.

License: MIT
