// ═══════════════════════════════════════════════════════════
//  app.js  —  Main Application Controller
//  P2P Video/Audio Call — same logic as P2PShare
// ═══════════════════════════════════════════════════════════

// ── App State ─────────────────────────────────────────────

const app = {
  role:      null,   // 'caller' | 'callee'
  roomId:    null,
  callType:  'video', // 'video' | 'audio'
  connected: false,
  micMuted:  false,
  camOff:    false,
  spkMuted:  false,
};

// ── DOM Refs ──────────────────────────────────────────────

const btnCreate       = document.getElementById('btn-create');
const btnJoin         = document.getElementById('btn-join');
const btnCopyCode     = document.getElementById('btn-copy-code');
const btnCancelWait   = document.getElementById('btn-cancel-wait');
const btnToggleMic    = document.getElementById('btn-toggle-mic');
const btnToggleCam    = document.getElementById('btn-toggle-cam');
const btnEndCall      = document.getElementById('btn-end-call');
const btnToggleSpeaker= document.getElementById('btn-toggle-speaker');
const joinCodeInput   = document.getElementById('join-code');
const createPwdInput  = document.getElementById('create-password');
const joinPwdInput    = document.getElementById('join-password');
const displayRoomCode = document.getElementById('display-room-code');
const footerRoomCode  = document.getElementById('footer-room-code');
const videoLocal      = document.getElementById('video-local');
const videoRemote     = document.getElementById('video-remote');
const callOverlay     = document.getElementById('call-overlay');
const remoteAvatar    = document.getElementById('remote-avatar');
const localAvatar     = document.getElementById('local-avatar');

// ══════════════════════════════════════════════════════════
//  SCREEN 1 — Create Room
// ══════════════════════════════════════════════════════════

btnCreate.addEventListener('click', async () => {
  btnCreate.disabled = true;
  btnCreate.innerHTML = '<span class="spinner"></span> Creating…';

  // Read selected call type
  const typeRadio = document.querySelector('input[name="create-call-type"]:checked');
  app.callType = typeRadio ? typeRadio.value : 'video';

  try {
    // Get media FIRST — fail fast if permissions denied
    let stream;
    try {
      stream = await getLocalMedia(app.callType);
    } catch (err) {
      showToast('❌ Camera/mic permission denied', 'error');
      resetCreateBtn();
      return;
    }

    videoLocal.srcObject = stream;
    showLocalVideo(stream);

    const roomId  = generateRoomCode();
    const pwdHash = await hashPassword(createPwdInput.value.trim());

    await createRoomDoc(roomId, pwdHash, app.callType);

    app.role   = 'caller';
    app.roomId = roomId;

    displayRoomCode.textContent = roomId;
    showScreen('waiting');

    await startAsCaller(
      roomId,
      onCallConnected,
      onCallDisconnected,
      onRemoteStreamReceived,
    );

  } catch (err) {
    console.error('Create error:', err);
    showToast('Failed to create room: ' + err.message, 'error');
    resetCreateBtn();
  }
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

  btnJoin.disabled = true;
  btnJoin.innerHTML = '<span class="spinner"></span> Joining…';

  try {
    const room = await getRoomDoc(code);
    if (!room) {
      showToast('Room not found. Check the code.', 'error');
      resetJoinBtn();
      return;
    }

    if (room.passwordHash) {
      const hash = await hashPassword(joinPwdInput.value.trim());
      if (hash !== room.passwordHash) {
        showToast('Incorrect password', 'error');
        resetJoinBtn();
        return;
      }
    }

    // callType from room metadata (if stored), default video
    app.callType = room.callType || 'video';
    app.role     = 'callee';
    app.roomId   = code;

    // Get media
    let stream;
    try {
      stream = await getLocalMedia(app.callType);
    } catch (err) {
      showToast('❌ Camera/mic permission denied', 'error');
      resetJoinBtn();
      return;
    }

    videoLocal.srcObject = stream;
    showLocalVideo(stream);

    // Go to call screen immediately (callee sees their own video while connecting)
    footerRoomCode.textContent = code;
    showScreen('call');

    await startAsCallee(
      code,
      onCallConnected,
      onCallDisconnected,
      onRemoteStreamReceived,
    );

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

// ── Enter key on join code ────────────────────────────────
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
  closeCall();
  deleteRoomDoc(app.roomId).catch(() => {});
  app.roomId = null;
  app.role   = null;
  showScreen('home');
  setConnectionStatus('idle');
  resetCreateBtn();
});

// ══════════════════════════════════════════════════════════
//  WebRTC Callbacks
// ══════════════════════════════════════════════════════════

function onCallConnected() {
  app.connected = true;
  callOverlay.classList.add('hidden');

  if (app.role === 'caller') {
    footerRoomCode.textContent = app.roomId;
    showScreen('call');
  }

  // Clean up signaling after connect
  setTimeout(() => deleteRoomDoc(app.roomId).catch(() => {}), 3000);
  showToast('🔗 Connected!', 'success');
}

function onCallDisconnected() {
  app.connected = false;
  if (document.getElementById('screen-call').classList.contains('active')) {
    showToast('⚠️ Peer disconnected', 'warning');
    setConnectionStatus('failed');
    callOverlay.classList.remove('hidden');
    callOverlay.querySelector('p').textContent = 'Peer disconnected';
  }
}

function onRemoteStreamReceived(stream) {
  videoRemote.srcObject = stream;

  // Show/hide remote avatar based on video tracks
  const hasVid = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
  remoteAvatar.style.display = hasVid ? 'none' : 'flex';

  // Track ended event — update avatar
  stream.getVideoTracks().forEach(track => {
    track.onended = () => { remoteAvatar.style.display = 'flex'; };
    track.onmute  = () => { remoteAvatar.style.display = 'flex'; };
    track.onunmute= () => { remoteAvatar.style.display = 'none'; };
  });
}

// ══════════════════════════════════════════════════════════
//  Call Controls
// ══════════════════════════════════════════════════════════

// Mic toggle
btnToggleMic.addEventListener('click', () => {
  app.micMuted = !app.micMuted;
  setMicMuted(app.micMuted);
  btnToggleMic.classList.toggle('ctrl-active', !app.micMuted);
  btnToggleMic.classList.toggle('ctrl-off', app.micMuted);
  btnToggleMic.querySelector('span').textContent = app.micMuted ? 'Unmute' : 'Mic';

  // Update mic icon (slashed when muted)
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
  btnToggleCam.classList.toggle('ctrl-off', app.camOff);
  btnToggleCam.querySelector('span').textContent = app.camOff ? 'Camera Off' : 'Camera';

  // Show/hide local avatar
  localAvatar.style.display = app.camOff ? 'flex' : 'none';

  showToast(app.camOff ? '📷 Camera off' : '📷 Camera on', 'info', 2000);
});

// Speaker toggle (mutes remote video audio)
btnToggleSpeaker.addEventListener('click', () => {
  app.spkMuted = !app.spkMuted;
  videoRemote.muted = app.spkMuted;
  btnToggleSpeaker.classList.toggle('ctrl-active', !app.spkMuted);
  btnToggleSpeaker.classList.toggle('ctrl-off', app.spkMuted);
  btnToggleSpeaker.querySelector('span').textContent = app.spkMuted ? 'Spk Off' : 'Speaker';
  showToast(app.spkMuted ? '🔇 Speaker off' : '🔊 Speaker on', 'info', 2000);
});

// End call
btnEndCall.addEventListener('click', () => {
  endCall();
});

function endCall() {
  closeCall();
  app.connected = false;
  app.role      = null;
  app.roomId    = null;
  app.micMuted  = false;
  app.camOff    = false;
  app.spkMuted  = false;

  // Reset videos
  videoLocal.srcObject  = null;
  videoRemote.srcObject = null;

  // Reset controls state
  btnToggleMic.classList.add('ctrl-active');
  btnToggleMic.classList.remove('ctrl-off');
  btnToggleMic.querySelector('span').textContent = 'Mic';
  btnToggleCam.classList.add('ctrl-active');
  btnToggleCam.classList.remove('ctrl-off');
  btnToggleCam.querySelector('span').textContent = 'Camera';
  btnToggleSpeaker.classList.add('ctrl-active');
  btnToggleSpeaker.classList.remove('ctrl-off');
  btnToggleSpeaker.querySelector('span').textContent = 'Speaker';

  // Reset overlays
  callOverlay.classList.remove('hidden');
  callOverlay.querySelector('p').textContent = 'Connecting…';
  remoteAvatar.style.display = 'flex';
  localAvatar.style.display  = 'none';

  showScreen('home');
  setConnectionStatus('idle');
  resetCreateBtn();
  showToast('Call ended', 'info');
}

// ── Helpers ───────────────────────────────────────────────

function showLocalVideo(stream) {
  const hasVid = stream.getVideoTracks().length > 0;
  localAvatar.style.display = hasVid ? 'none' : 'flex';
  if (!hasVid) {
    // Audio-only: hide camera button active state
    btnToggleCam.classList.remove('ctrl-active');
    btnToggleCam.classList.add('ctrl-off');
  }
}
