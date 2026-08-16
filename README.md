# Mobile-to-Browser Real-Time Calling System

A production-quality mobile-to-browser calling system built with Node.js, Express, Socket.IO, React + Vite, and React Native (Expo Development Build).

## Architecture

- **`mobile/`**: Genuine React Native + Expo owner application for receiving calls, link management, presence, and call history.
- **`web/`**: React + Vite zero-install guest web application allowing guests to call via private HTTPS link without registration.
- **`server/`**: Node.js + Express + Socket.IO + SQLite backend managing authentication, link validation, temporary guest sessions, call state machine, push dispatch, and dynamic TURN credential generation.
- **WebRTC & TURN**: Direct P2P audio/video media streams with STUN/TURN fallback. Media never passes through the server.

---

## Production Deployment & Environment Variables

### 1. Backend Server (`server/`)
Create `server/.env` based on `server/.env.example`:
```env
PORT=5000
NODE_ENV=production
DATABASE_PATH=./calling_app.db
JWT_SECRET=your_production_jwt_secret
WEB_ORIGIN=https://call.example.com
API_PUBLIC_URL=https://api.example.com

TURN_HOST=turn.example.com
TURN_PORT=3478
TURN_SECRET=your_turn_shared_secret
```
Build & run:
```bash
cd server
npm install
npm run build
npm start
```

### 2. Web Guest App (`web/`)
Create `web/.env` based on `web/.env.example`:
```env
VITE_API_BASE_URL=https://api.example.com/api
VITE_SOCKET_URL=https://api.example.com
```
Build static bundle:
```bash
cd web
npm install
npm run build
```
Deploy the resulting `web/dist/` directory to your NGINX / Cloudflare Pages / Vercel host with SPA client-side routing fallback for `/call/:token`.

### 3. Owner Mobile App (`mobile/`)
Create `mobile/.env` or set environment variables:
```env
EXPO_PUBLIC_API_BASE_URL=https://api.example.com/api
EXPO_PUBLIC_SOCKET_URL=https://api.example.com
EXPO_PUBLIC_WEB_BASE_URL=https://call.example.com
```
Build Expo Development / Production binary:
```bash
cd mobile
npm install
npx expo run:android
# or npx expo run:ios / eas build
```

---

## Push to GitHub Instructions

To push this project to your GitHub repository:

```bash
# 1. Initialize git repository (if not already initialized)
git init

# 2. Add remote repository URL
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 3. Stage files
git add .

# 4. Commit changes
git commit -m "feat: complete production-ready mobile-to-browser calling app"

# 5. Push to GitHub main branch
git branch -M main
git push -u origin main
```

---

## Features
- 🔒 **Cryptographic Private Calling Links** (`crypto.randomBytes(32)` hashed with SHA-256)
- 🎙️ **Voice & Video Real-Time WebRTC Calling**
- ⚡ **Dynamic TURN Credential Provisioning** (HMAC-SHA1)
- 🔔 **FCM Push Notification Dispatch**
- 📊 **Call History & Server-Authoritative State Machine**
- 📱 **Zero-Install Guest Calling Experience**
