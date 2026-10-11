import { AudioInput, describeCaptureError } from './audio.js';
import { FeatureTracker, SoundSeed, SoundGate, SILENCE, clamp, evolutionInterval } from './features.js';
import { SceneBuilder, AnimatedArtwork, DEFAULT_SETTINGS } from './scenes.js';
import { VideoRecorder, MAX_TAKE_SECONDS } from './recording.js';

const $ = id => document.getElementById(id);
const art = $('art'), waveform = $('waveform'), player = $('filePlayer');
const waveContext = waveform.getContext('2d');
const recordingCanvas = document.createElement('canvas');
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
const artwork = new AnimatedArtwork(art), builder = new SceneBuilder();
const tracker = new FeatureTracker(), soundSeed = new SoundSeed();
const soundGate = new SoundGate();
let features = SILENCE, pending = false, fileURL = null, fileLabel = '', sourceLabel = '';
let requestedSeed = DEFAULT_SETTINGS.seed, generation = 0, building = false;
let clock = 0, lastSceneTime = 0, previousFrame = 0, uiTime = 0, onsetUntil = 0;
let frames = 0, fpsStart = performance.now(), fps = 0, recordingWithWaveform = false;
let startRecordPending = false;
let firstSoundSeed = false;
const waveHistory = [];
const names = { tab: 'Browser tab audio', microphone: 'Microphone', demo: 'Demo · 108 BPM' };

function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
  $('message').hidden = !text;
}
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function fileStamp() { return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-'); }

const recorder = new VideoRecorder({
  onChange: () => { syncControls(); updateTake(); },
  onError: error => message(error.message, true)
});
const audio = new AudioInput({ onEnded: () => disconnect(true) });

function syncControls() {
  const locked = pending || recorder.busy || startRecordPending;
  $('connectTab').disabled = locked || !navigator.mediaDevices?.getDisplayMedia;
  $('connectMic').disabled = locked || !navigator.mediaDevices?.getUserMedia;
  $('chooseFile').disabled = locked;
  $('fileInput').disabled = locked;
  $('playDemo').disabled = locked;
  $('stopAudio').disabled = !audio.kind || pending || startRecordPending;
  $('orientation').disabled = recorder.busy || startRecordPending;
  $('includeWaveform').disabled = recorder.busy || startRecordPending;
  $('record').disabled = !audio.kind || !recorder.mimeType || !artwork.current || locked || building;
  $('record').hidden = recorder.busy;
  $('stopRecording').hidden = !recorder.busy;
  $('stopRecording').disabled = Boolean(recorder.stopping);
  $('previewRecording').disabled = recorder.busy || pending;
  document.querySelector('.recording-section').classList.toggle('is-recording', recorder.busy);
  $('recordingFormat').textContent = recorder.mimeType ? (recorder.mimeType.includes('mp4') ? 'MP4 / 30 FPS' : 'WEBM / 30 FPS') : 'UNAVAILABLE';
  $('recordHint').textContent = recorder.stopping ? 'Finishing your video…'
    : recorder.active ? 'Recording artwork + sound. Keep this tab visible. Stops at 03:00.'
      : !recorder.mimeType ? 'Video recording is unavailable here. You can still save a PNG.'
        : audio.kind ? 'Records artwork + sound. Up to 3 minutes per take.' : 'Connect sound to record. Up to 3 minutes per take.';
  $('sourceName').textContent = pending ? 'Connecting…' : audio.kind ? sourceLabel || names[audio.kind] || 'Audio file' : 'No audio connected';
  $('sourceDot').classList.toggle('active', Boolean(audio.kind));
  $('playDemo').textContent = audio.kind === 'demo' ? 'Demo connected' : 'Try demo sound';
  player.hidden = !fileURL || (audio.kind !== 'file' && audio.kind !== null);
  player.inert = pending || recorder.busy;
}

function resetSound() {
  tracker.reset(); soundSeed.reset(); soundGate.reset(); features = SILENCE;
  waveHistory.length = 0;
  firstSoundSeed = true; lastSceneTime = clock;
}

async function connect(action, label) {
  if (pending || recorder.busy || startRecordPending) return;
  pending = true; message(''); syncControls();
  try {
    // action() is invoked synchronously so tab capture retains user activation.
    await action();
    sourceLabel = label;
    resetSound();
    message(audio.kind === 'tab' ? 'Connected. Return to your sound tab to control playback.' : 'Connected. Play some sound and watch the marks respond.');
  } catch (error) { message(describeCaptureError(error), true); }
  finally { pending = false; syncControls(); }
}

async function disconnect(ended = false) {
  if (pending) return;
  if (recorder.busy) await recorder.stop();
  audio.stop(); tracker.reset(); soundGate.reset(); features = SILENCE;
  message(ended ? 'The audio source ended. Your last drawing is held on the paper.' : 'Audio disconnected. Your last drawing is held on the paper.');
  syncControls();
}

$('connectTab').addEventListener('click', () => connect(() => audio.tab(), names.tab));
$('connectMic').addEventListener('click', () => connect(() => audio.microphone(), names.microphone));
$('playDemo').addEventListener('click', () => connect(() => audio.demo(), names.demo));
$('stopAudio').addEventListener('click', () => disconnect());
$('chooseFile').addEventListener('click', () => { if (!recorder.busy && !pending) $('fileInput').click(); });
$('fileInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || recorder.busy || pending) return;
  connect(async () => {
    await audio.ready(); audio.stop();
    if (fileURL) URL.revokeObjectURL(fileURL);
    fileURL = URL.createObjectURL(file);
    fileLabel = file.name;
    player.src = fileURL; player.hidden = false;
    try { await audio.file(player); await player.play(); }
    catch (error) { audio.stop(); throw error; }
  }, file.name);
});
player.addEventListener('play', () => {
  if (audio.kind === 'file' || pending) { syncControls(); return; }
  if (recorder.busy) { player.pause(); message('Stop the recording before changing audio sources.', true); return; }
  connect(() => audio.file(player), fileLabel || 'Audio file');
});
player.addEventListener('pause', () => { soundGate.reset(); syncControls(); });
player.addEventListener('ended', () => { if (audio.kind === 'file') disconnect(true); });
player.addEventListener('error', () => {
  if (fileURL && !pending) message('This browser could not play that file. Try MP3, WAV or another supported audio format.', true);
});

function settings(seed) {
  return { ...DEFAULT_SETTINGS, seed, mode: $('engine').value, orientation: $('orientation').value, palette: $('palette').value };
}
async function generate(seed, immediate = false, startNow = false) {
  const request = ++generation;
  requestedSeed = seed; building = true;
  syncControls();
  try {
    const scene = await builder.build(settings(seed));
    if (request !== generation) return;
    if (!scene.paths.length) throw new Error('The composition did not produce any marks. Select another engine.');
    artwork.setScene(scene, immediate, startNow);
    $('stage').classList.toggle('portrait', scene.height > scene.width);
    $('dimensions').textContent = scene.width + ' × ' + scene.height;
    $('seed').textContent = artwork.drawnSeed;
    $('sceneCount').textContent = String(artwork.sceneCount).padStart(2, '0');
    syncControls();
  } catch (error) {
    if (request === generation) { requestedSeed = artwork.current?.seed || DEFAULT_SETTINGS.seed; message('Composition error: ' + error.message, true); }
  } finally { if (request === generation) { building = false; syncControls(); } }
}
for (const id of ['engine', 'orientation', 'palette']) {
  $(id).addEventListener('change', () => {
    if (id === 'orientation' && recorder.busy) return;
    generate(artwork.current?.seed || DEFAULT_SETTINGS.seed, !audio.kind || (audio.kind === 'file' && player.paused));
    lastSceneTime = clock;
  });
}
for (const id of ['sensitivity', 'motion', 'evolution', 'smoothing']) {
  const update = () => $(id + 'Value').textContent = id === 'evolution'
    ? '~' + evolutionInterval(+$(id).value).toFixed(1) + 's' : $(id).value + '%';
  $(id).addEventListener('input', update); update();
}
$('gentle').checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawWaveform(data) {
  const width = waveform.width, height = waveform.height;
  let low = 0, high = 0;
  if (data) for (const value of data) { low = Math.min(low, value); high = Math.max(high, value); }
  waveHistory.push([low, high]);
  if (waveHistory.length > 120) waveHistory.shift();
  waveContext.fillStyle = '#222620'; waveContext.fillRect(0, 0, width, height);
  waveContext.strokeStyle = '#454b3e'; waveContext.lineWidth = 1;
  waveContext.setLineDash([2, 6]);
  waveContext.beginPath(); waveContext.moveTo(0, height / 2); waveContext.lineTo(width, height / 2); waveContext.stroke();
  waveContext.setLineDash([]);
  // A rolling min/max waveform keeps short sounds visible between their peaks.
  // Each column is measured from real incoming samples, not a decorative trace.
  const step = width / 120;
  waveContext.strokeStyle = '#d7ed99'; waveContext.lineWidth = step * 0.72;
  waveContext.beginPath();
  for (let i = 0; i < waveHistory.length; i++) {
    const [min, max] = waveHistory[i];
    const x = (120 - waveHistory.length + i + 0.5) * step;
    waveContext.moveTo(x, height / 2 - clamp(max * 2.5, 0, 1) * height * 0.44);
    waveContext.lineTo(x, height / 2 - clamp(min * 2.5, -1, 0) * height * 0.44);
  }
  waveContext.stroke();
}

function paintRecording() {
  if (!recordingCanvas.width || !recordingCanvas.height) return;
  const width = recordingCanvas.width;
  recordingContext.globalAlpha = 1;
  recordingContext.drawImage(art, 0, 0, width, art.height);
  if (recordingWithWaveform) {
    recordingContext.fillStyle = '#222620'; recordingContext.fillRect(0, art.height, width, 156);
    recordingContext.fillStyle = '#d7ed99'; recordingContext.font = '14px monospace';
    recordingContext.fillText('ALGO / ANIMATE  ·  INCOMING SOUND', 24, art.height + 27);
    recordingContext.drawImage(waveform, 24, art.height + 38, width - 48, 98);
  }
}

$('record').addEventListener('click', async () => {
  if (!audio.kind || recorder.busy || pending || !artwork.current || startRecordPending || building) return;
  startRecordPending = true; syncControls();
  try {
    await audio.ready();
    recordingWithWaveform = $('includeWaveform').checked;
    recordingCanvas.width = art.width;
    recordingCanvas.height = art.height + (recordingWithWaveform ? 156 : 0);
    paintRecording();
    recorder.start(recordingCanvas, audio.destination.stream);
    message('Recording started. The download will contain this artwork and the incoming sound.');
  } catch (error) { message(error.message, true); }
  finally { startRecordPending = false; syncControls(); }
});
$('stopRecording').addEventListener('click', async () => {
  await recorder.stop();
  if (recorder.result) message('Take saved in this browser. Download it to keep a copy.');
});
function updateTake() {
  if (!recorder.result) return;
  const take = recorder.result;
  $('take').hidden = false;
  $('takeDetails').textContent = `${formatTime(take.seconds)} / ${(take.blob.size / 1048576).toFixed(1)} MB / ${take.extension.toUpperCase()}`;
  $('download').href = take.url;
  $('download').download = `algoanimate-${$('engine').value}-${fileStamp()}.${take.extension}`;
}
$('previewRecording').addEventListener('click', () => {
  if (!recorder.result) return;
  $('recordingPreview').src = recorder.result.url;
  $('previewDialog').showModal();
});
function closePreview() { $('recordingPreview').pause(); $('previewDialog').close(); }
$('closePreview').addEventListener('click', closePreview);
$('previewDialog').addEventListener('close', () => $('recordingPreview').pause());
$('previewDialog').addEventListener('click', event => { if (event.target === $('previewDialog')) closePreview(); });
$('snapshot').addEventListener('click', () => {
  if (!artwork.current) return;
  art.toBlob(blob => {
    if (!blob) { message('The frame could not be exported.', true); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `algoanimate-${$('engine').value}-${fileStamp()}.png`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'image/png');
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('stage').requestFullscreen) await $('stage').requestFullscreen();
    else message('Full screen is unavailable in this browser.');
  } catch { message('Full screen was not available.'); }
});

function updateUI(now) {
  const active = Boolean(audio.kind);
  const paused = audio.kind === 'file' && player.paused;
  const label = recorder.active ? 'RECORDING' : paused ? 'AUDIO PAUSED' : active && soundGate.open
    ? 'DRAWING · LIVE SOUND' : active ? 'SILENT · DRAWING PAUSED' : 'WAITING FOR SOUND';
  $('liveLabel').lastChild.textContent = label;
  $('liveLabel').classList.toggle('live', active && soundGate.open && !recorder.active);
  $('liveLabel').classList.toggle('recording', recorder.active);
  const decibels = features.rms > 1e-7 ? Math.max(-99, Math.round(20 * Math.log10(features.rms))) + ' dBFS' : 'SILENCE';
  $('signalInfo').textContent = active ? decibels + ' / ' + (audio.context.sampleRate / 1000).toFixed(1) + ' kHz' : 'CONNECT A SOURCE TO BEGIN';
  $('bassMeter').value = features.bass; $('midMeter').value = features.mid; $('trebleMeter').value = features.treble;
  $('beat').classList.toggle('lit', now < onsetUntil);
  $('fps').textContent = String(fps || '—');
  $('seed').textContent = artwork.drawnSeed || DEFAULT_SETTINGS.seed;
  $('recordTime').textContent = recorder.busy ? formatTime((now - recorder.started) / 1000) : '00:00';
}

function frame(now) {
  requestAnimationFrame(frame);
  if (previousFrame && now - previousFrame < 1000 / 30 - 1) return;
  const dt = previousFrame ? clamp((now - previousFrame) / 1000, 0.001, 0.12) : 1 / 30;
  previousFrame = now; clock += dt;
  const data = audio.read();
  features = data ? tracker.update(data.wave, data.frequencies, data.sampleRate, dt,
    +$('sensitivity').value / 100, +$('smoothing').value / 100) : SILENCE;
  if (features.beat) onsetUntil = now + 150;
  const available = Boolean(audio.kind) && !(audio.kind === 'file' && player.paused);
  const flowing = soundGate.update(features.active, dt, available && Boolean(data));
  if (artwork.flowing && !flowing) {
    // Reject a worker response that arrives after the source goes quiet.
    // Keep the exact painted frame and measure a fresh target on resumption.
    generation++; building = false;
    artwork.discardQueued(); requestedSeed = artwork.drawnSeed || DEFAULT_SETTINGS.seed;
    syncControls();
  }
  const seed = soundSeed.update(features, dt);
  const cycle = evolutionInterval(+$('evolution').value);
  if (features.active && !building && seed !== 'SOUND-READY'
    && (firstSoundSeed || (seed !== requestedSeed && artwork.needsScene(cycle, $('gentle').checked))) && clock - lastSceneTime >= 0.25) {
    lastSceneTime = clock;
    const startNow = firstSoundSeed; firstSoundSeed = false;
    generate(seed, false, startNow);
  }
  artwork.draw(features, dt, +$('motion').value / 100, $('gentle').checked, cycle, flowing);
  drawWaveform(data?.wave);
  if (recorder.busy) paintRecording();
  frames++;
  if (now - fpsStart > 1000) { fps = Math.round(frames * 1000 / (now - fpsStart)); frames = 0; fpsStart = now; }
  if (now - uiTime > 100) { updateUI(now); uiTime = now; }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && recorder.active) message('Keep the animation tab visible while recording so the video continues smoothly.');
});
window.addEventListener('pagehide', () => { if (recorder.active) recorder.stop(); audio.stop(); });

// Small read-only diagnostics surface for smoke tests and bug reports.
window.AlgoAnimate = Object.freeze({
  version: '0.03',
  diagnostics: () => ({
    source: audio.kind, seed: artwork.drawnSeed, engine: artwork.drawnMode,
    targetSeed: artwork.current?.seed, compositions: artwork.sceneCount,
    paths: artwork.current?.paths.length || 0, worker: Boolean(builder.worker), building,
    dimensions: [art.width, art.height], features: { level: features.level, bass: features.bass,
      mid: features.mid, treble: features.treble, rms: features.rms, active: features.active },
    recording: recorder.active, recordingBusy: recorder.busy,
    recordedBytes: recorder.result?.blob.size || 0, recordingType: recorder.result?.type || recorder.mimeType,
    drawing: { ...artwork.stats, layers: artwork.layers.length, cycles: artwork.turns,
      queuedSeed: artwork.queued?.seed || null, queuedSeconds: artwork.queuedSeconds, flowing: artwork.flowing },
    fps, maxTakeSeconds: MAX_TAKE_SECONDS
  })
});
syncControls(); drawWaveform(null); generate(DEFAULT_SETTINGS.seed, true);
requestAnimationFrame(frame);
