import React, { useEffect, useState } from 'react';
import { GuestCallPage } from './components/GuestCallPage';

export const App: React.FC = () => {
  const [token, setToken] = useState<string>('my-private-call');

  useEffect(() => {
    // Parse /call/:token from pathname or query param ?token=
    const path = window.location.pathname;
    const match = path.match(/\/call\/([a-zA-Z0-9_-]+)/i);

    if (match && match[1]) {
      setToken(match[1]);
    } else {
      const searchParams = new URLSearchParams(window.location.search);
      const qToken = searchParams.get('token');
      if (qToken) {
        setToken(qToken);
      }
    }
  }, []);

  return <GuestCallPage token={token} />;
};

export default App;
