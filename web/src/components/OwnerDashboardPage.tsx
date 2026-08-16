import React, { useState, useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import { WebRTCManager } from '../services/webrtc';
import { fetchTurnCredentials, loginOwner, listTokens } from '../services/api';
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff, Shield, Copy, Check, UserCheck, RefreshCw } from 'lucide-react';

export const OwnerDashboardPage: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Incoming Call Modal State
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

  const [callStep, setCallStep] = useState<'idle' | 'incoming' | 'active' | 'ended'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // WebRTC Controls
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(true);

  // Media Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const webRtcManagerRef = useRef<WebRTCManager | null>(null);

  useEffect(() => {
    autoLoginOwner();

    return () => {
      if (webRtcManagerRef.current) {
        webRtcManagerRef.current.cleanup();
      }
      socketService.disconnect();
    };
  }, []);

  const autoLoginOwner = async () => {
    try {
      setLoading(true);
      const res = await loginOwner('owner@example.com', 'password123');
      setUser(res.user);
      setAuthToken(res.token);

      // Connect socket & authenticate
      const socket = socketService.connect();
      setupSocketListeners(socket);
      socket.emit('authenticate-owner', { token: res.token });

      // Fetch active tokens
      const tokenRes = await listTokens();
      setTokens(tokenRes.tokens || []);
    } catch (err: any) {
      console.error('Owner auto-login failed:', err);
      setStatusMessage('Auto-login failed: ' + (err.message || 'Error'));
    } finally {
      setLoading(false);
    }
  };

  const setupSocketListeners = (socket: any) => {
    socket.off('incoming-call');
    socket.off('call-cancelled');
    socket.off('call-missed');
    socket.off('call-ended');

    socket.on('incoming-call', (data: { callId: string; callType: 'voice' | 'video'; tokenLabel?: string }) => {
      console.log('[Owner Web] RECEIVED INCOMING CALL:', data);
      setIncomingCall(data);
      setCallStep('incoming');
    });

    socket.on('call-cancelled', () => {
      setIncomingCall(null);
      setCallStep('idle');
    });

    socket.on('call-missed', () => {
      setIncomingCall(null);
      setCallStep('idle');
    });

    socket.on('call-ended', () => {
      handleCallEndCleanup();
    });
  };

  const handleAcceptCall = async () => {
    if (!incomingCall) return;

    const activeCallData = { ...incomingCall };
    setIncomingCall(null);
    setActiveCall(activeCallData);
    setCallStep('active');
    setStatusMessage('Connecting secure WebRTC media...');

    // Emit call-accept over Socket.IO
    const socket = socketService.connect();
    socket.emit('call-accept', { callId: activeCallData.callId });

    // Setup WebRTC
    try {
      const iceServers = await fetchTurnCredentials();
      const manager = new WebRTCManager();
      webRtcManagerRef.current = manager;

      let hasHandledOwnerStream = false;

      await manager.initializeCall(activeCallData.callId, activeCallData.callType, iceServers, {
        onLocalStream: (stream) => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        },
        onRemoteStream: (stream) => {
          if (!hasHandledOwnerStream) {
            hasHandledOwnerStream = true;
            console.log('[Owner Web] Remote Stream Received:', stream.getAudioTracks().length, 'audio track(s)');
            stream.getAudioTracks().forEach((t) => (t.enabled = true));

            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = stream;
              remoteAudioRef.current.muted = false;
              remoteAudioRef.current.volume = 1.0;
              remoteAudioRef.current.play().catch((e) => console.warn('Owner audio play error:', e));
            }

            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              remoteVideoRef.current.play().catch((e) => console.warn('Owner video play error:', e));
            }
          }
        },
        onConnectionStateChange: (state) => {
          if (state === 'connected') {
            setStatusMessage('Connected (End-to-End Encrypted)');
          } else {
            setStatusMessage(`State: ${state}`);
          }
        }
      });
    } catch (err: any) {
      console.error('Owner WebRTC setup error:', err);
      setStatusMessage('WebRTC Connection Error: ' + err.message);
    }
  };

  const handleDeclineCall = () => {
    if (!incomingCall) return;
    const socket = socketService.connect();
    socket.emit('call-decline', { callId: incomingCall.callId });
    setIncomingCall(null);
    setCallStep('idle');
  };

  const handleEndCall = () => {
    if (activeCall) {
      const socket = socketService.connect();
      socket.emit('call-end', { callId: activeCall.callId });
    }
    handleCallEndCleanup();
  };

  const handleCallEndCleanup = () => {
    if (webRtcManagerRef.current) {
      webRtcManagerRef.current.cleanup();
      webRtcManagerRef.current = null;
    }
    setActiveCall(null);
    setIncomingCall(null);
    setCallStep('idle');
    setStatusMessage('');
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-4">
        <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <h2 className="text-xl font-semibold">Connecting Owner Dashboard 24/7...</h2>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4">
      {/* Audio Output Element for Voice & Video Calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Main Container */}
      <div className="w-full max-w-lg bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-5 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Owner Dashboard</h1>
              <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                24/7 Available (Online)
              </p>
            </div>
          </div>
          <button
            onClick={() => (window.location.href = '/')}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Guest Link →
          </button>
        </div>

        {/* Dashboard Content */}
        {callStep === 'idle' && (
          <div className="space-y-6">
            {/* Shareable Link Card */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Your Permanent 1-Tap Calling Link
              </label>
              <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-3">
                <span className="text-sm font-mono text-emerald-300 truncate pr-2">
                  {window.location.origin}
                </span>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Share this link with your girlfriend. When she visits it on her phone, your phone/dashboard rings instantly!
              </p>
            </div>

            {/* Status Card */}
            <div className="bg-emerald-950/30 border border-emerald-900/40 rounded-2xl p-5 text-center">
              <UserCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <h3 className="text-base font-semibold text-white">Ready for Incoming Calls</h3>
              <p className="text-xs text-slate-400 mt-1">
                You are logged in as <strong className="text-slate-200">owner@example.com</strong>. Keep this page open on your phone or laptop browser.
              </p>
            </div>
          </div>
        )}

        {/* Incoming Call Modal Overlay */}
        {callStep === 'incoming' && incomingCall && (
          <div className="bg-slate-950/90 border border-emerald-500/40 rounded-2xl p-6 text-center space-y-6 animate-fade-in">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto animate-bounce">
              {incomingCall.callType === 'video' ? (
                <Video className="w-10 h-10 text-emerald-400" />
              ) : (
                <Phone className="w-10 h-10 text-emerald-400" />
              )}
            </div>

            <div>
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">INCOMING CALL</p>
              <h2 className="text-2xl font-bold text-white">{incomingCall.tokenLabel || 'Private Caller'}</h2>
              <p className="text-sm text-slate-400 mt-1">
                {incomingCall.callType === 'video' ? 'Incoming Video Call' : 'Incoming Voice Call'}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                onClick={handleDeclineCall}
                className="flex-1 py-3.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/30"
              >
                <PhoneOff className="w-5 h-5" />
                Decline
              </button>
              <button
                onClick={handleAcceptCall}
                className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/30"
              >
                <Phone className="w-5 h-5" />
                Accept
              </button>
            </div>
          </div>
        )}

        {/* Active Call UI */}
        {callStep === 'active' && activeCall && (
          <div className="space-y-4">
            {/* Video Canvas Container */}
            {activeCall.callType === 'video' ? (
              <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-3 right-3 w-28 h-20 object-cover rounded-xl border border-slate-700 shadow-lg"
                />
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
                  <Phone className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-white">Voice Call Active</h3>
                <p className="text-xs text-emerald-400">{statusMessage || 'Connected (End-to-End Encrypted)'}</p>
              </div>
            )}

            {/* Call Action Controls */}
            <div className="flex items-center justify-center gap-4 pt-4">
              <button
                onClick={() => {
                  const next = !micEnabled;
                  setMicEnabled(next);
                  webRtcManagerRef.current?.toggleMicrophone(next);
                }}
                className={`p-4 rounded-full border transition-all ${
                  micEnabled
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-red-600/20 border-red-500 text-red-400'
                }`}
              >
                {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
              </button>

              {activeCall.callType === 'video' && (
                <button
                  onClick={() => {
                    const next = !cameraEnabled;
                    setCameraEnabled(next);
                    webRtcManagerRef.current?.toggleCamera(next);
                  }}
                  className={`p-4 rounded-full border transition-all ${
                    cameraEnabled
                      ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      : 'bg-red-600/20 border-red-500 text-red-400'
                  }`}
                >
                  {cameraEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
              )}

              <button
                onClick={handleEndCall}
                className="p-4 rounded-full bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-900/40"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
