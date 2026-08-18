const socketClient = require('socket.io-client').io;

const PRODUCTION_API = 'https://calling-media-backend.onrender.com';

async function testProductionCloudLive() {
  console.log('--- Testing Live 24/7 Render Cloud Backend ---');

  // 1. Health Check
  const healthRes = await fetch(`${PRODUCTION_API}/api/health`);
  const healthData = await healthRes.json();
  console.log('1. Health Check:', healthData);

  // 2. Validate Link Token
  const valRes = await fetch(`${PRODUCTION_API}/api/call-links/my-private-call/validate`);
  const valData: any = await valRes.json();
  console.log('2. Validate Link Token:', valData);

  // 3. Authenticate Owner Socket
  const loginRes = await fetch(`${PRODUCTION_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'password123' })
  });
  const loginData: any = await loginRes.json();
  console.log('3. Owner Login SUCCESS. User ID:', loginData.user.id);

  const ownerSocket = socketClient(PRODUCTION_API, { transports: ['websocket', 'polling'] });

  await new Promise((resolve) => {
    ownerSocket.on('connect', () => {
      console.log('4. Owner Socket Connected ID:', ownerSocket.id);
      ownerSocket.emit('authenticate-owner', { token: loginData.token });
    });

    ownerSocket.on('authenticated', (authData: any) => {
      console.log('5. Owner Socket Authenticated Event:', authData);

      // Now Connect Guest Socket & Initiate Call
      const guestSocket = socketClient(PRODUCTION_API, { transports: ['websocket', 'polling'] });

      guestSocket.on('connect', () => {
        console.log('6. Guest Socket Connected ID:', guestSocket.id);
        guestSocket.emit('guest-authenticate', {
          guestSessionId: valData.guest_session_id,
          tokenId: valData.token_id
        });
      });

      guestSocket.on('authenticated', (gAuthData: any) => {
        console.log('7. Guest Socket Authenticated Event:', gAuthData);
        console.log('8. Emitting call-initiate from Guest to Owner...');

        guestSocket.emit('call-initiate', {
          guestSessionId: valData.guest_session_id,
          tokenId: valData.token_id,
          callType: 'voice'
        });
      });

      guestSocket.on('call-ringing', (ringData: any) => {
        console.log('9. Guest Received call-ringing:', ringData);
      });
    });

    ownerSocket.on('incoming-call', (callAlert: any) => {
      console.log('✅ 10. SUCCESS! Owner Socket Received INCOMING CALL ALERT:', callAlert);
      resolve(true);
    });
  });

  ownerSocket.disconnect();
  console.log('--- Production Cloud Test Complete ---');
  process.exit(0);
}

testProductionCloudLive().catch((err) => {
  console.error('Production test error:', err);
  process.exit(1);
});
