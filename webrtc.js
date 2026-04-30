// ═══════════════════════════════════════════════════════════
//  webrtc.js  —  WebRTC Peer Connection + Signaling
//  Video/Audio call edition — same Firebase signaling as P2PShare
// ═══════════════════════════════════════════════════════════

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

// ── State ────────────────────────────────────────────────

let peerConnection = null;
let localStream    = null;
let currentRoomId  = null;
let isCaller       = false;
let unsubscribeFns = [];

// Callbacks set by app.js
let onCallConnected    = null;
let onCallDisconnected = null;
let onRemoteStream     = null;

// ── Get User Media ────────────────────────────────────────

/**
 * Request camera + mic (or mic only for audio call)
 * @param {'video'|'audio'} callType
 * @returns {MediaStream}
 */
async function getLocalMedia(callType) {
  const constraints = callType === 'video'
    ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true }
    : { video: false, audio: true };

  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  return localStream;
}

// ── Create PeerConnection ─────────────────────────────────

function createPeerConnection() {
  if (peerConnection) peerConnection.close();

  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  // Add local tracks to connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Remote tracks → show in remote video element
  peerConnection.ontrack = (event) => {
    if (onRemoteStream) onRemoteStream(event.streams[0]);
  };

  // ICE state
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log('[WebRTC] ICE:', state);

    if (state === 'connected' || state === 'completed') {
      setConnectionStatus('connected');
      if (onCallConnected) onCallConnected();
    } else if (state === 'disconnected' || state === 'failed') {
      setConnectionStatus('failed');
      showToast('⚠️ Connection lost', 'warning');
      if (onCallDisconnected) onCallDisconnected();
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection:', peerConnection.connectionState);
  };

  return peerConnection;
}

// ── Caller (Creates Room) ─────────────────────────────────

async function startAsCaller(roomId, onConnected, onDisconnected, onRemote) {
  currentRoomId      = roomId;
  isCaller           = true;
  onCallConnected    = onConnected;
  onCallDisconnected = onDisconnected;
  onRemoteStream     = onRemote;

  const pc = createPeerConnection();
  setConnectionStatus('connecting');

  // Collect ICE candidates
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate) await addSenderCandidate(roomId, candidate.toJSON());
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setOffer(roomId, { type: offer.type, sdp: offer.sdp });

  // Listen for answer
  const unsubAnswer = onAnswer(roomId, async (answerSdp) => {
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
    }
  });

  // Listen for callee ICE candidates
  const unsubCandidates = onReceiverCandidates(roomId, async (c) => {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
    catch (e) { console.warn('ICE error:', e); }
  });

  unsubscribeFns.push(unsubAnswer, unsubCandidates);
}

// ── Callee (Joins Room) ───────────────────────────────────

async function startAsCallee(roomId, onConnected, onDisconnected, onRemote) {
  currentRoomId      = roomId;
  isCaller           = false;
  onCallConnected    = onConnected;
  onCallDisconnected = onDisconnected;
  onRemoteStream     = onRemote;

  const pc = createPeerConnection();
  setConnectionStatus('connecting');

  // Collect ICE candidates
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate) await addReceiverCandidate(roomId, candidate.toJSON());
  };

  // Listen for caller ICE candidates
  const unsubCandidates = onSenderCandidates(roomId, async (c) => {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
    catch (e) { console.warn('ICE error:', e); }
  });

  // Listen for offer → create answer
  const unsubOffer = onOffer(roomId, async (offerSdp) => {
    if (pc.signalingState !== 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await setAnswer(roomId, { type: answer.type, sdp: answer.sdp });
  });

  unsubscribeFns.push(unsubOffer, unsubCandidates);
}

// ── Track Controls ─────────────────────────────────────────

function setMicMuted(muted) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
}

function setCameraOff(off) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach(t => { t.enabled = !off; });
}

function hasVideo() {
  return localStream && localStream.getVideoTracks().length > 0;
}

// ── Cleanup ───────────────────────────────────────────────

function closeCall() {
  unsubscribeFns.forEach(fn => { try { fn(); } catch(e) {} });
  unsubscribeFns = [];

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (peerConnection) {
    peerConnection.ontrack                   = null;
    peerConnection.onicecandidate            = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onconnectionstatechange   = null;
    try { peerConnection.close(); } catch(e) {}
    peerConnection = null;
  }

  setConnectionStatus('idle');
  currentRoomId = null;
}
