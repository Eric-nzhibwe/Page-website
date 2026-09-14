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

    // ── Notifications ─────────────────────────────────────────────────────
    // Users can read their own notifications and mark them read.
    // All writes (create) come from the Django backend (Admin SDK bypasses rules).
    match /notifications/{notifId} {
      // Read: only the recipient can read their own notifications
      allow read: if true;          // tighten to `request.auth.uid == resource.data.recipient_id` once Firebase Auth is added
      allow create: if false;       // backend only (Admin SDK)
      allow update: if true;        // allow client-side mark-as-read
      allow delete: if false;
    }

    // ── Messenger conversations ───────────────────────────────────────────
    match /messenger_conversations/{convId} {
      allow read: if true;
      allow write: if false;        // backend writes via Admin SDK

      match /messages/{msgId} {
        allow read:   if true;
        allow create: if true;      // allow direct voice note writes from client
        allow update, delete: if false;
      }
    }

    // ── Social posts ──────────────────────────────────────────────────────
    match /social_posts/{postId} {
      allow read:  if true;
      allow write: if false;        // backend only

      match /comments/{commentId} {
        allow read:  if true;
        allow write: if false;
      }
      match /reactions/{userId} {
        allow read:  if true;
        allow write: if false;
      }
    }

  }
}
```

> **Upgrading to Firebase Auth:** Replace `if true` read rules with
> `if request.auth != null` once you integrate Firebase Authentication
> on the frontend. This prevents unauthenticated reads.

---

## 3. Required Firestore Indexes

Create these composite indexes in **Firebase Console → Firestore → Indexes → Composite**.
Firebase will often prompt you to create them automatically — click the link in the browser console.

### messenger_conversations
| Field           | Order |
|-----------------|-------|
| participant_ids | ASC (Array Contains) |
| updated_at      | DESC  |

### notifications
| Field        | Order |
|--------------|-------|
| recipient_id | ASC   |
| created_at   | DESC  |

| Field        | Order |
|--------------|-------|
| recipient_id | ASC   |
| is_read      | ASC   |
| created_at   | DESC  |

### social_posts (if using Firestore social flag)
| Field     | Order |
|-----------|-------|
| author_id | ASC   |
| created_at | DESC |

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
