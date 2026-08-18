import { mobileSocketService } from './socket';
import { Platform } from 'react-native';

let mediaDevices: any;
let RTCPeerConnectionClass: any;
let RTCSessionDescriptionClass: any;
let RTCIceCandidateClass: any;
let RTCViewComponent: any;

try {
  const webrtc = require('react-native-webrtc');
  mediaDevices = webrtc.mediaDevices;
  RTCPeerConnectionClass = webrtc.RTCPeerConnection;
  RTCSessionDescriptionClass = webrtc.RTCSessionDescription;
  RTCIceCandidateClass = webrtc.RTCIceCandidate;
  RTCViewComponent = webrtc.RTCView;
} catch (e) {
  console.warn('[Mobile WebRTC] Native react-native-webrtc unavailable, falling back to WebRTC API');
  if (typeof window !== 'undefined' && window.navigator) {
    mediaDevices = window.navigator.mediaDevices;
    RTCPeerConnectionClass = (window as any).RTCPeerConnection;
    RTCSessionDescriptionClass = (window as any).RTCSessionDescription;
    RTCIceCandidateClass = (window as any).RTCIceCandidate;
  }
}

export { RTCViewComponent };

export interface MobileWebRTCCallbacks {
  onRemoteStream?: (stream: any) => void;
  onLocalStream?: (stream: any) => void;
  onConnectionStateChange?: (state: string) => void;
  onRemoteMediaStateChange?: (state: { audioEnabled: boolean; videoEnabled: boolean }) => void;
  onDiagnosticLog?: (log: string) => void;
}

export class MobileWebRTCManager {
  private peerConnection: any = null;
  private localStream: any = null;
  private remoteStream: any = null;
  private callId: string | null = null;
  private isFrontCamera: boolean = true;
  private pendingIceCandidates: any[] = [];
  private callbacks: MobileWebRTCCallbacks = {};
  private statsInterval: any = null;

  private log(msg: string) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const formatted = `[WebRTC Diag Mobile ${timestamp}] ${msg}`;
    console.log(formatted);
    if (this.callbacks.onDiagnosticLog) {
      this.callbacks.onDiagnosticLog(formatted);
    }
  }

  async initializeCall(
    callId: string,
    callType: 'voice' | 'video',
    iceServers: any[],
    callbacks: MobileWebRTCCallbacks
  ): Promise<any> {
    this.callId = callId;
    this.callbacks = callbacks;
    this.log(`Initializing Mobile WebRTC Call ID: ${callId}, Type: ${callType}`);

    // Default audio output routing to EARPIECE (Normal Call Receiver)
    this.setSpeakerphone(false);

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: callType === 'video' ? { facingMode: this.isFrontCamera ? 'user' : 'environment' } : false
    };

    if (mediaDevices) {
      try {
        this.localStream = await mediaDevices.getUserMedia(constraints);
        this.log(`getUserMedia SUCCESS on Mobile. Local stream acquired.`);
        if (this.callbacks.onLocalStream) {
          this.callbacks.onLocalStream(this.localStream);
        }
      } catch (err: any) {
        this.log(`getUserMedia FAILED on Mobile: ${err.message || err}`);
        throw err;
      }
    }

    if (RTCPeerConnectionClass) {
      const defaultIceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ];
      const finalIceServers = (iceServers && iceServers.length > 0) ? iceServers : defaultIceServers;

      this.log(`Creating Mobile RTCPeerConnection with ${finalIceServers.length} ICE server entry/entries`);
      this.peerConnection = new RTCPeerConnectionClass({
        iceServers: finalIceServers,
        iceCandidatePoolSize: 10
      });

      if (this.localStream) {
        if (this.localStream.getTracks) {
          this.localStream.getTracks().forEach((track: any) => {
            this.peerConnection.addTrack(track, this.localStream);
            this.log(`Added Mobile Local Track [${track.kind}] to RTCPeerConnection`);
          });
        } else if (this.localStream.toURL) {
          this.peerConnection.addStream(this.localStream);
          this.log(`Added Native Mobile Local Stream via addStream`);
        }
      }

      let hasHandledRemoteStream = false;

      this.peerConnection.ontrack = (event: any) => {
        this.log(`ontrack EVENT FIRED on Mobile! Track Kind: ${event.track?.kind || 'unknown'}`);
        if (!hasHandledRemoteStream && event.streams && event.streams[0]) {
          hasHandledRemoteStream = true;
          this.remoteStream = event.streams[0];
          if (this.callbacks.onRemoteStream) {
            this.callbacks.onRemoteStream(this.remoteStream);
          }
        }
      };

      this.peerConnection.onaddstream = (event: any) => {
        this.log(`onaddstream EVENT FIRED on Mobile! Stream URL: ${event.stream?.toURL ? event.stream.toURL() : 'stream'}`);
        if (!hasHandledRemoteStream && event.stream) {
          hasHandledRemoteStream = true;
          this.remoteStream = event.stream;
          if (this.callbacks.onRemoteStream) {
            this.callbacks.onRemoteStream(this.remoteStream);
          }
        }
      };

      this.peerConnection.onicecandidate = (event: any) => {
        if (event.candidate) {
          this.log(`Mobile ICE Candidate GENERATED: ${event.candidate.candidate?.substring(0, 50)}...`);
          if (this.callId) {
            mobileSocketService.getSocket()?.emit('webrtc-ice-candidate', {
              callId: this.callId,
              candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
            });
          }
        }
      };

      const handleMobileStateChange = () => {
        const connState = this.peerConnection.connectionState;
        const iceState = this.peerConnection.iceConnectionState;
        const signalingState = this.peerConnection.signalingState;

        this.log(`Mobile STATE CHANGE -> Signaling: ${signalingState} | connState=${connState}, iceState=${iceState}`);

        const isConnected =
          connState === 'connected' ||
          connState === 'completed' ||
          iceState === 'connected' ||
          iceState === 'completed';

        const isFailed = connState === 'failed' || iceState === 'failed';

        const activeState = isConnected ? 'connected' : isFailed ? 'failed' : 'connecting';

        if (this.callbacks.onConnectionStateChange) {
          this.callbacks.onConnectionStateChange(activeState);
        }
      };

      this.peerConnection.onsignalingstatechange = handleMobileStateChange;
      this.peerConnection.oniceconnectionstatechange = handleMobileStateChange;
      this.peerConnection.onconnectionstatechange = handleMobileStateChange;
    }

    this.setupSocketListeners();
    this.startStatsMonitoring();

    mobileSocketService.getSocket()?.emit('webrtc-ready', { callId: this.callId });
    this.log(`webrtc-ready SENT from Mobile via Socket.IO`);

    return this.localStream;
  }

  private setupSocketListeners() {
    const socket = mobileSocketService.getSocket();
    if (!socket) return;

    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice-candidate');
    socket.off('media-state-change');

    // Received Offer on Mobile (Answerer Role)
    socket.on('webrtc-offer', async (data: { callId: string; sdp: any }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`Mobile RECEIVE webrtc-offer via Socket.IO: Type: ${data.sdp.type}`);
      try {
        const desc = new RTCSessionDescriptionClass(data.sdp);
        await this.peerConnection.setRemoteDescription(desc);
        this.log(`Mobile setRemoteDescription (Offer) SUCCESS`);

        await this.processPendingIceCandidates();

        const answer = await this.peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        this.log(`Mobile createAnswer SUCCESS`);

        await this.peerConnection.setLocalDescription(answer);
        this.log(`Mobile setLocalDescription (Answer) SUCCESS`);

        socket.emit('webrtc-answer', { callId: this.callId, sdp: answer });
        this.log(`Mobile webrtc-answer SENT via Socket.IO`);
      } catch (err: any) {
        this.log(`Mobile ERROR processing offer: ${err.message || err}`);
      }
    });

    // Received Answer on Mobile
    socket.on('webrtc-answer', async (data: { callId: string; sdp: any }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`Mobile RECEIVE webrtc-answer via Socket.IO: Type: ${data.sdp.type}`);
      try {
        const desc = new RTCSessionDescriptionClass(data.sdp);
        await this.peerConnection.setRemoteDescription(desc);
        this.log(`Mobile setRemoteDescription (Answer) SUCCESS`);

        await this.processPendingIceCandidates();
      } catch (err: any) {
        this.log(`Mobile ERROR processing answer: ${err.message || err}`);
      }
    });

    // Received ICE candidate on Mobile
    socket.on('webrtc-ice-candidate', async (data: { callId: string; candidate: any }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`Mobile RECEIVE webrtc-ice-candidate via Socket.IO`);

      if (this.peerConnection.remoteDescription) {
        try {
          const cand = new RTCIceCandidateClass(data.candidate);
          await this.peerConnection.addIceCandidate(cand);
          this.log(`Mobile addIceCandidate SUCCESS`);
        } catch (err: any) {
          this.log(`Mobile ERROR addIceCandidate: ${err.message || err}`);
        }
      } else {
        this.log(`Mobile Remote description not set yet. Queueing ICE candidate.`);
        this.pendingIceCandidates.push(data.candidate);
      }
    });

    // Received Media state change on Mobile
    socket.on('media-state-change', (data: { callId: string; audioEnabled: boolean; videoEnabled: boolean }) => {
      if (data.callId !== this.callId) return;
      this.log(`Mobile RECEIVE media-state-change -> Peer Audio: ${data.audioEnabled}, Peer Video: ${data.videoEnabled}`);
      if (this.callbacks.onRemoteMediaStateChange) {
        this.callbacks.onRemoteMediaStateChange({
          audioEnabled: data.audioEnabled,
          videoEnabled: data.videoEnabled
        });
      }
    });
  }

  private async processPendingIceCandidates() {
    if (!this.peerConnection) return;
    this.log(`Mobile Flushing ${this.pendingIceCandidates.length} queued ICE candidate(s)...`);
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      if (candidate) {
        try {
          const cand = new RTCIceCandidateClass(candidate);
          await this.peerConnection.addIceCandidate(cand);
          this.log(`Mobile addIceCandidate (Queued) SUCCESS`);
        } catch (err: any) {
          this.log(`Mobile ERROR addIceCandidate (Queued): ${err.message || err}`);
        }
      }
    }
  }

  private startStatsMonitoring() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection || !this.peerConnection.getStats) return;
      try {
        const stats = await this.peerConnection.getStats();
        let bytesSent = 0;
        let bytesReceived = 0;

        if (Array.isArray(stats)) {
          stats.forEach((report: any) => {
            if (report.type === 'outbound-rtp' && report.kind === 'audio') {
              bytesSent = report.bytesSent || 0;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              bytesReceived = report.bytesReceived || 0;
            }
          });
        }

        this.log(`[Mobile RTP Audio Stats] Bytes Sent: ${bytesSent} | Bytes Received: ${bytesReceived}`);
      } catch (err) {
        // Silently handle stats error
      }
    }, 3000);
  }

  toggleMicrophone(enabled: boolean) {
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks ? this.localStream.getAudioTracks() : [];
      audioTracks.forEach((track: any) => {
        track.enabled = enabled;
      });
      this.log(`Mobile Toggled Microphone: ${enabled}`);
      this.emitMediaState();
    }
  }

  toggleCamera(enabled: boolean) {
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks ? this.localStream.getVideoTracks() : [];
      videoTracks.forEach((track: any) => {
        track.enabled = enabled;
      });
      this.log(`Mobile Toggled Camera: ${enabled}`);
      this.emitMediaState();
    }
  }

  switchCamera() {
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks ? this.localStream.getVideoTracks() : [];
      videoTracks.forEach((track: any) => {
        if (track._switchCamera) {
          track._switchCamera();
        }
      });
      this.isFrontCamera = !this.isFrontCamera;
      this.log(`Mobile Switched Camera. IsFront: ${this.isFrontCamera}`);
    }
  }

  setSpeakerphone(speakerOn: boolean) {
    this.log(`Toggling Audio Output: ${speakerOn ? '🔊 Speaker (Loudspeaker)' : '📞 Earpiece (Receiver)'}`);
    try {
      const webrtc = require('react-native-webrtc');
      if (webrtc.InCallManager) {
        webrtc.InCallManager.setForceSpeakerphoneOn(speakerOn);
      }
    } catch (e) {
      console.warn('[Mobile WebRTC] InCallManager speakerphone toggle notice:', e);
    }
  }

  private emitMediaState() {
    if (!this.callId || !this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks ? this.localStream.getAudioTracks()[0] : null;
    const videoTrack = this.localStream.getVideoTracks ? this.localStream.getVideoTracks()[0] : null;

    mobileSocketService.getSocket()?.emit('media-state-change', {
      callId: this.callId,
      audioEnabled: audioTrack ? audioTrack.enabled : false,
      videoEnabled: videoTrack ? videoTrack.enabled : false
    });
  }

  cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.localStream) {
      if (this.localStream.getTracks) {
        this.localStream.getTracks().forEach((track: any) => track.stop());
      } else if (this.localStream.release) {
        this.localStream.release();
      }
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.callId = null;
    this.pendingIceCandidates = [];
    this.log(`Mobile WebRTC Cleaned up.`);
  }
}
