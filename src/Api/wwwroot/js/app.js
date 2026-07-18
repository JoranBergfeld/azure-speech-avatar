import { createMachine, States, Events } from './state-machine.js';
import * as Speech from './speech.js';

const REFRESH_INTERVAL_MS = 9 * 60 * 1000; // refresh AAD token before ~1h expiry
const IDLE_TIMEOUT_MS = 60 * 1000;         // return to idle after a quiet minute
const GREETING = 'Hello! Just start talking whenever you are ready — how can I help?';

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

// React to state changes: drive mic + status UI. The mic runs ONLY while actively
// listening AND not muted, so we never capture the avatar's own speech (half-duplex)
// and Mute genuinely stops the microphone.
machine.subscribe(async (state) => {
  const listening = state.name === States.Listening && !state.muted;
  const display = state.muted && state.name === States.Listening ? States.Muted : state.name;
  els.status.textContent = display;
  els.status.dataset.state = display;
  els.mute.textContent = state.muted ? 'Unmute' : 'Mute';

  try {
    if (listening) {
      await startRecognition();
      armIdleTimer();
    } else {
      clearTimeout(idleTimer);
      await stopRecognition();
    }
  } catch (e) {
    showError(`Microphone problem: ${e.message}`);
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
  clearError();                        // a new user turn clears any prior error banner
  els.caption.textContent = text;
  machine.dispatch(Events.Recognized); // Listening -> Thinking (mic auto-pauses)

  let reply;
  try {
    reply = await askAgent(text);
  } catch (e) {
    // Explicit-but-graceful: show the failure, then recover the loop so the user can retry.
    machine.dispatch(Events.ReplyFailed);    // Thinking -> Error (visible)
    showError(`Sorry — I hit a problem answering that: ${e.message}`);
    machine.dispatch(Events.RetrySucceeded); // Error -> Listening (or Muted); banner persists
    return;
  }

  machine.dispatch(Events.ReplyReady); // Thinking -> Speaking
  els.caption.textContent = reply;
  try {
    await Speech.speak(avatarSynthesizer, reply);
    // Completion is signalled by the avatar's idle event (onSwitchToIdle -> SynthesisComplete).
  } catch (e) {
    // Speaking failed: surface it and resume listening so the conversation continues.
    showError(`Sorry — I couldn't play that response: ${e.message}`);
    machine.dispatch(Events.SynthesisComplete); // Speaking -> Listening (or Muted)
  }
}

async function connect() {
  clearError();
  machine.dispatch(Events.Start); // Idle -> Connecting
  try {
    await refreshTokens();
    if (!auth) throw new Error('could not obtain a Speech token');
    const iceServer = await Speech.fetchIceServer(auth.region, auth.rawToken);

    recognizer = Speech.createRecognizer(auth.authToken, auth.region, {
      onRecognizing: (t) => { els.caption.textContent = t; },
      onRecognized: (t) => onFinalUserText(t),
      onError: (m) => showError(m),
    });

    const created = await Speech.createAvatar(auth.authToken, auth.region, iceServer,
      els.video, els.audio, {
        onTurnStart: () => { /* avatar started speaking */ },
        onSwitchToIdle: () => {
          // First idle = greeting finished -> start listening; later idles = a reply finished.
          if (machine.state.name === States.Connecting) machine.dispatch(Events.Connected);
          else machine.dispatch(Events.SynthesisComplete);
        },
        onSessionEnd: () => {
          showError('The avatar session ended. Press Start to reconnect.');
          machine.dispatch(Events.Stop); // -> Idle (teardown)
        },
      });
    avatarSynthesizer = created.avatarSynthesizer;

    refreshTimer = setInterval(refreshTokens, REFRESH_INTERVAL_MS);

    // Greet while still Connecting (mic OFF). onSwitchToIdle flips us to Listening when done,
    // so we never listen over the greeting (half-duplex).
    await Speech.speak(avatarSynthesizer, GREETING);
  } catch (e) {
    // Explicit-but-graceful: show the failure and return to Idle so Start can retry.
    machine.dispatch(Events.ConnectFailed); // Connecting -> Error (visible)
    showError(`Could not start the avatar: ${e.message}`);
    machine.dispatch(Events.GiveUp);        // Error -> Idle (runs teardown; Start works again)
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
