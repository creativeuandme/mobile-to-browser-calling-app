import React, { useEffect, useState } from 'react';
import { GuestCallPage } from './components/GuestCallPage';
import { OwnerDashboardPage } from './components/OwnerDashboardPage';

export const App: React.FC = () => {
  const [token, setToken] = useState<string>('my-private-call');
  const [isOwnerMode, setIsOwnerMode] = useState<boolean>(false);

  useEffect(() => {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);

    // Check if visiting owner dashboard (/owner or ?mode=owner)
    if (path.startsWith('/owner') || searchParams.get('mode') === 'owner') {
      setIsOwnerMode(true);
      return;
    }

    // Parse /call/:token or ?token=
    const match = path.match(/\/call\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      setToken(match[1]);
    } else {
      const qToken = searchParams.get('token');
      if (qToken) {
        setToken(qToken);
      }
    }
  }, []);

  if (isOwnerMode) {
    return <OwnerDashboardPage />;
  }

  return <GuestCallPage token={token} />;
};

export default App;
