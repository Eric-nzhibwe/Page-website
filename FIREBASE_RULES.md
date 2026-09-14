# Firebase Configuration for Voice Notes

## 1. Firebase Storage Rules

Paste these into **Firebase Console → Storage → Rules**:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Voice notes: any authenticated user can read any voice note,
    // but can only write to their own path.
    // Since ARTX uses Django token auth (not Firebase Auth), we allow
    // public read for voice note URLs and restrict writes by path convention.
    match /voice-notes/{conversationId}/{fileName} {
      allow read: if true;           // anyone with the URL can play
      allow write: if true;          // allow upload (tighten once Firebase Auth is added)
    }
  }
}
```

> **Note:** If you later add Firebase Authentication to the frontend, replace
> `if true` with `if request.auth != null` for both read and write rules.
> The write rule can be further scoped to `request.auth.uid` matching the
> user ID embedded in the file path.

---

## 2. Firestore Rules

Paste these into **Firebase Console → Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /messenger_conversations/{convId} {
      // Any client can read conversation documents (messages are loaded by the frontend)
      allow read: if true;
      // Writes come only from the Django backend (Admin SDK bypasses these rules)
      allow write: if false;

      match /messages/{msgId} {
        allow read: if true;
        // Allow the frontend to write voice message docs directly
        // (the Django backend will also write via Admin SDK)
        allow create: if true;
        allow update, delete: if false;
      }
    }
  }
}
```

> For tighter security once Firebase Auth is integrated:
> Replace `allow read: if true` with `allow read: if request.auth != null`
> and add participant checks.

---

## 3. Required Firestore Index

Create this composite index in **Firebase Console → Firestore → Indexes**:

| Collection              | Field           | Order |
|-------------------------|-----------------|-------|
| messenger_conversations | participant_ids | ASC (Array Contains) |
| messenger_conversations | updated_at      | DESC  |

Firebase will prompt you to create this index automatically the first time
the conversation list query runs — just click the link in the browser console.

---

## 4. CORS for Firebase Storage (optional but recommended)

If voice notes fail to play cross-origin, configure CORS on the Storage bucket.
Install `gsutil` and run:

```bash
gsutil cors set cors.json gs://YOUR-BUCKET-NAME.appspot.com
```

Where `cors.json` is:
```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]
```

---

## 5. Environment Variables Checklist

Ensure these are set in your `.env` (and on Render):

```
# Firebase Admin SDK (server-side — secret)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=...

# Firebase Web SDK (public — safe to expose)
FIREBASE_WEB_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=1:...:web:...
```
