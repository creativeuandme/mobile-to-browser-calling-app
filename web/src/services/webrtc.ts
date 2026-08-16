import { socketService } from './socket';

export interface WebRTCCallbacks {
  onRemoteStream?: (stream: MediaStream) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: 'connecting' | 'connected' | 'failed') => void;
  onRemoteMediaStateChange?: (state: { audioEnabled: boolean; videoEnabled: boolean }) => void;
  onDiagnosticLog?: (log: string) => void;
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callId: string | null = null;
  private currentFacingMode: 'user' | 'environment' = 'user';
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private callbacks: WebRTCCallbacks = {};
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  private log(msg: string) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const formatted = `[WebRTC Diag Web ${timestamp}] ${msg}`;
    console.log(formatted);
    if (this.callbacks.onDiagnosticLog) {
      this.callbacks.onDiagnosticLog(formatted);
    }
  }

  async initializeCall(
    callId: string,
    callType: 'voice' | 'video',
    iceServers: RTCIceServer[],
    callbacks: WebRTCCallbacks
  ): Promise<MediaStream> {
    this.callId = callId;
    this.callbacks = callbacks;
    this.log(`Initializing WebRTC Call ID: ${callId}, Type: ${callType}`);

    // 1. getUserMedia
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: callType === 'video' ? { facingMode: this.currentFacingMode } : false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTracks = this.localStream.getAudioTracks();
      const videoTracks = this.localStream.getVideoTracks();
      this.log(`getUserMedia SUCCESS: ${audioTracks.length} Audio track(s), ${videoTracks.length} Video track(s)`);

      audioTracks.forEach(t => this.log(`Local Audio Track ID: ${t.id}, Enabled: ${t.enabled}, Muted: ${t.muted}`));
      videoTracks.forEach(t => this.log(`Local Video Track ID: ${t.id}, Enabled: ${t.enabled}, Muted: ${t.muted}`));

      if (this.callbacks.onLocalStream) {
        this.callbacks.onLocalStream(this.localStream);
      }
    } catch (err: any) {
      this.log(`getUserMedia FAILED: ${err.message || err}`);
      throw err;
    }

    // 2. RTCPeerConnection Creation
    const defaultIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
    const finalIceServers = (iceServers && iceServers.length > 0) ? iceServers : defaultIceServers;

    this.log(`Creating RTCPeerConnection with ${finalIceServers.length} ICE server entry/entries`);
    this.peerConnection = new RTCPeerConnection({
      iceServers: finalIceServers,
      iceCandidatePoolSize: 10
    });

    // 3. Add Local Tracks to Senders
    this.localStream.getTracks().forEach((track) => {
      const sender = this.peerConnection?.addTrack(track, this.localStream!);
      this.log(`Added Local Track [${track.kind}] to RTCPeerConnection. Sender ID: ${sender?.track?.id}`);
    });

    const senders = this.peerConnection.getSenders();
    this.log(`Total RTCPeerConnection Senders: ${senders.length}`);

    // 4. Remote Track Event Listener
    this.remoteStream = new MediaStream();
    this.peerConnection.ontrack = (event) => {
      this.log(`ontrack EVENT FIRED! Track Kind: ${event.track.kind}, ID: ${event.track.id}, Enabled: ${event.track.enabled}`);
      event.streams[0].getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      if (this.callbacks.onRemoteStream && this.remoteStream) {
        this.callbacks.onRemoteStream(this.remoteStream);
      }
    };

    // 5. ICE Candidate Event Listener
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.log(`ICE Candidate GENERATED: candidate=${event.candidate.candidate.substring(0, 60)}...`);
        if (this.callId) {
          socketService.getSocket()?.emit('webrtc-ice-candidate', {
            callId: this.callId,
            candidate: event.candidate.toJSON()
          });
          this.log(`webrtc-ice-candidate SENT via Socket.IO`);
        }
      } else {
        this.log(`ICE Candidate Gathering COMPLETED (Null Candidate)`);
      }
    };

    // 6. State Monitoring
    const handleStateChange = () => {
      if (!this.peerConnection) return;
      const signalingState = this.peerConnection.signalingState;
      const iceGatheringState = this.peerConnection.iceGatheringState;
      const iceConnectionState = this.peerConnection.iceConnectionState;
      const connectionState = this.peerConnection.connectionState;

      this.log(`STATE CHANGE -> Signaling: ${signalingState} | ICEGathering: ${iceGatheringState} | ICEConn: ${iceConnectionState} | ConnState: ${connectionState}`);

      const isConnected =
        connectionState === 'connected' ||
        iceConnectionState === 'connected' ||
        iceConnectionState === 'completed';

      const isFailed = connectionState === 'failed' || iceConnectionState === 'failed';

      const activeState = isConnected ? 'connected' : isFailed ? 'failed' : 'connecting';

      if (this.callbacks.onConnectionStateChange) {
        this.callbacks.onConnectionStateChange(activeState);
      }

      if (isFailed) {
        this.attemptIceRestart();
      }
    };

    this.peerConnection.onsignalingstatechange = handleStateChange;
    this.peerConnection.onicegatheringstatechange = handleStateChange;
    this.peerConnection.oniceconnectionstatechange = handleStateChange;
    this.peerConnection.onconnectionstatechange = handleStateChange;

    this.setupSocketListeners();
    this.startStatsMonitoring();

    socketService.getSocket()?.emit('webrtc-ready', { callId: this.callId });
    this.log(`webrtc-ready SENT via Socket.IO`);

    return this.localStream;
  }

  private setupSocketListeners() {
    const socket = socketService.getSocket();
    if (!socket) return;

    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice-candidate');
    socket.off('media-state-change');

    // Received WebRTC Offer (Deterministic Answerer)
    socket.on('webrtc-offer', async (data: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`RECEIVE webrtc-offer via Socket.IO: SDP Type: ${data.sdp.type}`);
      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        this.log(`setRemoteDescription (Offer) SUCCESS. SignalingState: ${this.peerConnection.signalingState}`);

        await this.processPendingIceCandidates();

        const answer = await this.peerConnection.createAnswer();
        this.log(`createAnswer SUCCESS. SDP Type: ${answer.type}`);

        await this.peerConnection.setLocalDescription(answer);
        this.log(`setLocalDescription (Answer) SUCCESS. SignalingState: ${this.peerConnection.signalingState}`);

        socket.emit('webrtc-answer', { callId: this.callId, sdp: answer });
        this.log(`webrtc-answer SENT via Socket.IO`);
      } catch (err: any) {
        this.log(`ERROR processing offer/answer: ${err.message || err}`);
      }
    });

    // Received WebRTC Answer (Deterministic Offerer)
    socket.on('webrtc-answer', async (data: { callId: string; sdp: RTCSessionDescriptionInit }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`RECEIVE webrtc-answer via Socket.IO: SDP Type: ${data.sdp.type}`);
      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        this.log(`setRemoteDescription (Answer) SUCCESS. SignalingState: ${this.peerConnection.signalingState}`);

        await this.processPendingIceCandidates();
      } catch (err: any) {
        this.log(`ERROR processing answer: ${err.message || err}`);
      }
    });

    // Received Remote ICE Candidate
    socket.on('webrtc-ice-candidate', async (data: { callId: string; candidate: RTCIceCandidateInit }) => {
      if (data.callId !== this.callId || !this.peerConnection) return;
      this.log(`RECEIVE webrtc-ice-candidate via Socket.IO: candidate=${data.candidate.candidate?.substring(0, 40)}...`);

      if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          this.log(`addIceCandidate SUCCESS immediately.`);
        } catch (err: any) {
          this.log(`ERROR addIceCandidate: ${err.message || err}`);
        }
      } else {
        this.log(`Remote description not set yet. Queueing ICE Candidate (Queue length: ${this.pendingIceCandidates.length + 1})`);
        this.pendingIceCandidates.push(data.candidate);
      }
    });

    // Received Media State Change from Peer
    socket.on('media-state-change', (data: { callId: string; audioEnabled: boolean; videoEnabled: boolean }) => {
      if (data.callId !== this.callId) return;
      this.log(`RECEIVE media-state-change -> Peer Audio: ${data.audioEnabled}, Peer Video: ${data.videoEnabled}`);
      if (this.callbacks.onRemoteMediaStateChange) {
        this.callbacks.onRemoteMediaStateChange({
          audioEnabled: data.audioEnabled,
          videoEnabled: data.videoEnabled
        });
      }
    });
  }

  async createOffer(): Promise<void> {
    if (!this.peerConnection || !this.callId) return;
    this.log(`Initiating createOffer() as Offerer...`);
    try {
      const offer = await this.peerConnection.createOffer();
      this.log(`createOffer SUCCESS. SDP Type: ${offer.type}, Length: ${offer.sdp?.length}`);

      await this.peerConnection.setLocalDescription(offer);
      this.log(`setLocalDescription (Offer) SUCCESS. SignalingState: ${this.peerConnection.signalingState}`);

      socketService.getSocket()?.emit('webrtc-offer', { callId: this.callId, sdp: offer });
      this.log(`webrtc-offer SENT via Socket.IO`);
    } catch (err: any) {
      this.log(`ERROR createOffer: ${err.message || err}`);
    }
  }

  private async processPendingIceCandidates() {
    if (!this.peerConnection) return;
    this.log(`Flushing ${this.pendingIceCandidates.length} queued ICE candidate(s)...`);
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          this.log(`addIceCandidate (Queued) SUCCESS.`);
        } catch (err: any) {
          this.log(`ERROR addIceCandidate (Queued): ${err.message || err}`);
        }
      }
    }
  }

  private startStatsMonitoring() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection) return;
      try {
        const stats = await this.peerConnection.getStats();
        let bytesSent = 0;
        let bytesReceived = 0;
        let selectedPairState = 'none';

        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            bytesSent = report.bytesSent || 0;
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            bytesReceived = report.bytesReceived || 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            selectedPairState = report.state;
          }
        });

        this.log(`[RTP Audio Stats] Bytes Sent: ${bytesSent} | Bytes Received: ${bytesReceived} | Selected Pair: ${selectedPairState}`);
      } catch (err) {
        // Silently handle stats errors
      }
    }, 3000);
  }

  toggleMicrophone(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      this.log(`Toggled Local Microphone: ${enabled}`);
      this.emitMediaState();
    }
  }

  toggleCamera(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
      this.log(`Toggled Local Camera: ${enabled}`);
      this.emitMediaState();
    }
  }

  async switchCamera(): Promise<boolean> {
    if (!this.localStream || !this.peerConnection) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return false;

    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    this.log(`Switching Camera Facing Mode to: ${this.currentFacingMode}`);

    try {
      videoTrack.stop();
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode }
      });
      const newTrack = newStream.getVideoTracks()[0];

      const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        this.log(`replaceTrack (Video) SUCCESS`);
      }

      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newTrack);

      if (this.callbacks.onLocalStream) {
        this.callbacks.onLocalStream(this.localStream);
      }
      return true;
    } catch (err: any) {
      this.log(`Camera switching failed: ${err.message || err}`);
      return false;
    }
  }

  private emitMediaState() {
    if (!this.callId || !this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream.getVideoTracks()[0];

    socketService.getSocket()?.emit('media-state-change', {
      callId: this.callId,
      audioEnabled: audioTrack ? audioTrack.enabled : false,
      videoEnabled: videoTrack ? videoTrack.enabled : false
    });
  }

  private async attemptIceRestart() {
    if (!this.peerConnection || !this.callId) return;
    this.log(`Initiating ICE Restart...`);
    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      socketService.getSocket()?.emit('webrtc-offer', { callId: this.callId, sdp: offer });
    } catch (err: any) {
      this.log(`ICE restart error: ${err.message || err}`);
    }
  }

  cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.pendingIceCandidates = [];
    this.callId = null;
    this.log(`Cleaned up WebRTC PeerConnection and media streams.`);
  }
}
