/**
 * Phase Now continuous-call policy.
 * Open once, keep the segment loop, hang up on END while listening.
 * While TTS plays, tap or speech barges in: cancel playback and listen again.
 * True WebRTC duplex is intentionally not used.
 */

export const VOICE_DUPLEX = "barge-cancel";

export const VOICE_DUPLEX_NOTE =
  "True WebRTC full duplex is not used: there is no media server, and a second RTCPeerConnection audio session fights the iPad AudioContext unlock. While TTS plays, a tap or sustained microphone energy cancels HTMLAudio and AudioContext playback and the call loop returns to listen.";

export const WAKE_WORD_PHASE = "later";

/**
 * Desktop always-on is armed only when VOICE_ALWAYS_ON is on and the caller
 * passes desktop:true. The server passes desktop:false (it cannot see the UA).
 * iPad always-on stays out of scope. Wake phrases live in atlasWake.js.
 */
export function wakeWordStatus(alwaysOn, { desktop = false } = {}) {
  const env = Boolean(alwaysOn);
  const armed = env && Boolean(desktop);
  return {
    env,
    armed,
    phase: armed ? "desktop-always-on" : WAKE_WORD_PHASE,
    wakeWord: "Atlas",
    note: armed
      ? "Desktop always-on armed: mic stays open; wake word opens Phase Now call."
      : "Always-on/wake-word not armed (needs VOICE_ALWAYS_ON + desktop host).",
  };
}

export function shouldYieldToCall({ yieldToCall = false, callOpen = false } = {}) {
  return Boolean(yieldToCall && callOpen);
}

/**
 * @param {{ open?: boolean, phase?: string }} state
 * @param {"tap"|"wake"|"speech"|"segment-silence"|"segment-heard"|"tts-start"|"tts-end"|"hangup"|"mic-dead"} event
 */
export function reduceCall(state, event) {
  const open = Boolean(state?.open);
  const phase = state?.phase || (open ? "listen" : "idle");
  const listening = {
    action: "listen",
    open: true,
    phase: "listen",
    label: "END",
    cancelAudio: false,
    duplex: VOICE_DUPLEX,
  };
  if (event === "hangup" || event === "mic-dead") {
    return {
      action: event,
      open: false,
      phase: "idle",
      label: "MIC",
      cancelAudio: true,
      duplex: VOICE_DUPLEX,
    };
  }
  if (!open) {
    // "wake" is the always-on handoff: same open as a MIC tap, no second stack.
    if (event === "tap" || event === "wake") {
      return {
        action: "open",
        open: true,
        phase: "listen",
        label: "END",
        cancelAudio: false,
        duplex: VOICE_DUPLEX,
      };
    }
    return {
      action: "ignore",
      open: false,
      phase: "idle",
      label: "MIC",
      cancelAudio: false,
      duplex: VOICE_DUPLEX,
    };
  }
  if (event === "tap") {
    if (phase === "tts") {
      return { ...listening, action: "barge", cancelAudio: true };
    }
    return {
      action: "hangup",
      open: false,
      phase: "idle",
      label: "MIC",
      cancelAudio: true,
      duplex: VOICE_DUPLEX,
    };
  }
  if (event === "wake") return { ...listening, action: "keep", phase };
  if (event === "speech") {
    if (phase === "tts") return { ...listening, action: "barge", cancelAudio: true };
    return { ...listening, action: "keep", phase };
  }
  if (event === "segment-silence") return listening;
  if (event === "segment-heard") return { ...listening, action: "reply", phase: "reply" };
  if (event === "tts-start") return { ...listening, action: "tts", phase: "tts" };
  if (event === "tts-end") return listening;
  return { ...listening, action: "keep", phase, label: "END" };
}
