// ═══════════════════════════════════════════════════════════
//  webrtc.js  —  Multi-Peer Mesh WebRTC
//  Each participant maintains a direct P2P connection
//  to every other participant (mesh topology)
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

// ── State ─────────────────────────────────────────────────
let myId          = null;
let myStream      = null;
let currentRoomId = null;
let callType      = 'video';

// Map of peerId → { pc: RTCPeerConnection, stream: MediaStream }
const peers = {};

let signalUnsub   = null;
let participantUnsub = null;

// Callbacks
let onPeerJoined    = null; // (peerId, name) => void
let onPeerLeft      = (peerId) => {};      // (peerId) => void
let onPeerStream    = (peerId, stream) => {}; // (peerId, stream) => void
let onPeerConnected = (peerId) => {};
let onRoomDeleted   = () => {};

// ── Get User Media ────────────────────────────────────────
async function getLocalMedia(type) {
  callType = type;
  const constraints = type === 'video'
    ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true }
    : { video: false, audio: true };
  myStream = await navigator.mediaDevices.getUserMedia(constraints);
  return myStream;
}

// ── Create a PeerConnection to a specific peer ────────────
function createPeerConnection(peerId) {
  if (peers[peerId] && peers[peerId].pc) {
    peers[peerId].pc.close();
  }

  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = { pc, stream: null, name: '' };

  // Add local tracks
  if (myStream) {
    myStream.getTracks().forEach(track => pc.addTrack(track, myStream));
  }

  // Receive remote stream
  pc.ontrack = (event) => {
    peers[peerId].stream = event.streams[0];
    if (onPeerStream) onPeerStream(peerId, event.streams[0]);
  };

  // ICE candidates → send via Firestore signal
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      sendSignal(currentRoomId, myId, peerId, 'ice', candidate.toJSON());
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log(`[WebRTC] ${peerId} ICE:`, state);
    if (state === 'connected' || state === 'completed') {
      if (onPeerConnected) onPeerConnected(peerId);
    } else if (state === 'failed' || state === 'disconnected') {
      console.warn(`[WebRTC] Peer ${peerId} disconnected`);
      removePeer(peerId);
      if (onPeerLeft) onPeerLeft(peerId);
    }
  };

  return pc;
}

// ── Initiate offer to a peer (we are the caller) ──────────
async function callPeer(peerId) {
  const pc = createPeerConnection(peerId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await sendSignal(currentRoomId, myId, peerId, 'offer', {
    type: offer.type,
    sdp:  offer.sdp
  });
}

// ── Handle incoming signal ────────────────────────────────
async function handleSignal(signal) {
  const { from, type, payload } = signal;

  if (type === 'offer') {
    // Someone is calling us → create answer
    const pc = createPeerConnection(from);

    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await sendSignal(currentRoomId, myId, from, 'answer', {
      type: answer.type,
      sdp:  answer.sdp
    });

  } else if (type === 'answer') {
    const peer = peers[from];
    if (!peer) return;
    if (peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(payload));
    }

  } else if (type === 'ice') {
    const peer = peers[from];
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(payload));
    } catch(e) {
      console.warn('[ICE] add candidate error:', e);
    }
  }
}

// ── Start as host ─────────────────────────────────────────
async function startAsHost(roomId, id, callbacks) {
  currentRoomId = roomId;
  myId          = id;
  _setCallbacks(callbacks);

  // Listen for signals directed at me
  signalUnsub = onSignal(roomId, myId, handleSignal);

  // Watch participants — call new joiners
  participantUnsub = onParticipantsChange(roomId, (participants) => {
    if (!participants) { onRoomDeleted && onRoomDeleted(); return; }

    const peerIds = Object.keys(participants).filter(pid => pid !== myId);

    // New peers → call them
    peerIds.forEach(pid => {
      if (!peers[pid]) {
        peers[pid] = { pc: null, stream: null, name: participants[pid].name };
        if (onPeerJoined) onPeerJoined(pid, participants[pid].name);
        callPeer(pid);
      } else {
        // Update name
        peers[pid].name = participants[pid].name;
      }
    });

    // Detect departed peers
    Object.keys(peers).forEach(pid => {
      if (!participants[pid]) {
        removePeer(pid);
        if (onPeerLeft) onPeerLeft(pid);
      }
    });
  });
}

// ── Start as joiner ───────────────────────────────────────
async function startAsJoiner(roomId, id, existingParticipants, callbacks) {
  currentRoomId = roomId;
  myId          = id;
  _setCallbacks(callbacks);

  // Listen for signals directed at me
  signalUnsub = onSignal(roomId, myId, handleSignal);

  // Watch for new participants joining after me
  participantUnsub = onParticipantsChange(roomId, (participants) => {
    if (!participants) { onRoomDeleted && onRoomDeleted(); return; }

    // Detect departed peers
    Object.keys(peers).forEach(pid => {
      if (!participants[pid]) {
        removePeer(pid);
        if (onPeerLeft) onPeerLeft(pid);
      }
    });

    // New peers who joined AFTER me → call them
    Object.keys(participants).forEach(pid => {
      if (pid !== myId && !peers[pid]) {
        // Only call if they joined after us (by joinedAt)
        const theirTime = participants[pid].joinedAt || 0;
        const myTime    = participants[myId] ? participants[myId].joinedAt || 0 : 0;
        if (theirTime > myTime) {
          peers[pid] = { pc: null, stream: null, name: participants[pid].name };
          if (onPeerJoined) onPeerJoined(pid, participants[pid].name);
          callPeer(pid);
        }
      }
    });
  });

  // Call all existing participants (they are the callers normally,
  // but we initiate to be safe — dedup is handled by signalingState)
  Object.keys(existingParticipants).forEach(pid => {
    if (pid !== myId) {
      peers[pid] = { pc: null, stream: null, name: existingParticipants[pid].name };
      if (onPeerJoined) onPeerJoined(pid, existingParticipants[pid].name);
      // Existing peers will receive our join event via participant watch and call us
      // We do NOT initiate to avoid duplicate offer/answer
    }
  });
}

// ── Helpers ───────────────────────────────────────────────
function _setCallbacks(cb) {
  onPeerJoined    = cb.onPeerJoined    || null;
  onPeerLeft      = cb.onPeerLeft      || (() => {});
  onPeerStream    = cb.onPeerStream    || (() => {});
  onPeerConnected = cb.onPeerConnected || (() => {});
  onRoomDeleted   = cb.onRoomDeleted   || (() => {});
}

function removePeer(peerId) {
  const peer = peers[peerId];
  if (!peer) return;
  if (peer.pc) {
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.oniceconnectionstatechange = null;
    try { peer.pc.close(); } catch(e) {}
  }
  delete peers[peerId];
}

function getPeerName(peerId) {
  return peers[peerId] ? peers[peerId].name : 'Peer';
}

function getPeerCount() {
  return Object.keys(peers).length;
}

// ── Track Controls ────────────────────────────────────────
function setMicMuted(muted) {
  if (!myStream) return;
  myStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
}

function setCameraOff(off) {
  if (!myStream) return;
  myStream.getVideoTracks().forEach(t => { t.enabled = !off; });
}

function hasVideo() {
  return myStream && myStream.getVideoTracks().length > 0;
}

// ── Cleanup ───────────────────────────────────────────────
function closeAllConnections() {
  if (signalUnsub)      { try { signalUnsub(); } catch(e) {} signalUnsub = null; }
  if (participantUnsub) { try { participantUnsub(); } catch(e) {} participantUnsub = null; }

  Object.keys(peers).forEach(pid => removePeer(pid));

  if (myStream) {
    myStream.getTracks().forEach(t => t.stop());
    myStream = null;
  }

  currentRoomId = null;
  myId          = null;
}
