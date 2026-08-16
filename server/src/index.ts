import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase } from './db';
import { registerUser, loginUser, getCurrentUser, requireAuth } from './auth';
import { listOwnerTokens, createOwnerToken, revokeToken, rotateToken, validateLinkToken, getLatestActiveToken, getTurnCredentials } from './tokens';
import { registerPushToken } from './push';
import { getCallHistory } from './history';
import { authRateLimiter, tokenValidationLimiter, callInitiateLimiter } from './rateLimit';
import { setupSocketIO } from './socket';

dotenv.config();

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Initialize Database
initDatabase();

// Authentication Routes
app.post('/api/auth/register', authRateLimiter, registerUser);
app.post('/api/auth/login', authRateLimiter, loginUser);
app.get('/api/me', requireAuth, getCurrentUser);

// Owner Private Calling Links Routes
app.get('/api/tokens', requireAuth, listOwnerTokens);
app.post('/api/tokens', requireAuth, createOwnerToken);
app.post('/api/tokens/:tokenId/revoke', requireAuth, revokeToken);
app.post('/api/tokens/:tokenId/rotate', requireAuth, rotateToken);

// Guest Calling Link Validation Route
app.get('/api/call-links/latest-active', getLatestActiveToken);
app.get('/api/call-links/:token/validate', tokenValidationLimiter, validateLinkToken);

// WebRTC TURN Credential Provisioning
app.get('/api/webrtc/turn-credentials', getTurnCredentials);

// Push Notification Token Registration
app.post('/api/push/register', requireAuth, registerPushToken);

// Call History Route
app.get('/api/calls/history', requireAuth, getCallHistory);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Setup Socket.IO Signaling Server
setupSocketIO(io);

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`Server running on http://0.0.0.0:${PORT} (LAN: http://192.168.0.122:${PORT})`);
  console.log(`Socket.IO signaling ready.`);
  console.log(`=======================================================`);
});

export { app, server };
