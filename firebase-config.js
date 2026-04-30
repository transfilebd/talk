// ═══════════════════════════════════════════════════════════
//  firebase-config.js  —  Firebase + Signaling Helpers
//  Multi-user conference edition
// ═══════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyBbF3Wbp6eyQFamgw94P9UNsBltVMCIbF8",
  authDomain: "transfile-5573c.firebaseapp.com",
  projectId: "transfile-5573c",
  storageBucket: "transfile-5573c.firebasestorage.app",
  messagingSenderId: "837002908892",
  appId: "1:837002908892:web:51c3730bc133d5a09b5019"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const ROOMS_COLLECTION  = "conf_rooms";
const MAX_PEERS         = 4; // max participants including host

// ──────────────────────────────────────────────────────────
//  Room Document Structure:
//  conf_rooms/{roomId}
//    createdAt, passwordHash, callType, hostId
//    participants: { [peerId]: { name, joinedAt } }
//
//  Signaling subcollection:
//  conf_rooms/{roomId}/signals/{docId}
//    from, to, type ('offer'|'answer'|'ice'), payload, ts
// ──────────────────────────────────────────────────────────

/** Generate a random 6-digit room code */
function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Generate a random peer ID */
function generatePeerId() {
  return Math.random().toString(36).slice(2, 10);
}

/** SHA-256 hash for room password */
async function hashPassword(pwd) {
  if (!pwd) return '';
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(pwd));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Create room document */
async function createRoomDoc(roomId, pwdHash, callType, hostId, hostName) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).set({
    createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
    passwordHash: pwdHash,
    callType:     callType || 'video',
    hostId:       hostId,
    participants: {
      [hostId]: { name: hostName || 'Host', joinedAt: Date.now() }
    }
  });
}

/** Get room document */
async function getRoomDoc(roomId) {
  const snap = await db.collection(ROOMS_COLLECTION).doc(roomId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/** Add participant to room */
async function joinRoomDoc(roomId, peerId, peerName) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).update({
    [`participants.${peerId}`]: { name: peerName || 'Peer', joinedAt: Date.now() }
  });
}

/** Remove participant from room */
async function leaveRoomDoc(roomId, peerId) {
  try {
    await db.collection(ROOMS_COLLECTION).doc(roomId).update({
      [`participants.${peerId}`]: firebase.firestore.FieldValue.delete()
    });
  } catch(e) {}
}

/** Delete entire room (host only) */
async function deleteRoomDoc(roomId) {
  try {
    // delete all signals first
    const signals = await db.collection(ROOMS_COLLECTION).doc(roomId)
      .collection('signals').get();
    const batch = db.batch();
    signals.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await db.collection(ROOMS_COLLECTION).doc(roomId).delete();
  } catch(e) {}
}

/** Listen for participant changes */
function onParticipantsChange(roomId, callback) {
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .onSnapshot(snap => {
      if (!snap.exists) { callback(null); return; }
      callback(snap.data().participants || {});
    });
}

// ──────────────────────────────────────────────────────────
//  Signaling — per-pair messages via subcollection
// ──────────────────────────────────────────────────────────

/** Send a signal to a specific peer */
async function sendSignal(roomId, fromId, toId, type, payload) {
  await db.collection(ROOMS_COLLECTION).doc(roomId)
    .collection('signals').add({
      from: fromId, to: toId,
      type, payload,
      ts: firebase.firestore.FieldValue.serverTimestamp()
    });
}

/** Listen for signals directed at myId */
function onSignal(roomId, myId, callback) {
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .collection('signals')
    .where('to', '==', myId)
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          callback(data);
          // clean up processed signal
          change.doc.ref.delete().catch(() => {});
        }
      });
    });
}
