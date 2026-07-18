// Browser module. Assumes window.SpeechSDK is loaded (CDN script in index.html).
const SpeechSDK = globalThis.SpeechSDK;

const VOICE = 'en-US-AvaMultilingualNeural';
const AVATAR_CHARACTER = 'lisa';
const AVATAR_STYLE = 'casual-sitting';
const SEGMENTATION_SILENCE_MS = '1000';

/** Fetch the short-lived Entra token + region + resourceId from our backend. */
export async function fetchSpeechToken() {
  const res = await fetch('/api/speech/token');
  if (!res.ok) throw new Error(`speech token failed: ${res.status}`);
  return res.json(); // { token, region, resourceId }
}

/** The SDK wants the composite "aad#{resourceId}#{token}" authorization token. */
export function buildAuthToken(resourceId, token) {
  return `aad#${resourceId}#${token}`;
}

/** Ask the Speech relay for TURN/ICE servers (raw AAD token, NOT the aad# composite). */
export async function fetchIceServer(region, token) {
  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ICE relay failed: ${res.status}`);
  const data = await res.json(); // { Urls: [...], Username, Password }
  return { urls: data.Urls, username: data.Username, credential: data.Password };
}

/**
 * Continuous speech-to-text. Callbacks: onRecognizing(text), onRecognized(finalText),
 * onError(message). Returns the recognizer (call .startContinuousRecognitionAsync / stop...).
 */
export function createRecognizer(authToken, region, { onRecognizing, onRecognized, onError }) {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(authToken, region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, SEGMENTATION_SILENCE_MS);

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => onRecognizing?.(e.result.text);
  recognizer.recognized = (_s, e) => {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text?.trim()) {
      onRecognized?.(e.result.text.trim());
    }
  };
  recognizer.canceled = (_s, e) => onError?.(`stt canceled: ${e.errorDetails ?? e.reason}`);

  return recognizer;
}

/**
 * Create + start the avatar. Attaches video/audio to the given elements.
 * Event callbacks: onTurnStart(), onSwitchToIdle(), onSessionEnd().
 * Returns { avatarSynthesizer, peerConnection }.
 */
export async function createAvatar(authToken, region, iceServer, videoEl, audioEl, events) {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(authToken, region);
  speechConfig.speechSynthesisVoiceName = VOICE;

  const videoFormat = new SpeechSDK.AvatarVideoFormat();
  const avatarConfig = new SpeechSDK.AvatarConfig(AVATAR_CHARACTER, AVATAR_STYLE, videoFormat);

  const peerConnection = new RTCPeerConnection({ iceServers: [iceServer] });

  peerConnection.ontrack = (event) => {
    if (event.track.kind === 'video') videoEl.srcObject = event.streams[0];
    if (event.track.kind === 'audio') audioEl.srcObject = event.streams[0];
  };

  // The service opens a data channel to signal avatar lifecycle events.
  peerConnection.addEventListener('datachannel', (event) => {
    event.channel.onmessage = (msg) => {
      const text = typeof msg.data === 'string' ? msg.data : '';
      if (text.includes('EVENT_TYPE_TURN_START')) events.onTurnStart?.();
      else if (text.includes('EVENT_TYPE_SWITCH_TO_IDLE')) events.onSwitchToIdle?.();
      else if (text.includes('EVENT_TYPE_SESSION_END')) events.onSessionEnd?.();
    };
  });

  peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

  const avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
  await avatarSynthesizer.startAvatarAsync(peerConnection);

  return { avatarSynthesizer, peerConnection };
}

/** Speak plain text. Resolves when the synthesizer accepts it (idle event signals completion). */
export function speak(avatarSynthesizer, text) {
  return avatarSynthesizer.speakTextAsync(text);
}

/** Force-stop current speech (used on errors / Stop). */
export function stopSpeaking(avatarSynthesizer) {
  return avatarSynthesizer.stopSpeakingAsync();
}

/**
 * Refresh the AAD auth token on live instances. Setting it on speechConfig does NOT
 * propagate to already-created recognizers/synthesizers — set it on the instances.
 */
export function refreshAuthToken(newAuthToken, recognizer, avatarSynthesizer) {
  if (recognizer) recognizer.authorizationToken = newAuthToken;
  if (avatarSynthesizer) avatarSynthesizer.authorizationToken = newAuthToken;
}
