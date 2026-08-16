import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken } from './api';

export async function setupPushNotifications() {
  try {
    if (Platform.OS === 'web') return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission denied');
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log('[Push] Registered Push Token:', tokenData.data);
    await registerPushToken(tokenData.data, Platform.OS);

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('incoming-calls', {
        name: 'Incoming Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#22c55e',
        sound: 'default'
      });
    }
  } catch (err) {
    console.warn('[Push] Error initializing push notifications:', err);
  }
}
