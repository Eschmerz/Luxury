# Luxury NYX Firebase Project

## Overview
This project is a web application that utilizes Firebase for backend services, including authentication and hosting. The application allows users to sign in using their Google accounts and access premium video clips.

## Project Structure
```
luxury-nyx-firebase
├── public
│   ├── index.html          # Main HTML document
│   ├── js
│   │   ├── app.js         # Main JavaScript logic
│   │   └── firebase-auth.js # Firebase Authentication logic
│   ├── css
│   │   └── styles.css      # Styles for the application
│   └── Media               # Directory for media files
├── functions
│   ├── index.js            # Backend logic for Firebase Cloud Functions
│   └── package.json        # Configuration for Firebase functions
├── .firebaserc             # Firebase project configuration
├── firebase.json           # Configuration for Firebase Hosting and Functions
├── .gitignore              # Files to ignore in Git
├── package.json            # npm configuration
└── README.md               # Project documentation
```

## Setup Instructions

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd luxury-nyx-firebase
   ```

2. **Install Dependencies**
   Navigate to the `functions` directory and install the necessary dependencies:
   ```bash
   cd functions
   npm install
   ```

3. **Firebase Configuration**
   - Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
   - Add your web app to the Firebase project and copy the Firebase configuration object.
   - Replace the placeholder in your `public/js/firebase-auth.js` file with your Firebase configuration.

4. **Environment Variables (.env)**
   Create a `.env` file in the root directory with the following content:
   ```
   PORT=3000
   STRIPE_SECRET=sk_live_or_test_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   # Path to service account JSON if using manual credentials
   # GOOGLE_APPLICATION_CREDENTIALS=./credentials-service-account.json
   ```

5. **Running Locally (PowerShell)**
   - Install dependencies:
     ```bash
     npm install
     ```
   - Start the server:
     ```bash
     npm run dev
     ```
   - Test health check:
     ```bash
     Invoke-WebRequest http://localhost:3000/health | Select-Object -ExpandProperty Content
     ```
   - Configure Stripe webhook (in a separate terminal):
     ```bash
     stripe listen --forward-to localhost:3000/stripe/webhook
     ```

6. **Firebase Emulators (Optional)**
   - Update `functions/package.json` to use Node 18.
   - Run Firebase emulators:
     ```bash
     npm run serve:firebase
     ```

7. **Frontend Configuration**
   - Edit `index.html` and the `backend-origin` meta tag according to the environment.
   - Authentication modules are located in `frontend/public/js/`.
   - The call-to-action triggers `handlePurchase`, which creates a Payment Link via the backend.

8. **Deploying to Firebase**
   - Install the Firebase CLI if you haven't already:
     ```bash
     npm install -g firebase-tools
     ```
   - Log in to Firebase:
     ```bash
     firebase login
     ```
   - Deploy the application:
     ```bash
     firebase deploy
     ```

## Usage
- Open the application in your web browser.
- Click on the "Mi cuenta" button to open the account modal.
- Sign in with your Google account to access premium content.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for more details.

## Notes
- Do not expose your service account JSON or keys in the repository.
- The webhook requires the raw body. It is already separated from the JSON parser.