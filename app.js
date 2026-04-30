// ═══════════════════════════════════════════════════════════
//  app.js  —  Main Application Controller
//  Multi-user P2P Conference
// ═══════════════════════════════════════════════════════════

// ── App State ─────────────────────────────────────────────
const app = {
  role:      null,   // 'host' | 'joiner'
  roomId:    null,
  myPeerId:  null,
  myName:    'Me',
  callType:  'video',
  micMuted:  false,
  camOff:    false,
  spkMuted:  false,
};

// ── DOM Refs ──────────────────────────────────────────────
const btnCreate       = document.getElementById('btn-create');
const btnJoin         = document.getElementById('btn-join');
const btnCopyCode     = document.getElementById('btn-copy-code');
const btnCancelWait   = document.getElementById('btn-cancel-wait');
const btnStartCall    = document.getElementById('btn-start-call');
const btnToggleMic    = document.getElementById('btn-toggle-mic');
const btnToggleCam    = document.getElementById('btn-toggle-cam');
const btnEndCall      = document.getElementById('btn-end-call');
const btnToggleSpeaker= document.getElementById('btn-toggle-speaker');
const joinCodeInput   = document.getElementById('join-code');
const createPwdInput  = document.getElementById('create-password');
const joinPwdInput    = document.getElementById('join-password');
const createNameInput = document.getElementById('create-name');
const joinNameInput   = document.getElementById('join-name');
const displayRoomCode = document.getElementById('display-room-code');
const footerRoomCode  = document.getElementById('footer-room-code');
const videoLocal      = document.getElementById('video-local');
const waitHint        = document.getElementById('wait-hint');
const localAvatarEl   = document.getElementById('local-avatar');
const localAvatarText = document.getElementById('local-avatar-text');

// ══════════════════════════════════════════════════════════
//  SCREEN 1 — Create Room
// ══════════════════════════════════════════════════════════

btnCreate.addEventListener('click', async () => {
  const name = createNameInput.value.trim() || 'Host';
  app.myName  = name;

  btnCreate.disabled = true;
  btnCreate.innerHTML = '<span class="spinner"></span> Creating…';

  const typeRadio = document.querySelector('input[name="create-call-type"]:checked');
  app.callType = typeRadio ? typeRadio.value : 'video';

  try {
    // ✅ 1. Create room FIRST (no media yet)
    const roomId  = generateRoomCode();
    const pwdHash = await hashPassword(createPwdInput.value.trim());
    const peerId  = generatePeerId();

    await createRoomDoc(roomId, pwdHash, app.callType, peerId, name);

    app.role     = 'host';
    app.roomId   = roomId;
    app.myPeerId = peerId;

    displayRoomCode.textContent = roomId;
    showScreen('waiting');
    showToast('🏠 Room created! Share the code.', 'success');

    // ✅ 2. Get media (after room is visible)
    try {
      const stream = await getLocalMedia(app.callType);
      videoLocal.srcObject = stream;
      showLocalVideo(stream);
    } catch (err) {
      showToast('⚠️ Camera/mic denied — audio only fallback', 'warning');
      try {
        const stream = await getLocalMedia('audio');
        videoLocal.srcObject = stream;
        showLocalVideo(stream);
      } catch(e2) {
        showToast('❌ Mic access denied', 'error');
      }
    }

    // ✅ 3. Start WebRTC as host
    await startAsHost(roomId, peerId, {
      onPeerJoined:    handlePeerJoined,
      onPeerLeft:      handlePeerLeft,
      onPeerStream:    handlePeerStream,
      onPeerConnected: handlePeerConnected,
      onRoomDeleted:   handleRoomDeleted,
    });

    // Watch participant count for waiting screen
    watchParticipants(roomId, peerId);

  } catch (err) {
    console.error('Create error:', err);
    showToast('Failed to create room: ' + err.message, 'error');
    resetCreateBtn();
  }
});

// ── Watch participants on waiting screen ──────────────────
function watchParticipants(roomId, myPeerId) {
  onParticipantsChange(roomId, (participants) => {
    if (!participants) return;
    const otherCount = Object.keys(participants).filter(p => p !== myPeerId).length;
    if (otherCount === 0) {
      waitHint.textContent = 'No one connected yet';
      btnStartCall.classList.add('hidden');
    } else {
      waitHint.textContent = `${otherCount} peer${otherCount > 1 ? 's' : ''} connected — ready to call!`;
      btnStartCall.classList.remove('hidden');
    }
  });
}

// ── Start call from waiting screen ────────────────────────
btnStartCall.addEventListener('click', () => {
  footerRoomCode.textContent = app.roomId;
  showScreen('call');
  setConnectionStatus('connected');
  updatePeerCount(getPeerCount());
  showToast('📞 Call started!', 'success');
});

function resetCreateBtn() {
  btnCreate.disabled = false;
  btnCreate.innerHTML = '<span>Create Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ══════════════════════════════════════════════════════════
//  SCREEN 1 — Join Room
// ══════════════════════════════════════════════════════════

btnJoin.addEventListener('click', async () => {
  const code = joinCodeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showToast('Please enter a valid 6-digit room code', 'warning');
    joinCodeInput.focus();
    return;
  }

  const name = joinNameInput.value.trim() || 'Guest';
  app.myName = name;

  btnJoin.disabled = true;
  btnJoin.innerHTML = '<span class="spinner"></span> Joining…';

  try {
    // Check room exists
    const room = await getRoomDoc(code);
    if (!room) {
      showToast('Room not found. Check the code.', 'error');
      resetJoinBtn();
      return;
    }

    // Check participant limit
    const participantCount = Object.keys(room.participants || {}).length;
    if (participantCount >= MAX_PEERS) {
      showToast('Room is full (max 4 participants)', 'error');
      resetJoinBtn();
      return;
    }

    // Password check
    if (room.passwordHash) {
      const hash = await hashPassword(joinPwdInput.value.trim());
      if (hash !== room.passwordHash) {
        showToast('Incorrect password', 'error');
        resetJoinBtn();
        return;
      }
    }

    app.callType = room.callType || 'video';
    app.role     = 'joiner';
    app.roomId   = code;

    const peerId  = generatePeerId();
    app.myPeerId  = peerId;

    // ✅ 1. Register in room FIRST
    await joinRoomDoc(code, peerId, name);
    showToast('✅ Joined room!', 'success');

    // ✅ 2. Get media
    try {
      const stream = await getLocalMedia(room.callType || 'video');
      videoLocal.srcObject = stream;
      showLocalVideo(stream);
    } catch (err) {
      showToast('⚠️ Camera/mic denied — trying audio only', 'warning');
      try {
        const stream = await getLocalMedia('audio');
        videoLocal.srcObject = stream;
        showLocalVideo(stream);
      } catch(e2) {
        showToast('❌ Mic access denied', 'error');
      }
    }

    // ✅ 3. Go to call screen
    footerRoomCode.textContent = code;
    showScreen('call');
    setConnectionStatus('connecting');

    // ✅ 4. Start WebRTC as joiner
    await startAsJoiner(code, peerId, room.participants || {}, {
      onPeerJoined:    handlePeerJoined,
      onPeerLeft:      handlePeerLeft,
      onPeerStream:    handlePeerStream,
      onPeerConnected: handlePeerConnected,
      onRoomDeleted:   handleRoomDeleted,
    });

  } catch (err) {
    console.error('Join error:', err);
    showToast('Failed to join: ' + err.message, 'error');
    resetJoinBtn();
  }
});

function resetJoinBtn() {
  btnJoin.disabled = false;
  btnJoin.innerHTML = '<span>Join Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.replace(/\D/g, '').slice(0, 6);
});

// ══════════════════════════════════════════════════════════
//  SCREEN 2 — Waiting
// ══════════════════════════════════════════════════════════

btnCopyCode.addEventListener('click', async () => {
  if (!app.roomId) return;
  try {
    await navigator.clipboard.writeText(app.roomId);
    showToast('Code copied!', 'success', 2000);
  } catch {
    showToast('Code: ' + app.roomId, 'info', 5000);
  }
});

btnCancelWait.addEventListener('click', () => {
  closeAllConnections();
  if (app.role === 'host') {
    deleteRoomDoc(app.roomId).catch(() => {});
  } else {
    leaveRoomDoc(app.roomId, app.myPeerId).catch(() => {});
  }
  resetAppState();
  showScreen('home');
  setConnectionStatus('idle');
  resetCreateBtn();
  clearAllPeerTiles();
});

// ══════════════════════════════════════════════════════════
//  WebRTC Callbacks
// ══════════════════════════════════════════════════════════

function handlePeerJoined(peerId, name) {
  console.log('[App] Peer joined:', peerId, name);
  addPeerTile(peerId, name);
  updatePeerCount(Object.keys(peerTiles).length);
  showToast(`👤 ${name} joined`, 'info', 3000);
  setConnectionStatus('connecting');
}

function handlePeerConnected(peerId) {
  console.log('[App] Peer connected:', peerId);
  setConnectionStatus('connected');
  updatePeerCount(Object.keys(peerTiles).length);
  // If host is still on waiting screen, switch to call
  if (document.getElementById('screen-waiting').classList.contains('active')) {
    footerRoomCode.textContent = app.roomId;
    showScreen('call');
    showToast('🔗 Connected!', 'success');
  }
}

function handlePeerLeft(peerId) {
  const name = getPeerName(peerId) || 'Peer';
  console.log('[App] Peer left:', peerId);
  removePeerTile(peerId);
  updatePeerCount(Object.keys(peerTiles).length);
  showToast(`👋 ${name} left`, 'warning', 3000);
  if (getPeerCount() === 0) {
    setConnectionStatus('idle');
  }
}

function handlePeerStream(peerId, stream) {
  console.log('[App] Got stream from:', peerId);
  setPeerStream(peerId, stream);
}

function handleRoomDeleted() {
  showToast('🚫 Room was closed by host', 'warning');
  endCall();
}

// ══════════════════════════════════════════════════════════
//  Call Controls
// ══════════════════════════════════════════════════════════

// Mic toggle
btnToggleMic.addEventListener('click', () => {
  app.micMuted = !app.micMuted;
  setMicMuted(app.micMuted);
  btnToggleMic.classList.toggle('ctrl-active', !app.micMuted);
  btnToggleMic.classList.toggle('ctrl-off',    app.micMuted);
  btnToggleMic.querySelector('span').textContent = app.micMuted ? 'Unmute' : 'Mic';
  btnToggleMic.querySelector('svg').innerHTML = app.micMuted
    ? `<path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" fill="none" stroke="currentColor" stroke-width="2"/>
       <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8" fill="none" stroke="currentColor" stroke-width="2"/>`
    : `<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" fill="none" stroke="currentColor" stroke-width="2"/>
       <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" fill="none" stroke="currentColor" stroke-width="2"/>`;
  showToast(app.micMuted ? '🎤 Mic muted' : '🎤 Mic on', 'info', 2000);
});

// Camera toggle
btnToggleCam.addEventListener('click', () => {
  if (!hasVideo()) {
    showToast('Audio-only call — no camera', 'info', 2000);
    return;
  }
  app.camOff = !app.camOff;
  setCameraOff(app.camOff);
  btnToggleCam.classList.toggle('ctrl-active', !app.camOff);
  btnToggleCam.classList.toggle('ctrl-off',    app.camOff);
  btnToggleCam.querySelector('span').textContent = app.camOff ? 'Cam Off' : 'Camera';
  localAvatarEl.style.display = app.camOff ? 'flex' : 'none';
  showToast(app.camOff ? '📷 Camera off' : '📷 Camera on', 'info', 2000);
});

// Speaker toggle (mutes all remote peer videos)
btnToggleSpeaker.addEventListener('click', () => {
  app.spkMuted = !app.spkMuted;
  document.querySelectorAll('.peer-video').forEach(v => { v.muted = app.spkMuted; });
  btnToggleSpeaker.classList.toggle('ctrl-active', !app.spkMuted);
  btnToggleSpeaker.classList.toggle('ctrl-off',    app.spkMuted);
  btnToggleSpeaker.querySelector('span').textContent = app.spkMuted ? 'Spk Off' : 'Speaker';
  showToast(app.spkMuted ? '🔇 Speaker off' : '🔊 Speaker on', 'info', 2000);
});

// End call
btnEndCall.addEventListener('click', () => endCall());

function endCall() {
  closeAllConnections();
  if (app.role === 'host') {
    deleteRoomDoc(app.roomId).catch(() => {});
  } else {
    leaveRoomDoc(app.roomId, app.myPeerId).catch(() => {});
  }

  videoLocal.srcObject = null;

  // Reset controls
  btnToggleMic.classList.add('ctrl-active');    btnToggleMic.classList.remove('ctrl-off');
  btnToggleCam.classList.add('ctrl-active');    btnToggleCam.classList.remove('ctrl-off');
  btnToggleSpeaker.classList.add('ctrl-active'); btnToggleSpeaker.classList.remove('ctrl-off');
  btnToggleMic.querySelector('span').textContent = 'Mic';
  btnToggleCam.querySelector('span').textContent = 'Camera';
  btnToggleSpeaker.querySelector('span').textContent = 'Speaker';

  clearAllPeerTiles();
  resetAppState();
  showScreen('home');
  setConnectionStatus('idle');
  updatePeerCount(0);
  resetCreateBtn();
  showToast('Call ended', 'info');
}

function resetAppState() {
  app.role      = null;
  app.roomId    = null;
  app.myPeerId  = null;
  app.micMuted  = false;
  app.camOff    = false;
  app.spkMuted  = false;
  localAvatarEl.style.display = 'none';

  // Reset waiting screen
  waitHint.textContent = 'No one connected yet';
  btnStartCall.classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────
function showLocalVideo(stream) {
  const hasVid = stream.getVideoTracks().length > 0;

  // Set avatar initial
  const initial = (app.myName || 'M').charAt(0).toUpperCase();
  if (localAvatarText) localAvatarText.textContent = initial;

  localAvatarEl.style.display = hasVid ? 'none' : 'flex';

  if (!hasVid) {
    btnToggleCam.classList.remove('ctrl-active');
    btnToggleCam.classList.add('ctrl-off');
  }
}
