import assert from 'assert';
import crypto from 'crypto';
import { db, initDatabase } from '../db';
import { hashToken, generateSecureToken, generateTurnCredentials } from '../security';
import { createCallSession, updateCallStatus, archiveCallSession } from '../calls';

async function runTests() {
  console.log('\n--- Starting Backend System Tests ---\n');

  // Test 1: Database Initialization
  initDatabase();
  console.log('✓ Test 1 Passed: SQLite Database initialized successfully.');

  // Test 2: Secure Token Generation and SHA-256 Hashing
  const rawToken = generateSecureToken();
  assert.strictEqual(rawToken.length, 64, 'Raw token should be 64 hex characters');
  const tokenHash = hashToken(rawToken);
  assert.strictEqual(tokenHash.length, 64, 'Token hash should be 64 hex characters');
  assert.notStrictEqual(rawToken, tokenHash, 'Raw token must not equal hash');
  console.log('✓ Test 2 Passed: Cryptographic 256-bit token generation & SHA-256 hashing verified.');

  // Test 3: TURN Credential Generation
  const turnCreds = generateTurnCredentials('testuser');
  assert(turnCreds.iceServers.length >= 2, 'ICE servers should include STUN and TURN');
  const turnServer = turnCreds.iceServers[1] as any;
  assert(turnServer && turnServer.username && turnServer.username.includes('testuser'), 'TURN username should contain identifier');
  console.log('✓ Test 3 Passed: Dynamic TURN credential provisioning verified.');

  // Test 4: User Creation & Token Storage
  const userId = crypto.randomUUID();
  const email = `owner_${Date.now()}@example.com`;
  db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(
    userId, email, 'hashed_pwd_test', 'Test Owner'
  );

  const tokenId = crypto.randomUUID();
  db.prepare('INSERT INTO call_tokens (id, owner_id, token_hash, label) VALUES (?, ?, ?, ?)').run(
    tokenId, userId, tokenHash, 'Test Link'
  );

  const savedToken = db.prepare('SELECT * FROM call_tokens WHERE id = ?').get(tokenId) as any;
  assert.strictEqual(savedToken.owner_id, userId);
  console.log('✓ Test 4 Passed: Owner user and token database persistence verified.');

  // Test 5: Temporary Guest Session
  const guestSessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  db.prepare('INSERT INTO guest_sessions (id, token_id, expires_at) VALUES (?, ?, ?)').run(
    guestSessionId, tokenId, expiresAt
  );

  const savedGuest = db.prepare('SELECT * FROM guest_sessions WHERE id = ?').get(guestSessionId) as any;
  assert.strictEqual(savedGuest.token_id, tokenId);
  console.log('✓ Test 5 Passed: Temporary Guest Session creation verified.');

  // Test 6: Call Concurrency & State Machine
  const callResult = createCallSession(userId, tokenId, guestSessionId, 'video');
  assert.strictEqual(callResult.success, true);
  const callId = callResult.call!.call_id;

  // Attempt second call to same owner -> expect busy
  const guestSessionId2 = crypto.randomUUID();
  db.prepare('INSERT INTO guest_sessions (id, token_id, expires_at) VALUES (?, ?, ?)').run(
    guestSessionId2, tokenId, expiresAt
  );
  const callResult2 = createCallSession(userId, tokenId, guestSessionId2, 'voice');
  assert.strictEqual(callResult2.success, false, 'Second incoming call should receive busy state');
  console.log('✓ Test 6 Passed: Call concurrency & busy state protection verified.');

  // Test 7: Call Transition to Connected and Archive with Duration
  updateCallStatus(callId, 'accepted');
  updateCallStatus(callId, 'connected');
  
  // Simulate delay
  await new Promise(r => setTimeout(r, 1100));

  archiveCallSession(callId, 'ended');

  const history = db.prepare('SELECT * FROM call_history WHERE call_id = ?').get(callId) as any;
  assert.strictEqual(history.status, 'ended');
  assert(history.duration_seconds >= 1, `Duration should be at least 1 second, got ${history.duration_seconds}`);
  console.log('✓ Test 7 Passed: Call connection duration calculation (connected_at to ended_at) verified.');

  console.log('\n=======================================================');
  console.log('ALL BACKEND INTEGRATION TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================\n');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
