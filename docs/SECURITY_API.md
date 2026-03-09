# Security Enhancements - Backend API Documentation

## Overview
This document describes the backend API endpoints required to support the new security enhancements in the Phase client:
- Hardware Key (YubiKey) Support via WebAuthn
- Password Breach Monitoring (Have I Been Pwned integration)
- Enhanced Biometric Authentication

## 1. WebAuthn / Hardware Key APIs

### 1.1 Begin Registration
**Endpoint:** `POST /api/v1/webauthn/register/begin`

**Description:** Initiates the WebAuthn registration process for a new hardware key.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional, for self-hosted)
Content-Type: application/json
```

**Request Body:** None

**Response:** `200 OK`
```json
{
  "challenge": "base64_encoded_challenge",
  "rp": {
    "name": "Phase",
    "id": "phase.app"
  },
  "user": {
    "id": "base64_encoded_user_id",
    "name": "user@example.com",
    "displayName": "User Name"
  },
  "pubKeyCredParams": [
    {
      "type": "public-key",
      "alg": -7
    },
    {
      "type": "public-key",
      "alg": -257
    }
  ],
  "timeout": 60000,
  "attestation": "none",
  "authenticatorSelection": {
    "authenticatorAttachment": "cross-platform",
    "requireResidentKey": false,
    "userVerification": "preferred"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid or missing JWT
- `500 Internal Server Error` - Server error

---

### 1.2 Finish Registration
**Endpoint:** `POST /api/v1/webauthn/register/finish`

**Description:** Completes the WebAuthn registration by verifying the attestation.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
Content-Type: application/json
```

**Request Body:**
```json
{
  "credentialId": "base64_encoded_credential_id",
  "attestation": "base64_encoded_attestation_object",
  "name": "YubiKey 5C"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "credentialId": "base64_encoded_credential_id"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid attestation or challenge mismatch
- `401 Unauthorized` - Invalid JWT
- `409 Conflict` - Credential already registered
- `500 Internal Server Error` - Server error

---

### 1.3 Begin Authentication
**Endpoint:** `POST /api/v1/webauthn/authenticate/begin`

**Description:** Initiates WebAuthn authentication challenge.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
Content-Type: application/json
```

**Request Body:** None

**Response:** `200 OK`
```json
{
  "challenge": "base64_encoded_challenge",
  "timeout": 60000,
  "rpId": "phase.app",
  "allowCredentials": [
    {
      "type": "public-key",
      "id": "base64_encoded_credential_id"
    }
  ],
  "userVerification": "preferred"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid JWT
- `404 Not Found` - No credentials registered
- `500 Internal Server Error` - Server error

---

### 1.4 Finish Authentication
**Endpoint:** `POST /api/v1/webauthn/authenticate/finish`

**Description:** Verifies the WebAuthn authentication response.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
Content-Type: application/json
```

**Request Body:**
```json
{
  "credentialId": "base64_encoded_credential_id",
  "signature": "base64_encoded_signature",
  "authenticatorData": "base64_encoded_authenticator_data",
  "clientDataJSON": "base64_encoded_client_data_json"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "verified": true
}
```

**Error Responses:**
- `400 Bad Request` - Invalid signature or challenge mismatch
- `401 Unauthorized` - Invalid JWT
- `500 Internal Server Error` - Server error

---

### 1.5 List Credentials
**Endpoint:** `GET /api/v1/webauthn/credentials`

**Description:** Lists all registered WebAuthn credentials for the user.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
```

**Response:** `200 OK`
```json
{
  "credentials": [
    {
      "id": "credential_id",
      "name": "YubiKey 5C",
      "createdAt": 1678901234,
      "lastUsedAt": 1678901234
    }
  ]
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid JWT
- `500 Internal Server Error` - Server error

---

### 1.6 Delete Credential
**Endpoint:** `DELETE /api/v1/webauthn/credentials/{credentialId}`

**Description:** Removes a registered WebAuthn credential.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
```

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid JWT
- `404 Not Found` - Credential not found
- `500 Internal Server Error` - Server error

---

## 2. Implementation Notes

### 2.1 WebAuthn Server-Side Requirements

**Dependencies:**
- Use a WebAuthn library for your backend language:
  - Go: `github.com/go-webauthn/webauthn`
  - Python: `webauthn`
  - Node.js: `@simplewebauthn/server`
  - Rust: `webauthn-rs`

**Storage Requirements:**
Store the following for each credential:
```sql
CREATE TABLE webauthn_credentials (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    public_key BYTEA NOT NULL,
    credential_id BYTEA NOT NULL,
    aaguid BYTEA,
    sign_count INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_webauthn_user_id ON webauthn_credentials(user_id);
```

**Challenge Storage:**
Store challenges temporarily (5 minutes TTL):
```sql
CREATE TABLE webauthn_challenges (
    user_id VARCHAR(255) PRIMARY KEY,
    challenge BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);
```

### 2.2 Security Considerations

1. **Challenge Generation:**
   - Generate cryptographically secure random challenges (32 bytes minimum)
   - Store challenges server-side with 5-minute expiration
   - Validate challenge matches during verification

2. **Relying Party ID:**
   - Set `rpId` to your domain (e.g., `phase.app`)
   - Ensure it matches the origin of the client

3. **Attestation:**
   - Use `attestation: "none"` for privacy (recommended)
   - Or use `"direct"` if you need to verify specific authenticator models

4. **User Verification:**
   - Use `"preferred"` for better UX
   - Use `"required"` for high-security scenarios

5. **Sign Counter:**
   - Track and validate the sign counter to detect cloned authenticators
   - Increment on each successful authentication

### 2.3 Testing

**Test with:**
- YubiKey 5 Series (USB-A, USB-C, NFC)
- Google Titan Security Key
- Windows Hello
- Touch ID (macOS)
- Android biometrics

**Test scenarios:**
1. Register new credential
2. Authenticate with registered credential
3. Remove credential
4. Multiple credentials per user
5. Challenge expiration
6. Invalid signature rejection

---

## 3. Password Breach Monitoring

### 3.1 Client-Side Implementation (Already Done)

The client already implements HIBP (Have I Been Pwned) checking:
- Uses k-Anonymity model (only first 5 chars of SHA-1 hash sent)
- Implemented in `SetupPage.tsx` (line 47-70)
- No backend changes required

### 3.2 Optional: Server-Side Breach Checking

If you want to add server-side breach checking for additional security:

**Endpoint:** `POST /api/v1/security/check-password-breach`

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
Content-Type: application/json
```

**Request Body:**
```json
{
  "passwordHash": "first_5_chars_of_sha1_hash"
}
```

**Response:** `200 OK`
```json
{
  "breached": true,
  "count": 12345
}
```

**Implementation:**
```python
import requests

def check_password_breach(password_hash_prefix):
    url = f"https://api.pwnedpasswords.com/range/{password_hash_prefix}"
    response = requests.get(url)
    return response.text
```

---

## 4. Biometric Authentication Enhancement

### 4.1 Current Implementation
The client already supports biometric authentication via Tauri plugin:
- `@tauri-apps/plugin-biometric` (already in package.json)
- Implemented in `src/lib/biometric.ts`

### 4.2 Optional: Server-Side Biometric Session Validation

**Endpoint:** `POST /api/v1/auth/biometric/validate`

**Description:** Validates a biometric authentication session.

**Headers:**
```
Authorization: Bearer <JWT>
X-Instance-Token: <instance_token> (optional)
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "device_unique_id",
  "biometricToken": "encrypted_biometric_token"
}
```

**Response:** `200 OK`
```json
{
  "valid": true,
  "sessionExtended": true
}
```

---

## 5. Migration Guide

### 5.1 Database Migrations

**Step 1:** Create WebAuthn tables
```sql
-- Run this migration first
CREATE TABLE webauthn_credentials (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    public_key BYTEA NOT NULL,
    credential_id BYTEA NOT NULL,
    aaguid BYTEA,
    sign_count INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE webauthn_challenges (
    user_id VARCHAR(255) PRIMARY KEY,
    challenge BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_webauthn_user_id ON webauthn_credentials(user_id);
CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
```

**Step 2:** Add cleanup job for expired challenges
```sql
-- Run periodically (every 5 minutes)
DELETE FROM webauthn_challenges WHERE expires_at < NOW();
```

### 5.2 Backend Implementation Checklist

- [ ] Install WebAuthn library for your backend language
- [ ] Create database tables for credentials and challenges
- [ ] Implement `/api/v1/webauthn/register/begin` endpoint
- [ ] Implement `/api/v1/webauthn/register/finish` endpoint
- [ ] Implement `/api/v1/webauthn/authenticate/begin` endpoint
- [ ] Implement `/api/v1/webauthn/authenticate/finish` endpoint
- [ ] Implement `/api/v1/webauthn/credentials` (GET) endpoint
- [ ] Implement `/api/v1/webauthn/credentials/{id}` (DELETE) endpoint
- [ ] Add challenge cleanup cron job
- [ ] Test with physical hardware keys
- [ ] Update API documentation
- [ ] Add rate limiting to prevent abuse

---

## 6. Example Implementation (Go)

```go
package webauthn

import (
    "encoding/json"
    "net/http"
    "time"

    "github.com/go-webauthn/webauthn/webauthn"
)

type WebAuthnHandler struct {
    webAuthn *webauthn.WebAuthn
    db       *Database
}

func (h *WebAuthnHandler) BeginRegistration(w http.ResponseWriter, r *http.Request) {
    user := getUserFromContext(r.Context())

    options, session, err := h.webAuthn.BeginRegistration(user)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    // Store session/challenge in database with 5-minute expiration
    err = h.db.StoreChallenge(user.ID, session.Challenge, time.Now().Add(5*time.Minute))
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    json.NewEncoder(w).Encode(options)
}

func (h *WebAuthnHandler) FinishRegistration(w http.ResponseWriter, r *http.Request) {
    user := getUserFromContext(r.Context())

    // Parse request
    var req struct {
        CredentialID string `json:"credentialId"`
        Attestation  string `json:"attestation"`
        Name         string `json:"name"`
    }
    json.NewDecoder(r.Body).Decode(&req)

    // Retrieve stored challenge
    session, err := h.db.GetChallenge(user.ID)
    if err != nil {
        http.Error(w, "Challenge not found or expired", http.StatusBadRequest)
        return
    }

    // Verify attestation
    credential, err := h.webAuthn.FinishRegistration(user, *session, r)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }

    // Store credential in database
    err = h.db.StoreCredential(user.ID, credential, req.Name)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    // Clean up challenge
    h.db.DeleteChallenge(user.ID)

    json.NewEncoder(w).Encode(map[string]interface{}{
        "success":      true,
        "credentialId": req.CredentialID,
    })
}
```

---

## 7. Frontend Integration (Already Complete)

The frontend code is already implemented:
- `src/lib/webauthn.ts` - WebAuthn client library
- `src/components/security/HardwareKeyManager.tsx` - UI component
- `src/components/security/PasswordBreachMonitor.tsx` - HIBP checker
- `src/components/settings/SettingsPage.tsx` - Integration

---

## 8. Testing Endpoints

Use these curl commands to test your implementation:

```bash
# 1. Begin registration
curl -X POST https://your-server.com/api/v1/webauthn/register/begin \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json"

# 2. Finish registration
curl -X POST https://your-server.com/api/v1/webauthn/register/finish \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "credentialId": "...",
    "attestation": "...",
    "name": "YubiKey 5C"
  }'

# 3. List credentials
curl -X GET https://your-server.com/api/v1/webauthn/credentials \
  -H "Authorization: Bearer YOUR_JWT"

# 4. Delete credential
curl -X DELETE https://your-server.com/api/v1/webauthn/credentials/CREDENTIAL_ID \
  -H "Authorization: Bearer YOUR_JWT"
```

---

## 9. Security Best Practices

1. **Always use HTTPS** - WebAuthn requires secure context
2. **Validate origin** - Ensure requests come from your domain
3. **Rate limit** - Prevent brute force attacks
4. **Log authentication attempts** - Monitor for suspicious activity
5. **Implement CORS properly** - Restrict to your frontend domain
6. **Use secure session storage** - Encrypt challenges at rest
7. **Implement account recovery** - Don't lock users out if they lose their key
8. **Support multiple keys** - Allow users to register backup keys

---

## 10. Support & Resources

- WebAuthn Spec: https://www.w3.org/TR/webauthn-2/
- FIDO Alliance: https://fidoalliance.org/
- Have I Been Pwned API: https://haveibeenpwned.com/API/v3
- Yubico Developer: https://developers.yubico.com/
