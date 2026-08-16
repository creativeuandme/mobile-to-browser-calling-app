const socketClient = require('socket.io-client').io;

const BACKEND_URL = 'http://localhost:5000';

async function testFullCallTrigger() {
  console.log('--- Testing Full Call Signaling Trigger ---');

  // 1. Authenticate Owner
  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'password123' })
  });
  const loginData = await loginRes.json();
  console.log('1. Owner Logged In. User ID:', loginData.user.id);

  const ownerSocket = socketClient(BACKEND_URL, { transports: ['websocket', 'polling'] });
  ownerSocket.emit('authenticate-owner', { token: loginData.token });

  await new Promise((resolve) => {
    ownerSocket.on('incoming-call', (data: any) => {
      console.log('✅ SUCCESS! Owner socket received incoming-call event:', data);
      resolve(true);
    });

    setTimeout(async () => {
      // 2. Validate Link as Guest
      const valRes = await fetch(`${BACKEND_URL}/api/call-links/my-private-call/validate`);
      const valData: any = await valRes.json();
      console.log('2. Guest Validated Token:', valData);

      // 3. Authenticate Guest Socket & Initiate Call
      const guestSocket = socketClient(BACKEND_URL, { transports: ['websocket', 'polling'] });
      guestSocket.emit('guest-authenticate', { guestSessionId: valData.guest_session_id });

      guestSocket.on('authenticated', () => {
        console.log('3. Guest Socket Authenticated. Initiating Call...');
        guestSocket.emit('call-initiate', {
          guestSessionId: valData.guest_session_id,
          tokenId: valData.token_id,
          callType: 'voice'
        });
      });

      guestSocket.on('call-ringing', (data: any) => {
        console.log('4. Guest received call-ringing:', data);
      });

      guestSocket.on('call-error', (err: any) => {
        console.error('❌ Guest received call-error:', err);
      });

      guestSocket.on('call-busy', (err: any) => {
        console.error('❌ Guest received call-busy:', err);
      });
    }, 1000);
  });

  ownerSocket.disconnect();
  process.exit(0);
}

testFullCallTrigger().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
