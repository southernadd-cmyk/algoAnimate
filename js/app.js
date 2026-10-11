import { AudioInput, describeCaptureError } from './audio.js';
import { FeatureTracker, SoundGate, SILENCE, clamp, evolutionInterval } from './features.js';
import { SceneBuilder, DEFAULT_SETTINGS } from './scenes.js';
import { LayeredArtwork, ensembleSettings } from './ensemble.js';
import { VideoRecorder, MAX_TAKE_SECONDS } from './recording.js';
import { StyleDeck, styleSettings } from './styles.js';
import { BandMeters, BAND_KEYS, meterLevel } from './meters.js';

const $ = id => document.getElementById(id);
const art = $('art'), waveform = $('waveform'), player = $('filePlayer');
const waveContext = waveform.getContext('2d');
const recordingCanvas = document.createElement('canvas');
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
const artwork = new LayeredArtwork(art), builder = new SceneBuilder();
const styleDeck = new StyleDeck();
const tracker = new FeatureTracker();
const bandMeters = new BandMeters();
const soundGate = new SoundGate();
let features = SILENCE, pending = false, fileURL = null, fileLabel = '', sourceLabel = '';
let layoutGeneration = 0, preparing = false;
let clock = 0, previousFrame = 0, uiTime = 0, onsetUntil = 0;
let frames = 0, fpsStart = performance.now(), fps = 0, recordingWithWaveform = false;
let startRecordPending = false;
const waveHistory = [];
const names = { tab: 'Browser tab audio', microphone: 'Microphone', demo: 'Demo · 108 BPM' };
const layerControls = artwork.voices.map(({ route }) => {
  const row = document.createElement('div'); row.className = 'engine-row'; row.dataset.engine = route.id;
  const heading = document.createElement('div'); heading.className = 'engine-title';
  const title = document.createElement('strong'); title.textContent = route.name;
  const state = document.createElement('span'); state.className = 'engine-state'; state.textContent = 'Holding';
  heading.append(title, state);
  const label = document.createElement('span'); label.textContent = route.label;
  label.className = 'engine-input';
  const sample = document.createElement('canvas'); sample.width = 240; sample.height = 44;
  sample.className = 'pen-sample'; sample.setAttribute('aria-hidden', 'true');
  const kit = document.createElement('div'); kit.className = 'engine-kit';
  const swatches = document.createElement('div'); swatches.className = 'ink-swatches'; swatches.setAttribute('aria-hidden', 'true');
  const palette = document.createElement('span'); palette.className = 'ink-name';
  const pen = document.createElement('span'); pen.className = 'pen-name';
  kit.append(pen, palette, swatches);
  const meter = document.createElement('meter'); meter.min = 0; meter.max = 1; meter.value = 0;
  meter.setAttribute('aria-label', route.name + ' response to ' + route.label);
  meter.title = route.label + ' input response';
  row.append(heading, label, sample, kit, meter); $('engineLayers').append(row);
  return { row, meter, state, sample, swatches, palette, pen, styleToken: null };
});
const isBuilding = () => preparing || artwork.voices.some(voice => voice.building);

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
  $('record').disabled = !audio.kind || !recorder.mimeType || !artwork.ready || locked || preparing;
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
  tracker.reset(); bandMeters.reset(); soundGate.reset(); artwork.resetSound(); features = SILENCE;
  waveHistory.length = 0;
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
  audio.stop(); tracker.reset(); bandMeters.reset(); soundGate.reset(); features = SILENCE;
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

function settings(voice, seed, style) {
  return ensembleSettings(voice.route, seed, $('orientation').value, 'marker', +$('density').value, style);
}
async function generateAll(immediate = false) {
  const request = ++layoutGeneration; preparing = true;
  for (const voice of artwork.voices) {
    voice.generation++; voice.building = false; voice.pendingStyle = null; voice.art.discardQueued();
  }
  syncControls();
  try {
    const scenes = await Promise.all(artwork.voices.map(voice => {
      const style = voice.art.drawnStyle ? styleDeck.withMood(voice.art.drawnStyle, $('palette').value)
        : styleDeck.next(artwork.voices, $('palette').value);
      if (!style) throw new Error('No ink kit available.');
      voice.pendingStyle = style;
      return builder.build(settings(voice, voice.art.drawnSeed || DEFAULT_SETTINGS.seed, style));
    }));
    if (request !== layoutGeneration) return;
    if (scenes.some(scene => !scene.paths.length)) throw new Error('A layer did not produce any marker paths.');
    artwork.setScenes(scenes, immediate);
    $('stage').classList.toggle('portrait', scenes[0].height > scenes[0].width);
    $('dimensions').textContent = scenes[0].width + ' × ' + scenes[0].height;
  } catch (error) {
    if (request === layoutGeneration) message('Composition error: ' + error.message, true);
  } finally {
    if (request === layoutGeneration) {
      for (const voice of artwork.voices) voice.pendingStyle = null;
      preparing = false; syncControls();
    }
  }
}
async function generateVoice(voice, seed) {
  const style = styleDeck.next(artwork.voices, $('palette').value);
  if (!style) return;
  const request = ++voice.generation, layout = layoutGeneration;
  voice.requestedSeed = seed; voice.building = true; voice.pendingStyle = style;
  try {
    const scene = await builder.build(settings(voice, seed, style));
    if (request !== voice.generation || layout !== layoutGeneration || !voice.flowing) return;
    if (!scene.paths.length) throw new Error(voice.route.name + ' did not produce any marker paths.');
    voice.art.setScene(scene, false, voice.firstSoundSeed);
    voice.firstSoundSeed = false;
  } catch (error) {
    if (request === voice.generation) {
      voice.requestedSeed = voice.art.drawnSeed || DEFAULT_SETTINGS.seed;
      message('Composition error: ' + error.message, true);
    }
  } finally { if (request === voice.generation) { voice.building = false; voice.pendingStyle = null; } }
}
for (const id of ['orientation', 'palette', 'density']) {
  $(id).addEventListener('change', () => {
    if (id === 'orientation' && recorder.busy) return;
    generateAll(id === 'orientation' || !soundGate.open);
  });
}
for (const id of ['sensitivity', 'motion', 'evolution', 'smoothing', 'density']) {
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
  if (!audio.kind || recorder.busy || pending || !artwork.ready || startRecordPending || preparing) return;
  startRecordPending = true; syncControls();
  try {
    await audio.ready();
    recordingWithWaveform = $('includeWaveform').checked;
    recordingCanvas.width = art.width;
    recordingCanvas.height = art.height + (recordingWithWaveform ? 156 : 0);
    paintRecording();
    recorder.start(recordingCanvas, audio.recordingStream);
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
  $('download').download = `algoanimate-ensemble-${fileStamp()}.${take.extension}`;
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
    link.href = url; link.download = `algoanimate-ensemble-${fileStamp()}.png`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'image/png');
});
$('clearCanvas').addEventListener('click', () => {
  artwork.clearInk();
  message(audio.kind
    ? 'Canvas cleared. Your audio is still connected; fresh marks will follow the sound.'
    : 'Canvas cleared. Connect audio to draw again.');
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
  for (const key of BAND_KEYS) {
    const band = bandMeters.bands[key];
    const text = band.db === null || band.db < -60 ? '—' : Math.round(band.db) + ' dB';
    $(key + 'Meter').value = band.level;
    $(key + 'Meter').setAttribute('aria-valuetext', text === '—' ? 'Silent or below −60 dBFS' : text + 'FS');
    $(key + 'Db').textContent = text;
  }
  $('beat').classList.toggle('lit', now < onsetUntil);
  $('fps').textContent = String(fps || '—');
  $('seed').textContent = artwork.drawnSeed || DEFAULT_SETTINGS.seed;
  $('sceneCount').textContent = String(artwork.sceneCount).padStart(2, '0');
  $('activeLayers').textContent = artwork.voices.filter(voice => voice.flowing).length + ' / 8 DRAWING';
  // Engine card bars display routed input response, not spectral bin averages.
  const routedLevels = {
    bass: bandMeters.bands.bass.level, mid: bandMeters.bands.mid.level,
    treble: bandMeters.bands.treble.level, level: meterLevel(features.rms),
    centroid: clamp(features.centroid / 0.7), flux: clamp(features.flux * 3)
  };
  for (let index = 0; index < artwork.voices.length; index++) {
    const voice = artwork.voices[index], controls = layerControls[index];
    const response = features.active
      ? voice.route.inputs.reduce((sum, key) => sum + routedLevels[key], 0) / voice.route.inputs.length
      : 0;
    controls.meter.value = response;
    controls.meter.setAttribute('aria-valuetext', Math.round(response * 100) + '% input response');
    controls.row.classList.toggle('drawing', voice.flowing);
    controls.state.textContent = voice.flowing ? 'Drawing' : 'Holding';
    controls.row.title = voice.flowing ? 'Drawing from ' + voice.route.label.toLowerCase() : 'Ink held; listening for ' + voice.route.label.toLowerCase();
    const style = voice.art.drawnStyle;
    if (style && controls.styleToken !== style.token) {
      controls.styleToken = style.token;
      controls.row.dataset.pen = style.pen.id; controls.row.dataset.palette = style.palette.id;
      controls.pen.textContent = style.pen.name; controls.palette.textContent = style.palette.name;
      controls.row.style.setProperty('--ink-color', style.colors[0]);
      controls.swatches.replaceChildren(...style.colors.map(color => {
        const swatch = document.createElement('i'); swatch.style.backgroundColor = color; return swatch;
      }));
      // The sample is drawn by the same native marker engine as the artwork.
      const context = controls.sample.getContext('2d'), A = window.AlgoArt;
      context.clearRect(0, 0, 240, 44);
      const random = A.makeR('PREVIEW-' + style.token);
      for (let i = 0; i < 3; i++) A.stroke(context,
        [{ x: 6 + i * 78, y: 26 }, { x: 25 + i * 78, y: 5 },
          { x: 44 + i * 78, y: 40 }, { x: 72 + i * 78, y: 18 }],
        style.colors[i], styleSettings(style), random, true);
    }
  }
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
  bandMeters.update(features.bandRms, dt, features.active, available && Boolean(data));
  const flowing = soundGate.update(features.active, dt, available && Boolean(data));
  for (const voice of artwork.updateSignals(features, dt, flowing && available && Boolean(data))) {
    // Cancel only this route's obsolete work; the other engines keep drawing.
    voice.generation++; voice.building = false; voice.pendingStyle = null;
    voice.art.discardQueued(); voice.requestedSeed = voice.art.drawnSeed || DEFAULT_SETTINGS.seed;
  }
  const cycle = evolutionInterval(+$('evolution').value);
  for (const voice of artwork.voices) {
    const seed = voice.sound.seed;
    if (!preparing && voice.flowing && voice.sound.features.active && !voice.building && seed !== 'SOUND-READY'
      && (voice.firstSoundSeed || voice.art.needsScene(cycle, $('gentle').checked))
      && clock - voice.lastSceneTime >= 0.25) {
      voice.lastSceneTime = clock; generateVoice(voice, seed);
    }
  }
  artwork.draw(dt, +$('motion').value / 100, $('gentle').checked, cycle);
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
  version: '0.08',
  diagnostics: () => ({
    source: audio.kind, audio: audio.diagnostics(), seed: artwork.drawnSeed, engine: 'ensemble',
    engines: artwork.diagnostics(), compositions: artwork.sceneCount,
    paths: artwork.pathCount, worker: Boolean(builder.worker), building: isBuilding(),
    dimensions: [art.width, art.height], features: { level: features.level, bass: features.bass,
      mid: features.mid, treble: features.treble, rms: features.rms, active: features.active },
    bandMeters: { scale: [-60, 0], ...bandMeters.bands },
    recording: recorder.active, recordingBusy: recorder.busy,
    recordedBytes: recorder.result?.blob.size || 0, recordingType: recorder.result?.type || recorder.mimeType,
    drawing: { ...artwork.stats, blank: artwork.voices.every(voice => voice.art.blank), pens: 24,
      queuedSeed: artwork.voices.find(voice => voice.art.queued)?.art.queued.seed || null, flowing: artwork.flowing },
    fps, maxTakeSeconds: MAX_TAKE_SECONDS
  })
});
syncControls(); drawWaveform(null); generateAll(true);
requestAnimationFrame(frame);
