import React, { useEffect, useState, useRef } from 'react';
import {
  Phone,
  Video,
  Mic,
  MicOff,
  VideoOff,
  SwitchCamera,
  PhoneOff,
  ShieldCheck,
  AlertCircle,
  Clock,
  UserCheck,
  Lock,
  Volume2,
  Volume1
} from 'lucide-react';
import { validateCallLink, fetchTurnCredentials, LinkValidationResponse } from '../services/api';
import { socketService } from '../services/socket';
import { WebRTCManager } from '../services/webrtc';

interface GuestCallPageProps {
  token: string;
}

type Step = 'validating' | 'invalid' | 'choose' | 'calling' | 'active' | 'ended';

export const GuestCallPage: React.FC<GuestCallPageProps> = ({ token }) => {
  const [step, setStep] = useState<Step>('validating');
  const [validation, setValidation] = useState<LinkValidationResponse | null>(null);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [callId, setCallId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(30);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Active call media controls
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(true);
  const [speakerOn, setSpeakerOn] = useState<boolean>(false); // DEFAULT: EARPIECE MODE
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState<boolean>(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState<boolean>(true);
  const [connectionState, setConnectionState] = useState<string>('connecting');

  // Video references
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const webRtcManagerRef = useRef<WebRTCManager | null>(null);

  // 1. Validate Link on Load
  useEffect(() => {
    async function checkToken() {
      let cleanToken = token.trim();
      const match = cleanToken.match(/\/call\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        cleanToken = match[1];
      }

      const res = await validateCallLink(cleanToken);
      setValidation(res);
      if (res.valid) {
        setStep('choose');
      } else {
        setStep('invalid');
      }
    }
    checkToken();
  }, [token]);

  // 2. Manage 30-Second Ringing Countdown
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (step === 'calling' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Clean up WebRTC & Socket on Unmount
  useEffect(() => {
    return () => {
      if (webRtcManagerRef.current) {
        webRtcManagerRef.current.cleanup();
      }
      socketService.disconnect();
    };
  }, []);

  // Initiate Call Flow
  const startCall = async (type: 'voice' | 'video') => {
    if (!validation || !validation.guest_session_id || !validation.token_id) return;
    setCallType(type);
    setPermissionError(null);

    // Pre-unlock browser web audio context inside touch event
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(() => {});
    }

    // Connect Socket.IO
    const socket = socketService.connect();

    socket.off('authenticated');
    socket.off('incoming-call');
    socket.off('call-ringing');
    socket.off('call-accepted');
    socket.off('call-declined');
    socket.off('call-busy');
    socket.off('call-missed');
    socket.off('call-ended');

    // Authenticate & Initiate Call over Socket.IO
    socket.emit('guest-authenticate', {
      guestSessionId: validation.guest_session_id,
      tokenId: validation.token_id
    });

    socket.emit('call-initiate', {
      guestSessionId: validation.guest_session_id,
      tokenId: validation.token_id,
      callType: type
    });

    socket.on('incoming-call', (data: { callId: string; callType: 'voice' | 'video' }) => {
      console.log('[Guest] Incoming call received from Owner:', data);
      setCallId(data.callId);
      setCallType(data.callType);
      setStatusMessage('Incoming call from Owner...');
      // Auto accept or show incoming dialog
      socket.emit('call-accept', { callId: data.callId });
    });

    socket.on('call-ringing', (data: { callId: string }) => {
      setCallId(data.callId);
      setStep('calling');
      setCountdown(30);
      setStatusMessage(`Ringing ${validation.owner_display_name || 'Owner'}...`);
    });

    socket.on('call-accepted', async (data: { callId: string }) => {
      setCallId(data.callId);
      setStatusMessage('Connecting secure WebRTC media...');
      await setupWebRTC(data.callId, type);
      setStep('active');
    });

    socket.on('call-declined', (data: { message?: string }) => {
      setStatusMessage(data.message || 'Call Declined by Owner.');
      setStep('ended');
    });

    socket.on('call-busy', (data: { message?: string }) => {
      setStatusMessage(data.message || 'The user is currently busy on another call.');
      setStep('ended');
    });

    socket.on('call-missed', (data: { message?: string }) => {
      setStatusMessage(data.message || 'No answer. Call ended.');
      setStep('ended');
    });

    socket.on('call-ended', (data: { reason?: string }) => {
      setStatusMessage('Call Ended.');
      if (webRtcManagerRef.current) {
        webRtcManagerRef.current.cleanup();
      }
      setStep('ended');
    });
  };

  // Setup WebRTC Media
  const setupWebRTC = async (activeCallId: string, type: 'voice' | 'video') => {
    try {
      const iceServers = await fetchTurnCredentials();
      const manager = new WebRTCManager();
      webRtcManagerRef.current = manager;

      await manager.initializeCall(activeCallId, type, iceServers, {
        onLocalStream: (stream) => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        },
        onRemoteStream: (stream) => {
          console.log('[Guest Call Page] Remote stream received. Audio tracks:', stream.getAudioTracks().length);
          stream.getAudioTracks().forEach((track) => {
            track.enabled = true;
          });

          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.muted = false;
            remoteAudioRef.current.volume = 1.0;
            remoteAudioRef.current.play().catch((e) => {
              console.warn('[Guest Call Page] Remote audio play error:', e);
            });
          }

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            remoteVideoRef.current.play().catch((e) => console.warn('Remote video play error:', e));
          }
        },
        onConnectionStateChange: (state) => {
          setConnectionState(state);
        },
        onRemoteMediaStateChange: (state) => {
          setRemoteAudioEnabled(state.audioEnabled);
          setRemoteVideoEnabled(state.videoEnabled);
        }
      });

      // Create initial SDP offer as caller
      await manager.createOffer();
    } catch (err: any) {
      console.error('WebRTC initialization error:', err);
      setPermissionError('Microphone/Camera permission is required to start the call.');
      setStep('choose');
    }
  };

  const handleCancelCall = () => {
    if (callId) {
      socketService.getSocket()?.emit('call-cancel', { callId });
    }
    setStep('choose');
  };

  const handleEndCall = () => {
    if (callId) {
      socketService.getSocket()?.emit('call-end', { callId });
    }
    if (webRtcManagerRef.current) {
      webRtcManagerRef.current.cleanup();
    }
    setStep('ended');
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (remoteAudioRef.current && (remoteAudioRef.current as any).setSinkId) {
      (remoteAudioRef.current as any).setSinkId(next ? 'speaker' : 'default').catch(() => {});
    }
  };

  const toggleMic = () => {
    const next = !micEnabled;
    setMicEnabled(next);
    webRtcManagerRef.current?.toggleMicrophone(next);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    setCameraEnabled(next);
    webRtcManagerRef.current?.toggleCamera(next);
  };

  const handleSwitchCamera = async () => {
    await webRtcManagerRef.current?.switchCamera();
  };

  // --- RENDER VIEWS ---

  if (step === 'validating') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-200">Validating Secure Link...</h2>
        <p className="text-sm text-slate-400 mt-2">Checking session & cryptographic token</p>
      </div>
    );
  }

  if (step === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Link Unavailable</h1>
          <p className="text-slate-400 mb-6">
            {validation?.reason || 'This calling link is invalid, expired, or has been revoked by the owner.'}
          </p>
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-500 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            End-to-End Encrypted Calling Infrastructure
          </div>
        </div>
      </div>
    );
  }

  if (step === 'choose') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-lg border border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <UserCheck className="w-10 h-10" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
            <Lock className="w-3 h-3" /> Private Link Verified
          </span>

          <h1 className="text-2xl font-bold text-white mb-1">
            Call {validation?.owner_display_name || 'Private Contact'}
          </h1>
          <p className="text-sm text-slate-400 mb-8">
            Select call mode. No app installation or registration needed.
          </p>

          {permissionError && (
            <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-xl text-sm flex items-start gap-3 text-left">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{permissionError}</p>
                <p className="text-xs text-red-400/80 mt-1">
                  Please tap the lock icon in your browser address bar to allow Microphone and Camera permissions.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => startCall('voice')}
              className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-900/30 transition-all transform active:scale-95"
            >
              <Phone className="w-5 h-5 fill-current" />
              Voice Call
            </button>

            <button
              onClick={() => startCall('video')}
              className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-slate-800 hover:bg-slate-700 text-white font-semibold border border-slate-700 rounded-2xl transition-all transform active:scale-95"
            >
              <Video className="w-5 h-5 text-emerald-400" />
              Video Call
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'calling') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-between p-8 text-center bg-slate-950">
        <div className="mt-12">
          <div className="w-24 h-24 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 animate-ring-pulse">
            {callType === 'video' ? <Video className="w-12 h-12" /> : <Phone className="w-12 h-12" />}
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{validation?.owner_display_name || 'Owner'}</h2>
          <p className="text-emerald-400 font-medium text-sm mb-2">{statusMessage}</p>
          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5" /> Timeout in {countdown}s
          </div>
        </div>

        <div className="mb-12">
          <button
            onClick={handleCancelCall}
            className="flex items-center gap-2 py-3 px-8 bg-red-600 hover:bg-red-500 text-white font-medium rounded-full shadow-lg transition-all"
          >
            <PhoneOff className="w-5 h-5" />
            Cancel Call
          </button>
        </div>
      </div>
    );
  }

  if (step === 'ended') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="w-16 h-16 bg-slate-800 border border-slate-700 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <PhoneOff className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">{statusMessage || 'Call Ended'}</h2>
          <p className="text-sm text-slate-400 mb-6">Thank you for using private calling.</p>
          <button
            onClick={() => setStep('choose')}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition-all"
          >
            Call Again
          </button>
        </div>
      </div>
    );
  }

  // Active Call Screen
  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col justify-between overflow-hidden">
      {/* Invisible Audio Element for Voice & Video Stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Main Remote View */}
      {callType === 'video' ? (
        <div className="relative w-full h-full flex-1 bg-black flex items-center justify-center">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          {!remoteVideoEnabled && (
            <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <VideoOff className="w-16 h-16 mb-2 text-slate-600" />
              <p className="text-sm font-medium">Owner Camera Off</p>
            </div>
          )}

          {/* PIP Local Preview */}
          <div className="absolute top-6 right-6 w-32 h-48 bg-slate-900 border-2 border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!cameraEnabled && (
              <div className="absolute inset-0 bg-slate-950 flex items-center justify-center text-xs text-slate-500">
                Off
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Voice Call Interface */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-32 h-32 bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Volume2 className="w-16 h-16" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">
            {validation?.owner_display_name || 'Private Contact'}
          </h2>
          <p className="text-emerald-400 text-sm font-medium mb-4">Voice Call Connected</p>
          {!remoteAudioEnabled && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <MicOff className="w-3.5 h-3.5" /> Owner Muted Microphone
            </span>
          )}
        </div>
      )}

      {/* Connection State Warning Badge */}
      {connectionState !== 'connected' && (
        <div className="absolute top-6 left-6 bg-amber-500/90 text-slate-950 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur">
          {connectionState === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
        </div>
      )}

      {/* Media Action Control Bar */}
      <div className="w-full p-6 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 flex items-center justify-center gap-4 z-20">
        <button
          onClick={toggleMic}
          className={`p-4 rounded-full border transition-all ${
            micEnabled
              ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              : 'bg-red-500/20 border-red-500 text-red-400'
          }`}
          title={micEnabled ? 'Mute Mic' : 'Unmute Mic'}
        >
          {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </button>

        <button
          onClick={toggleSpeaker}
          className={`px-4 py-3 rounded-full border flex items-center gap-2 text-sm font-semibold transition-all ${
            speakerOn
              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
              : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
          }`}
          title={speakerOn ? 'Switch to Earpiece' : 'Switch to Speaker'}
        >
          {speakerOn ? (
            <>
              <Volume2 className="w-5 h-5 text-emerald-400" />
              <span>🔊 Speaker</span>
            </>
          ) : (
            <>
              <Volume1 className="w-5 h-5 text-slate-300" />
              <span>📞 Earpiece</span>
            </>
          )}
        </button>

        {callType === 'video' && (
          <>
            <button
              onClick={toggleCamera}
              className={`p-4 rounded-full border transition-all ${
                cameraEnabled
                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  : 'bg-red-500/20 border-red-500 text-red-400'
              }`}
              title={cameraEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {cameraEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </button>

            <button
              onClick={handleSwitchCamera}
              className="p-4 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 rounded-full transition-all"
              title="Switch Camera"
            >
              <SwitchCamera className="w-6 h-6" />
            </button>
          </>
        )}

        <button
          onClick={handleEndCall}
          className="p-4 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg shadow-red-900/30 transition-all transform active:scale-95 ml-4"
          title="End Call"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
