import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { CallHistoryScreen } from './src/screens/CallHistoryScreen';
import { IncomingCallModal } from './src/screens/IncomingCallModal';
import { ActiveCallScreen } from './src/screens/ActiveCallScreen';
import { mobileSocketService } from './src/services/socket';
import { setupPushNotifications } from './src/services/push';
import { setAuthToken } from './src/services/api';

type Screen = 'dashboard' | 'history' | 'active_call';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard');

  // Incoming Call State
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    callType: 'voice' | 'video';
    tokenLabel?: string;
  } | null>(null);

  // Active Call State
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    callType: 'voice' | 'video';
  } | null>(null);

  useEffect(() => {
    setupPushNotifications();
  }, []);

  const handleLoginSuccess = (userData: any, token: string) => {
    setUser(userData);
    setAuthToken(token);
    mobileSocketService.authenticate(token);
    setupSocketListeners();
  };

  const setupSocketListeners = () => {
    const socket = mobileSocketService.getSocket();
    if (!socket) return;

    socket.off('incoming-call');
    socket.off('call-cancelled');
    socket.off('call-missed');
    socket.off('call-ended');

    socket.on('incoming-call', (data: { callId: string; callType: 'voice' | 'video'; tokenLabel?: string }) => {
      console.log('[Mobile App] Received incoming call:', data);
      setIncomingCall(data);
    });

    socket.on('call-cancelled', () => {
      setIncomingCall(null);
    });

    socket.on('call-missed', () => {
      setIncomingCall(null);
    });

    socket.on('call-ended', () => {
      setIncomingCall(null);
      setActiveCall(null);
      setCurrentScreen('dashboard');
    });
  };

  const handleAcceptIncomingCall = () => {
    if (!incomingCall) return;
    const socket = mobileSocketService.getSocket();
    socket?.emit('call-accept', { callId: incomingCall.callId });

    setActiveCall({
      callId: incomingCall.callId,
      callType: incomingCall.callType
    });
    setIncomingCall(null);
    setCurrentScreen('active_call');
  };

  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    const socket = mobileSocketService.getSocket();
    socket?.emit('call-decline', { callId: incomingCall.callId });
    setIncomingCall(null);
  };

  const handleLogout = () => {
    mobileSocketService.disconnect();
    setUser(null);
    setAuthToken(null);
    setCurrentScreen('dashboard');
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <AuthScreen onLoginSuccess={handleLoginSuccess} />
      </View>
    );
  }

  if (currentScreen === 'active_call' && activeCall) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <ActiveCallScreen
          callId={activeCall.callId}
          callType={activeCall.callType}
          onEndCall={() => {
            setActiveCall(null);
            setCurrentScreen('dashboard');
          }}
        />
      </View>
    );
  }

  if (currentScreen === 'history') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <CallHistoryScreen onBack={() => setCurrentScreen('dashboard')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <DashboardScreen
        user={user}
        onLogout={handleLogout}
        onViewHistory={() => setCurrentScreen('history')}
      />

      <IncomingCallModal
        visible={!!incomingCall}
        callData={incomingCall}
        onAccept={handleAcceptIncomingCall}
        onDecline={handleDeclineIncomingCall}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
});
