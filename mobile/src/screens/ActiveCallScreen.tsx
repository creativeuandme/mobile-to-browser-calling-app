import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { MobileWebRTCManager, RTCViewComponent } from '../services/webrtc';
import { fetchTurnCredentials } from '../services/api';
import { mobileSocketService } from '../services/socket';

interface ActiveCallScreenProps {
  callId: string;
  callType: 'voice' | 'video';
  onEndCall: () => void;
}

export const ActiveCallScreen: React.FC<ActiveCallScreenProps> = ({
  callId,
  callType,
  onEndCall
}) => {
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(true);
  const [speakerOn, setSpeakerOn] = useState<boolean>(false); // DEFAULT: EARPIECE MODE
  const [connectionState, setConnectionState] = useState<string>('connecting');
  const [remoteMediaState, setRemoteMediaState] = useState<{ audioEnabled: boolean; videoEnabled: boolean }>({
    audioEnabled: true,
    videoEnabled: true
  });

  const [webrtcManager] = useState<MobileWebRTCManager>(() => new MobileWebRTCManager());

  useEffect(() => {
    async function startMedia() {
      try {
        const iceServers = await fetchTurnCredentials();
        await webrtcManager.initializeCall(callId, callType, iceServers, {
          onLocalStream: (s) => setLocalStream(s),
          onRemoteStream: (s) => setRemoteStream(s),
          onConnectionStateChange: (state) => setConnectionState(state),
          onRemoteMediaStateChange: (state) => setRemoteMediaState(state)
        });
      } catch (err) {
        console.error('Failed to initialize mobile WebRTC call:', err);
      }
    }

    startMedia();

    return () => {
      webrtcManager.cleanup();
    };
  }, [callId]);

  const handleToggleMic = () => {
    const next = !micEnabled;
    setMicEnabled(next);
    webrtcManager.toggleMicrophone(next);
  };

  const handleToggleCamera = () => {
    const next = !cameraEnabled;
    setCameraEnabled(next);
    webrtcManager.toggleCamera(next);
  };

  const handleSwitchCamera = () => {
    webrtcManager.switchCamera();
  };

  const handleToggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    webrtcManager.setSpeakerphone(next);
  };

  const handleEndCallPressed = () => {
    mobileSocketService.getSocket()?.emit('call-end', { callId });
    webrtcManager.cleanup();
    onEndCall();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Audio Output Element for Web Browser Execution */}
      {Platform.OS === 'web' && remoteStream && (
        <audio
          ref={(ref) => {
            if (ref && ref.srcObject !== remoteStream) {
              ref.srcObject = remoteStream;
              ref.muted = false;
              ref.volume = 1.0;
              ref.play().catch((e) => console.warn('[Mobile App Web] Remote audio play error:', e));
            }
          }}
          autoPlay
          playsInline
        />
      )}

      {/* Media View */}
      {callType === 'video' ? (
        <View style={styles.videoContainer}>
          {remoteStream && RTCViewComponent ? (
            <RTCViewComponent
              streamURL={remoteStream.toURL ? remoteStream.toURL() : remoteStream}
              style={styles.remoteVideo}
              objectFit="cover"
            />
          ) : (
            <View style={styles.placeholderRemote}>
              <Text style={styles.placeholderText}>
                {remoteMediaState.videoEnabled ? 'Waiting for Guest Video...' : 'Guest Camera Off'}
              </Text>
            </View>
          )}

          {/* Local PIP Video */}
          {localStream && RTCViewComponent && (
            <View style={styles.localPipContainer}>
              <RTCViewComponent
                streamURL={localStream.toURL ? localStream.toURL() : localStream}
                style={styles.localVideo}
                objectFit="cover"
                mirror={true}
              />
            </View>
          )}
        </View>
      ) : (
        /* Voice Call UI */
        <View style={styles.voiceContainer}>
          <View style={styles.voiceAvatar}>
            <Text style={styles.voiceAvatarText}>📞</Text>
          </View>
          <Text style={styles.callerName}>Private Caller</Text>
          <Text style={styles.voiceConnectedText}>Voice Call Active</Text>
          {!remoteMediaState.audioEnabled && (
            <View style={styles.peerMutedBadge}>
              <Text style={styles.peerMutedText}>Guest Muted Microphone</Text>
            </View>
          )}
        </View>
      )}

      {/* Connection State Badge */}
      {connectionState !== 'connected' && (
        <View style={styles.connectionBadge}>
          <Text style={styles.connectionBadgeText}>
            {connectionState === 'connecting' ? 'Connecting Media...' : 'Reconnecting...'}
          </Text>
        </View>
      )}

      {/* Control Bar */}
      <View style={styles.controlsBar}>
        <TouchableOpacity
          style={[styles.controlBtn, !micEnabled && styles.controlBtnOff]}
          onPress={handleToggleMic}
        >
          <Text style={styles.controlBtnText}>{micEnabled ? '🎙️ Mute' : '🔇 Muted'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, speakerOn && styles.controlBtnActive]}
          onPress={handleToggleSpeaker}
        >
          <Text style={styles.controlBtnText}>{speakerOn ? '🔊 Speaker' : '📞 Earpiece'}</Text>
        </TouchableOpacity>

        {callType === 'video' && (
          <>
            <TouchableOpacity
              style={[styles.controlBtn, !cameraEnabled && styles.controlBtnOff]}
              onPress={handleToggleCamera}
            >
              <Text style={styles.controlBtnText}>{cameraEnabled ? '📷 Cam On' : '🚫 Cam Off'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn} onPress={handleSwitchCamera}>
              <Text style={styles.controlBtnText}>🔄 Switch</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCallPressed}>
          <Text style={styles.endCallBtnText}>📞 End</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
  remoteVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  placeholderRemote: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 16,
  },
  localPipContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 110,
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  voiceContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  voiceAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 2,
    borderColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  voiceAvatarText: {
    fontSize: 50,
  },
  callerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 6,
  },
  voiceConnectedText: {
    fontSize: 14,
    color: '#22c55e',
    fontWeight: '600',
  },
  peerMutedBadge: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  peerMutedText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
  },
  connectionBadge: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  connectionBadgeText: {
    color: '#090d16',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#131c2e',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  controlBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  controlBtnOff: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#ef4444',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10b981',
  },
  controlBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  endCallBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  endCallBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
