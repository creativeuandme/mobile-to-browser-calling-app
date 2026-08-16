import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';

interface IncomingCallModalProps {
  visible: boolean;
  callData: {
    callId: string;
    callType: 'voice' | 'video';
    tokenLabel?: string;
  } | null;
  onAccept: () => void;
  onDecline: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  visible,
  callData,
  onAccept,
  onDecline
}) => {
  if (!callData) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarIcon}>
              {callData.callType === 'video' ? '🎥' : '📞'}
            </Text>
          </View>

          <Text style={styles.incomingLabel}>INCOMING CALL</Text>
          <Text style={styles.callerTitle}>{callData.tokenLabel || 'Private Caller'}</Text>
          <Text style={styles.callTypeBadge}>
            {callData.callType === 'video' ? 'Video Call' : 'Voice Call'}
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.button, styles.declineButton]} onPress={onDecline}>
              <Text style={styles.buttonText}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.acceptButton]} onPress={onAccept}>
              <Text style={styles.buttonText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  avatarCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 2,
    borderColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  avatarIcon: {
    fontSize: 48,
  },
  incomingLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#22c55e',
    letterSpacing: 2,
  },
  callerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginTop: 8,
  },
  callTypeBadge: {
    fontSize: 15,
    color: '#94a3b8',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 20,
    width: '100%',
    marginBottom: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: 'center',
    elevation: 6,
  },
  declineButton: {
    backgroundColor: '#ef4444',
  },
  acceptButton: {
    backgroundColor: '#16a34a',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
