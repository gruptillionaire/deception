let audioContext: AudioContext | null = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

function playTone(params: { frequency: number; duration: number; gain: number; detune?: number }) {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const now = context.currentTime;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(params.frequency, now);
  oscillator.detune.setValueAtTime(params.detune ?? 0, now);

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(params.gain, now + 0.006);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + params.duration);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + params.duration + 0.02);
}

export function playUiHover() {
  playTone({ frequency: 520, duration: 0.055, gain: 0.035, detune: -20 });
}

export function playUiClick() {
  playTone({ frequency: 260, duration: 0.075, gain: 0.055, detune: 35 });
  window.setTimeout(() => {
    playTone({ frequency: 390, duration: 0.045, gain: 0.035, detune: -10 });
  }, 28);
}
