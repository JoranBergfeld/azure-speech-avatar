import { createMachine, States, Events } from './state-machine.js';
import * as Speech from './speech.js';

const REFRESH_INTERVAL_MS = 9 * 60 * 1000; // refresh AAD token before ~1h expiry
const IDLE_TIMEOUT_MS = 60 * 1000;         // return to idle after a quiet minute

const els = {
  video: document.getElementById('avatar-video'),
  audio: document.getElementById('avatar-audio'),
  start: document.getElementById('start-btn'),
  mute: document.getElementById('mute-btn'),
  status: document.getElementById('status-chip'),
  caption: document.getElementById('caption'),
  error: document.getElementById('error-banner'),
};

const sessionId = crypto.randomUUID();
const machine = createMachine();

let recognizer = null;
let avatarSynthesizer = null;
let auth = null;            // { authToken, region, resourceId, rawToken }
let refreshTimer = null;
let idleTimer = null;

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}
function clearError() {
  els.error.hidden = true;
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => machine.dispatch(Events.IdleTimeout), IDLE_TIMEOUT_MS);
}

async function refreshTokens() {
  try {
    const t = await Speech.fetchSpeechToken();
    auth = { authToken: Speech.buildAuthToken(t.resourceId, t.token), region: t.region,
             resourceId: t.resourceId, rawToken: t.token };
    Speech.refreshAuthToken(auth.authToken, recognizer, avatarSynthesizer);
  } catch (e) {
    showError(`Could not refresh the Speech token: ${e.message}`);
  }
}

async function startRecognition() {
  if (!recognizer) return;
  await new Promise((resolve, reject) =>
    recognizer.startContinuousRecognitionAsync(resolve, reject));
}
async function stopRecognition() {
  if (!recognizer) return;
  await new Promise((resolve) => recognizer.stopContinuousRecognitionAsync(resolve, resolve));
}

// React to state changes: drive mic + status UI.
machine.subscribe(async (state) => {
  els.status.textContent = state.name;
  els.status.dataset.state = state.name;
  els.mute.textContent = state.muted ? 'Unmute' : 'Mute';

  if (state.name === States.Listening) {
    clearError();
    await startRecognition();
    armIdleTimer();
  } else {
    clearTimeout(idleTimer);
    await stopRecognition();
  }

  if (state.name === States.Idle) teardown();
});

async function askAgent(userText) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text: userText }),
  });
  if (!res.ok) throw new Error(`agent error ${res.status}`);
  const body = await res.json();
  return body.reply;
}

async function onFinalUserText(text) {
  els.caption.textContent = text;
  machine.dispatch(Events.Recognized); // -> Thinking (mic auto-pauses)
  try {
    const reply = await askAgent(text);
    machine.dispatch(Events.ReplyReady); // -> Speaking
    els.caption.textContent = reply;
    await Speech.speak(avatarSynthesizer, reply);
  } catch (e) {
    machine.dispatch(Events.ReplyFailed); // -> Error (explicit)
    showError(`Sorry — I hit a problem answering that: ${e.message}`);
    // Recover the conversation loop so the user can try again.
    machine.dispatch(Events.RetrySucceeded);
  }
}

async function connect() {
  machine.dispatch(Events.Start); // -> Connecting
  try {
    await refreshTokens();
    const iceServer = await Speech.fetchIceServer(auth.region, auth.rawToken);

    recognizer = Speech.createRecognizer(auth.authToken, auth.region, {
      onRecognizing: (t) => { els.caption.textContent = t; },
      onRecognized: (t) => onFinalUserText(t),
      onError: (m) => showError(m),
    });

    const created = await Speech.createAvatar(auth.authToken, auth.region, iceServer,
      els.video, els.audio, {
        onTurnStart: () => { /* avatar started speaking */ },
        onSwitchToIdle: () => machine.dispatch(Events.SynthesisComplete),
        onSessionEnd: () => { showError('The avatar session ended. Press Start to reconnect.'); machine.dispatch(Events.Stop); },
      });
    avatarSynthesizer = created.avatarSynthesizer;

    refreshTimer = setInterval(refreshTokens, REFRESH_INTERVAL_MS);

    // Greet, then begin listening.
    machine.dispatch(Events.Connected);
    await Speech.speak(avatarSynthesizer, 'Hello! Press the microphone question any time. How can I help?');
  } catch (e) {
    machine.dispatch(Events.ConnectFailed);
    showError(`Could not start the avatar: ${e.message}`);
  }
}

function teardown() {
  clearInterval(refreshTimer);
  clearTimeout(idleTimer);
  try { recognizer?.close(); } catch { /* ignore */ }
  try { avatarSynthesizer?.close(); } catch { /* ignore */ }
  recognizer = null;
  avatarSynthesizer = null;
}

els.start.addEventListener('click', () => {
  if (machine.state.name === States.Idle) connect();
});

els.mute.addEventListener('click', () => {
  machine.dispatch(machine.state.muted ? Events.MuteOff : Events.MuteOn);
});
