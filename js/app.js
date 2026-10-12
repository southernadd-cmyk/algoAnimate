import { AudioInput, describeCaptureError } from './audio.js';
import { FeatureTracker, SoundGate, SILENCE, clamp, evolutionInterval } from './features.js';
import { SceneBuilder, DEFAULT_SETTINGS } from './scenes.js';
import { LayeredArtwork, ensembleSettings, profileShift, EARLY_REFRESH_COOLDOWN_SECONDS } from './ensemble.js';
import { goldenRotationPhase } from './phi-layout.js';
import { VideoRecorder, MAX_TAKE_SECONDS } from './recording.js';
import { StyleDeck, styleSettings } from './styles.js';
import { BandMeters, SpectralChangeMeter, BAND_KEYS, meterLevel } from './meters.js';
import { FrameClock } from './frame-clock.js';
import { DemoPlaylist, DEMO_TRACKS } from './demo.js';
import { captureSheet, paintSheet, sheetSVG } from './export.js';
import { ScoreCapture, ScoreReplay, parseScore, MAX_SCORE_BYTES } from './scores.js';
import { ScreenAwake, shortcut } from './performance.js';
import { ListeningOverlay } from './listening.js';
import { pngWithDpi } from './png.js';

const $ = id => document.getElementById(id);
const art = $('art'), waveform = $('waveform'), player = $('filePlayer'), demoPlayer = $('demoPlayer');
const waveContext = waveform.getContext('2d');
const recordingCanvas = document.createElement('canvas');
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
const artwork = new LayeredArtwork(art), builder = new SceneBuilder();
const styleDeck = new StyleDeck();
const tracker = new FeatureTracker();
const bandMeters = new BandMeters();
const changeMeter = new SpectralChangeMeter();
const soundGate = new SoundGate();
let features = SILENCE, pending = false, fileURL = null, fileLabel = '', sourceLabel = '';
let pendingSource = '';
let layoutGeneration = 0, preparing = false;
let clock = 0, previousFrame = 0, uiTime = 0, onsetUntil = 0, clearHoldUntil = 0;
let frames = 0, fpsStart = performance.now(), fps = 0, recordingWithWaveform = false;
let startRecordPending = false, demoSwitching = false;
let drawingPaused = false, performanceMode = false, performanceTimer = null;
let scoreCapture = null, scoreData = null, replay = null, scoreTakeStarted = null;
const waveHistory = [];
const listening = new ListeningOverlay($('listeningOverlay'), artwork.voices.map(voice => voice.route));
const awake = new ScreenAwake(status => {
  const text = { awake: 'Screen kept awake', off: 'Screen wake lock off', released: 'Screen wake lock released', unavailable: 'Screen wake lock unavailable', failed: 'Couldn’t keep screen awake' }[status];
  $('wakeStatus').textContent = text;
  $('performanceStatus').textContent = (recorder.active ? '● Recording · ' : '') + text;
});
const names = { tab: 'Browser tab audio', microphone: 'Microphone', demo: 'Lo-fi demo' };
const layerControls = artwork.voices.map(voice => {
  const { route } = voice;
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
  const mix = document.createElement('div'); mix.className = 'engine-mix';
  const solo = document.createElement('button'), mute = document.createElement('button');
  for (const [button, action] of [[solo, 'Solo'], [mute, 'Mute']]) {
    button.type = 'button'; button.textContent = action;
    button.setAttribute('aria-label', action + ' ' + route.name); button.setAttribute('aria-pressed', 'false');
  }
  const toggleSolo = () => { if (replay) return; artwork.toggleSolo(route.id); syncMix(); };
  solo.addEventListener('click', toggleSolo);
  mute.addEventListener('click', () => { if (replay) return; artwork.toggleMute(route.id); syncMix(); });
  row.addEventListener('click', event => { if (!event.target.closest('button')) toggleSolo(); });
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', route.name + ' drawing voice');
  mix.append(solo, mute); row.append(heading, label, sample, kit, meter, mix); $('engineLayers').append(row);
  return { row, meter, state, sample, swatches, palette, pen, solo, mute, styleToken: null };
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
  onChange: () => { syncScoreCapture(); syncControls(); updateTake(); },
  onError: error => message(error.message, true)
});
const audio = new AudioInput({ onEnded: () => disconnect(true) });
const demoPlaylist = new DemoPlaylist(demoPlayer, {
  onTrack: track => {
    sourceLabel = names.demo + ' · ' + track.title;
    $('demoTrackLink').textContent = track.title;
    $('demoTrackLink').href = track.source;
    syncControls();
  },
  onLoading: () => syncControls(),
  onError: error => {
    disconnect().then(() => message('Demo music could not load. Try the demo again or choose your own audio file. ' + error.message, true));
  }
});

function syncMix() {
  layerControls.forEach((controls, index) => {
    const voice = artwork.voices[index];
    controls.solo.setAttribute('aria-pressed', String(artwork.solo === voice.route.id));
    controls.mute.setAttribute('aria-pressed', String(voice.muted));
    controls.solo.disabled = controls.mute.disabled = Boolean(replay);
    controls.row.classList.toggle('is-muted', !artwork.enabled(voice));
    controls.row.classList.toggle('is-solo', artwork.solo === voice.route.id);
  });
}

function syncScoreCapture() {
  if (recorder.active && scoreTakeStarted !== recorder.started) {
    scoreTakeStarted = recorder.started;
    scoreData = null; scoreCapture = new ScoreCapture(recorder.started, sourceLabel);
    scoreCapture.capture(recorder.started, artwork, features, $('gentle').checked);
  } else if (!recorder.active && scoreCapture) finishScore();
}
function finishScore() {
  scoreData = scoreCapture?.finish() || scoreData; scoreCapture = null; syncScoreControls();
}
function syncScoreControls() {
  const busy = recorder.busy || pending || startRecordPending || preparing;
  $('saveScore').disabled = !scoreData;
  $('loadScore').disabled = busy;
  $('replayScore').disabled = busy || !scoreData;
  $('scoreTransport').hidden = !replay;
  $('scoreInfo').textContent = scoreCapture ? 'Capturing the score with this take…'
    : scoreData ? formatTime(scoreData.duration / 1000) + ' · ' + scoreData.frames.length + ' frames · replay without audio'
      : 'Every take also captures a score. Replay the ink without audio.';
  for (const id of ['palette', 'density', 'evolution', 'sensitivity', 'motion', 'smoothing', 'gentle']) $(id).disabled = Boolean(replay);
}
function setSheetSize(sheet) {
  if (art.width !== sheet.width) art.width = sheet.width;
  if (art.height !== sheet.height) art.height = sheet.height;
  $('stage').classList.toggle('portrait', sheet.height > sheet.width);
  $('dimensions').textContent = sheet.width + ' × ' + sheet.height;
}
function leaveScoreReplay() {
  if (!replay) return;
  replay = null; document.body.classList.remove('replaying');
  if (artwork.paperScene) setSheetSize(artwork.paperScene);
  features = SILENCE; bandMeters.reset(); changeMeter.reset(); previousFrame = 0;
  syncControls();
}
function beginScoreReplay() {
  if (!scoreData || recorder.busy || pending || preparing) return;
  try {
    if (!scoreData.validated) scoreData = parseScore(JSON.stringify(scoreData));
    audio.stop(); artwork.resetSound(); soundGate.reset();
    replay = new ScoreReplay(scoreData); drawingPaused = false;
    document.body.classList.add('replaying'); $('scoreSeek').max = scoreData.duration;
    setSheetSize(replay.sheet()); paintSheet(artwork.context, replay.sheet()); previousFrame = 0;
    syncControls(); message('Replaying the recorded score. No audio is needed. Seek to any frame and export it.');
  } catch (error) { message('Score could not be replayed: ' + error.message, true); }
}
$('saveScore').addEventListener('click', () => {
  if (scoreData) downloadBlob(new Blob([JSON.stringify(scoreData)], { type: 'application/json' }), `algoanimate-score-${fileStamp()}.json`);
});
$('loadScore').addEventListener('click', () => $('scoreInput').click());
$('scoreInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file || recorder.busy || pending) return;
  try {
    if (file.size > MAX_SCORE_BYTES) throw new Error('Scores must be smaller than 20 MB.');
    const loaded = parseScore(await file.text());
    if (recorder.busy || pending) return;
    scoreData = loaded; beginScoreReplay();
  } catch (error) { message('Score could not be loaded: ' + error.message, true); }
});
$('replayScore').addEventListener('click', beginScoreReplay);
$('leaveReplay').addEventListener('click', leaveScoreReplay);
$('scoreRestart').addEventListener('click', () => { if (replay) { replay.seek(0); replay.paused = false; syncControls(); } });
$('scoreSeek').addEventListener('input', () => { if (replay) { replay.seek(+$('scoreSeek').value); replay.paused = true; } });
$('scorePause').addEventListener('click', () => { if (replay) { if (replay.time >= replay.score.duration) replay.seek(0); replay.paused = !replay.paused; syncControls(); } });
$('pauseDrawing').addEventListener('click', () => {
  if (replay) { $('scorePause').click(); return; }
  drawingPaused = !drawingPaused; syncControls();
});
$('listen').addEventListener('click', () => {
  $('listeningOverlay').hidden = !$('listeningOverlay').hidden;
  $('listen').setAttribute('aria-pressed', String(!$('listeningOverlay').hidden));
  if (!$('listeningOverlay').hidden) listening.update(features, replay ? replay.engines : artwork.diagnostics(), Boolean(replay));
});

function showPerformanceControls() {
  if (!performanceMode) return;
  $('performanceControls').classList.add('show-controls'); clearTimeout(performanceTimer);
  performanceTimer = setTimeout(() => $('performanceControls').classList.remove('show-controls'), 2500);
}
function setPerformance(active) {
  performanceMode = active; document.body.classList.toggle('performance', active);
  $('performance').setAttribute('aria-pressed', String(active));
  $('performanceControls').hidden = !active;
  if (active) { $('stage').tabIndex = -1; $('stage').focus({ preventScroll: true }); showPerformanceControls(); }
  else { clearTimeout(performanceTimer); $('performance').focus({ preventScroll: true }); }
  syncControls();
}
$('performance').addEventListener('click', () => {
  setPerformance(true);
  // Fullscreen must be requested in the click itself to retain user activation.
  if (!document.fullscreenElement) $('stage').requestFullscreen?.().catch(() => {});
});
$('exitPerformance').addEventListener('click', () => { setPerformance(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });
for (const [id, target] of [['performancePause', 'pauseDrawing'], ['performanceClear', 'clearCanvas'], ['performanceListen', 'listen']]) {
  $(id).addEventListener('click', () => $(target).click());
}
$('performanceRecord').addEventListener('click', () => $(recorder.busy ? 'stopRecording' : 'record').click());
$('stage').addEventListener('pointermove', showPerformanceControls);
$('stage').addEventListener('pointerdown', showPerformanceControls);
document.addEventListener('fullscreenchange', () => {
  if (!performanceMode) return;
  if (!document.fullscreenElement) setPerformance(false);
  else $('stage').focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if ($('previewDialog').open) return;
  if (event.key === 'Escape' && performanceMode) { $('exitPerformance').click(); return; }
  const action = shortcut(event); if (!action) return;
  event.preventDefault(); showPerformanceControls();
  $(action === 'record' && recorder.busy ? 'stopRecording' : action).click();
});

function syncControls() {
  frameClock.setRecording(recorder.active);
  awake.setWanted(performanceMode || recorder.active);
  syncScoreControls();
  syncMix();
  $('pauseDrawing').textContent = replay ? replay.paused ? 'Resume replay' : 'Pause replay'
    : drawingPaused ? 'Resume drawing' : 'Pause drawing';
  $('pauseDrawing').setAttribute('aria-pressed', String(replay ? replay.paused : drawingPaused));
  $('performancePause').textContent = replay ? replay.paused ? 'Resume replay' : 'Pause replay'
    : drawingPaused ? 'Resume drawing' : 'Pause drawing';
  $('performanceRecord').textContent = recorder.busy ? 'Stop recording' : 'Record';
  const locked = pending || recorder.busy || startRecordPending;
  const demoLoading = demoPlaylist.loading || (pending && pendingSource === names.demo);
  $('connectTab').disabled = locked || !navigator.mediaDevices?.getDisplayMedia;
  $('connectMic').disabled = locked || !navigator.mediaDevices?.getUserMedia;
  $('chooseFile').disabled = locked;
  $('fileInput').disabled = locked;
  $('playDemo').disabled = locked || demoLoading;
  $('playDemo').setAttribute('aria-busy', String(demoLoading));
  $('stopAudio').disabled = !audio.kind || pending || startRecordPending;
  $('orientation').disabled = recorder.busy || startRecordPending || Boolean(replay);
  $('sharedAnchor').disabled = recorder.busy || startRecordPending || Boolean(replay);
  $('includeWaveform').disabled = recorder.busy || startRecordPending;
  $('record').disabled = Boolean(replay) || !audio.kind || !recorder.mimeType || !artwork.ready || locked || preparing;
  $('record').hidden = recorder.busy;
  $('stopRecording').hidden = !recorder.busy;
  $('stopRecording').disabled = Boolean(recorder.stopping);
  $('previewRecording').disabled = recorder.busy || pending;
  document.querySelector('.recording-section').classList.toggle('is-recording', recorder.busy);
  $('recordingFormat').textContent = recorder.mimeType ? (recorder.mimeType.includes('mp4') ? 'MP4 / 30 FPS' : 'WEBM / 30 FPS') : 'UNAVAILABLE';
  $('recordHint').textContent = recorder.stopping ? 'Finishing your video…'
    : recorder.active ? 'Recording artwork + sound. You can control your sound tab. Stops at 03:00.'
      : !recorder.mimeType ? 'Video recording is unavailable here. You can still save a PNG.'
        : audio.kind ? 'Records artwork + sound. Up to 3 minutes per take.' : 'Connect sound to record. Up to 3 minutes per take.';
  $('sourceName').textContent = pending ? 'Connecting…' : audio.kind ? sourceLabel || names[audio.kind] || 'Audio file' : 'No audio connected';
  $('sourceDot').classList.toggle('active', Boolean(audio.kind));
  $('demoButtonLabel').textContent = demoLoading ? 'Loading track…' : audio.kind === 'demo'
    ? demoPlayer.paused ? 'Resume demo sound' : 'Demo playing' : 'Try demo sound';
  $('demoTrackNumber').textContent = String(demoPlaylist.index + 1).padStart(2, '0')
    + ' / ' + String(DEMO_TRACKS.length).padStart(2, '0');
  $('demoDeck').hidden = audio.kind !== 'demo';
  $('demoDeck').setAttribute('aria-busy', String(demoLoading));
  $('nextDemo').disabled = pending || demoLoading || demoSwitching || audio.kind !== 'demo';
  player.hidden = !fileURL || (audio.kind !== 'file' && audio.kind !== null);
  player.inert = pending || recorder.busy;
}

function resetSound() {
  tracker.reset(); bandMeters.reset(); changeMeter.reset(); soundGate.reset(); artwork.resetSound(); features = SILENCE;
  waveHistory.length = 0;
}

async function connect(action, label) {
  if (pending || recorder.busy || startRecordPending) return;
  leaveScoreReplay(); drawingPaused = false;
  pending = true; pendingSource = label; message(''); syncControls();
  try {
    // action() is invoked synchronously so tab capture retains user activation.
    await action();
    sourceLabel = audio.kind === 'demo' ? names.demo + ' · ' + demoPlaylist.track.title : label;
    resetSound();
    message(audio.kind === 'tab' ? 'Connected. Return to your sound tab to control playback.' : 'Connected. Play some sound and watch the marks respond.');
  } catch (error) { message(describeCaptureError(error), true); }
  finally { pending = false; pendingSource = ''; syncControls(); }
}

async function disconnect(ended = false) {
  if (pending) return;
  if (recorder.busy) await recorder.stop();
  audio.stop(); tracker.reset(); bandMeters.reset(); changeMeter.reset(); soundGate.reset(); features = SILENCE;
  message(ended ? 'The audio source ended. Your last drawing is held on the paper.' : 'Audio disconnected. Your last drawing is held on the paper.');
  syncControls();
}

$('connectTab').addEventListener('click', () => connect(() => audio.tab(), names.tab));
$('connectMic').addEventListener('click', () => connect(() => audio.microphone(), names.microphone));
$('playDemo').addEventListener('click', () => {
  if (audio.kind === 'demo') {
    audio.ready().then(() => demoPlayer.play()).catch(error => message(error.message, true));
    return;
  }
  connect(async () => {
    await audio.demo(demoPlayer);
    audio.cleanup = () => demoPlaylist.stop();
    try { await demoPlaylist.start(); }
    catch (error) { audio.stop(); throw error; }
  }, names.demo);
});
$('nextDemo').addEventListener('click', async () => {
  if (pending || demoSwitching || audio.kind !== 'demo') return;
  demoSwitching = true; syncControls();
  try { await demoPlaylist.next(); }
  catch (error) { await disconnect(); message('The next demo track could not load. Try the demo again. ' + error.message, true); }
  finally { demoSwitching = false; syncControls(); }
});
demoPlayer.addEventListener('play', () => syncControls());
demoPlayer.addEventListener('pause', () => { soundGate.reset(); syncControls(); });
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
  return { ...ensembleSettings(voice.route, seed, $('orientation').value, 'marker', +$('density').value,
    style, voice.sound.profile, goldenRotationPhase(artwork.layoutTime)), sharedAnchor: $('sharedAnchor').checked };
}
async function generateAll(immediate = false) {
  const request = ++layoutGeneration; preparing = true;
  for (const voice of artwork.voices) {
    voice.generation++; voice.building = false; voice.pendingStyle = null; voice.art.discardQueued();
  }
  syncControls();
  try {
    const snapshots = artwork.voices.map(voice => voice.sound.profile && { ...voice.sound.profile });
    const scenes = await Promise.all(artwork.voices.map(voice => {
      const style = voice.art.drawnStyle ? styleDeck.withMood(voice.art.drawnStyle, $('palette').value)
        : styleDeck.next(artwork.voices, $('palette').value, voice.sound.seed, voice.route.id, voice.sound.profile);
      if (!style) throw new Error('No ink kit available.');
      voice.pendingStyle = style;
      return builder.build(settings(voice, voice.art.drawnSeed || DEFAULT_SETTINGS.seed, style));
    }));
    if (request !== layoutGeneration) return;
    if (scenes.some(scene => !scene.paths.length)) throw new Error('A layer did not produce any marker paths.');
    artwork.setScenes(scenes, immediate);
    artwork.voices.forEach((voice, index) => { voice.lastCompositionProfile = snapshots[index]; });
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
  const snapshot = voice.sound.profile && { ...voice.sound.profile };
  const style = styleDeck.next(artwork.voices, $('palette').value, seed, voice.route.id, voice.sound.profile);
  if (!style) return;
  const request = ++voice.generation, layout = layoutGeneration;
  voice.requestedSeed = seed; voice.building = true; voice.pendingStyle = style;
  try {
    const scene = await builder.build(settings(voice, seed, style));
    if (request !== voice.generation || layout !== layoutGeneration || !voice.flowing || !artwork.enabled(voice)) return;
    if (!scene.paths.length) throw new Error(voice.route.name + ' did not produce any marker paths.');
    artwork.setVoiceScene(voice, scene, false, voice.firstSoundSeed);
    voice.lastCompositionProfile = snapshot;
    voice.firstSoundSeed = false;
  } catch (error) {
    if (request === voice.generation) {
      voice.requestedSeed = voice.art.drawnSeed || DEFAULT_SETTINGS.seed;
      message('Composition error: ' + error.message, true);
    }
  } finally { if (request === voice.generation) { voice.building = false; voice.pendingStyle = null; } }
}
for (const id of ['orientation', 'palette', 'density', 'sharedAnchor']) {
  $(id).addEventListener('change', () => {
    if (replay || (id === 'orientation' && recorder.busy)) return;
    generateAll(id === 'orientation' || id === 'sharedAnchor' || !soundGate.open);
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
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('snapshot').addEventListener('click', () => {
  if (!artwork.current || preparing) return;
  try {
    const format = $('exportFormat').value;
    const sheet = replay ? replay.sheet() : captureSheet(artwork, $('gentle').checked);
    if (format === 'svg') {
      downloadBlob(new Blob([sheetSVG(sheet)], { type: 'image/svg+xml' }), `algoanimate-${fileStamp()}.svg`); return;
    }
    const canvas = format === 'print' ? document.createElement('canvas') : art;
    if (format === 'print') {
      canvas.width = sheet.width * 3; canvas.height = sheet.height * 3;
      paintSheet(canvas.getContext('2d', { alpha: false }), sheet, 3);
    }
    canvas.toBlob(async blob => {
      try {
        if (!blob) throw new Error('PNG encoding failed');
        downloadBlob(format === 'print' ? await pngWithDpi(blob) : blob,
          `algoanimate-${fileStamp()}${format === 'print' ? '-3x-300dpi' : ''}.png`);
      } catch { message('The frame could not be exported.', true); }
      // Release the large print surface as soon as PNG encoding finishes.
      if (format === 'print') { canvas.width = 1; canvas.height = 1; }
    }, 'image/png');
  } catch (error) { message('Export failed: ' + error.message, true); }
});
$('clearCanvas').addEventListener('click', () => {
  if (replay) { message('Return to live drawing to clear the canvas.'); return; }
  artwork.clearInk();
  // A one-second hold made each sound restart look like a blank page.
  // Clear immediately, then start the first new visible stroke on the next frame.
  clearHoldUntil = performance.now() + 24;
  artwork.draw(0, +$('motion').value / 100, $('gentle').checked, evolutionInterval(+$('evolution').value));
  $('clearCanvas').textContent = 'Canvas cleared ✓';
  message(audio.kind
    ? 'Canvas cleared. Fresh ink will respond immediately to the sound.'
    : 'Canvas cleared. Connect audio to draw again.');
});

function updateUI(now) {
  $('clearCanvas').textContent = now < clearHoldUntil ? 'Canvas cleared ✓' : 'Clear canvas ↺';
  const active = Boolean(audio.kind) || Boolean(replay);
  const paused = Boolean(audio.mediaElement?.paused);
  const label = replay ? replay.paused ? 'SCORE · HELD' : 'SCORE · REPLAYING' : drawingPaused ? 'DRAWING PAUSED' : recorder.active ? 'RECORDING' : paused ? 'AUDIO PAUSED' : active && soundGate.open
    ? 'DRAWING · LIVE SOUND' : active ? 'SILENT · DRAWING PAUSED' : 'WAITING FOR SOUND';
  $('liveLabel').lastChild.textContent = label;
  $('liveLabel').classList.toggle('live', active && soundGate.open && !recorder.active);
  $('liveLabel').classList.toggle('recording', recorder.active);
  const decibels = features.rms > 1e-7 ? Math.max(-99, Math.round(20 * Math.log10(features.rms))) + ' dBFS' : 'SILENCE';
  $('signalInfo').textContent = replay ? decibels + ' / RECORDED FEATURES' : active ? decibels + ' / ' + (audio.context.sampleRate / 1000).toFixed(1) + ' kHz' : 'CONNECT A SOURCE TO BEGIN';
  for (const key of BAND_KEYS) {
    const band = bandMeters.bands[key];
    const text = band.db === null || band.db < -60 ? '—' : Math.round(band.db) + ' dB';
    $(key + 'Meter').value = band.level;
    $(key + 'Meter').setAttribute('aria-valuetext', text === '—' ? 'Silent or below −60 dBFS' : text + 'FS');
    $(key + 'Db').textContent = text;
  }
  $('beat').classList.toggle('lit', now < onsetUntil);
  $('fps').textContent = String(fps || '—');
  $('seed').textContent = replay ? 'SCORE / FRAME ' + String(replay.index + 1) : artwork.drawnSeed || DEFAULT_SETTINGS.seed;
  $('sceneCount').textContent = String(artwork.sceneCount).padStart(2, '0');
  $('activeLayers').textContent = (replay ? replay.engines : artwork.voices).filter(voice => voice.flowing).length + ' / ' + artwork.voices.length + ' DRAWING';
  // The onsets/change bar shows the unamplified *measured* positive
  // spectral change observed since the last UI refresh, not the artistically
  // smoothed flux multiplied by three. Also fixes the combined bass+onsets bar.
  const routedLevels = {
    bass: bandMeters.bands.bass.level, mid: bandMeters.bands.mid.level,
    treble: bandMeters.bands.treble.level, level: meterLevel(features.rms),
    centroid: clamp(features.centroid / 0.7), flux: changeMeter.take()
  };
  for (let index = 0; index < artwork.voices.length; index++) {
    const voice = artwork.voices[index], controls = layerControls[index];
    const response = features.active
      ? voice.route.inputs.reduce((sum, key) => sum + routedLevels[key], 0) / voice.route.inputs.length
      : 0;
    controls.meter.value = response;
    controls.meter.setAttribute('aria-valuetext', voice.route.id === 'network'
      ? Math.round(response * 100) + '% measured positive spectral change (recent peak)'
      : Math.round(response * 100) + '% input response');
    controls.row.classList.toggle('drawing', voice.flowing);
    controls.state.textContent = !artwork.enabled(voice) ? 'Muted' : voice.flowing ? 'Drawing' : 'Holding';
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
  if (!$('listeningOverlay').hidden) listening.update(features, replay ? replay.engines : artwork.diagnostics(), Boolean(replay));
  if (replay) {
    $('scoreSeek').value = replay.time;
    $('scoreTime').textContent = formatTime(replay.time / 1000) + ' / ' + formatTime(replay.score.duration / 1000);
    $('scorePause').textContent = replay.paused ? 'Resume replay' : 'Pause replay';
    $('performancePause').textContent = replay.paused ? 'Resume replay' : 'Pause replay';
  }
}

function frame(now) {
  if (previousFrame && now - previousFrame < 1000 / 30 - (recorder.active ? 4 : 1)) return;
  const dt = previousFrame ? clamp((now - previousFrame) / 1000, 0.001, 0.12) : 1 / 30;
  previousFrame = now; clock += dt;
  if (replay) {
    replay.advance(dt); const sheet = replay.sheet(); setSheetSize(sheet);
    paintSheet(artwork.context, sheet); features = replay.features;
    bandMeters.update(features.bandRms, dt, features.active, true);
    changeMeter.sample(features.raw.flux, features.active, true);
    if (features.beat) onsetUntil = now + 150;
    drawWaveform(null); updateUI(now); return;
  }
  const data = audio.read();
  features = data ? tracker.update(data.wave, data.frequencies, data.sampleRate, dt,
    +$('sensitivity').value / 100, +$('smoothing').value / 100) : SILENCE;
  if (features.beat) onsetUntil = now + 150;
  const available = Boolean(audio.kind) && !audio.mediaElement?.paused && !drawingPaused;
  bandMeters.update(features.bandRms, dt, features.active, available && Boolean(data));
  changeMeter.sample(features.raw.flux, features.active, available && Boolean(data));
  const flowing = soundGate.update(features.active, dt, available && Boolean(data));
  for (const voice of artwork.updateSignals(features, dt, flowing && available && Boolean(data) && now >= clearHoldUntil)) {
    // Cancel only this route's obsolete work; the other engines keep drawing.
    voice.generation++; voice.building = false; voice.pendingStyle = null;
    voice.art.discardQueued(); voice.requestedSeed = voice.art.drawnSeed || DEFAULT_SETTINGS.seed;
  }
  const cycle = evolutionInterval(+$('evolution').value);
  for (const voice of artwork.voices) {
    const seed = voice.sound.seed;
    if (!preparing && voice.flowing && voice.sound.features.active && !voice.building && seed !== 'SOUND-READY'
      && (!voice.firstSoundSeed || artwork.entryFinished)
      && (voice.firstSoundSeed || voice.art.needsScene(cycle, $('gentle').checked)
        || (artwork.entryFinished && !voice.art.queued
          && clock - voice.lastSceneTime >= EARLY_REFRESH_COOLDOWN_SECONDS
          && profileShift(voice.lastCompositionProfile, voice.sound.profile, voice.route.inputs)))
      && clock - voice.lastSceneTime >= 0.25) {
      voice.lastSceneTime = clock; generateVoice(voice, seed);
    }
  }
  artwork.draw(dt, +$('motion').value / 100, $('gentle').checked, cycle);
  drawWaveform(data?.wave);
  if (recorder.active) { paintRecording(); recorder.captureFrame(); }
  if (scoreCapture && !scoreCapture.capture(now, artwork, features, $('gentle').checked)) finishScore();
  frames++;
  if (now - fpsStart > 1000) { fps = Math.round(frames * 1000 / (now - fpsStart)); frames = 0; fpsStart = now; }
  if (now - uiTime > 100) { updateUI(now); uiTime = now; }
}

window.addEventListener('pagehide', () => { if (recorder.active) recorder.stop(); awake.dispose(); clearTimeout(performanceTimer); frameClock.stop(); audio.stop(); });

// Small read-only diagnostics surface for smoke tests and bug reports.
window.AlgoAnimate = Object.freeze({
  version: '0.18',
  diagnostics: () => ({
    source: audio.kind, paused: drawingPaused, performance: performanceMode, wakeLock: awake.status,
    replay: replay ? { frame: replay.index, time: replay.time, paused: replay.paused, duration: replay.score.duration } : null,
    score: scoreData ? { frames: scoreData.frames.length, scenes: scoreData.scenes.length, duration: scoreData.duration } : null,
    audio: audio.diagnostics(), seed: artwork.drawnSeed, engine: 'ensemble',
    demo: audio.kind === 'demo' ? { title: demoPlaylist.track.title, index: demoPlaylist.index,
      tracks: DEMO_TRACKS.length, paused: demoPlayer.paused, time: demoPlayer.currentTime } : null,
    engines: artwork.diagnostics(), compositions: artwork.sceneCount,
    paths: artwork.pathCount, worker: Boolean(builder.worker), building: isBuilding(),
    dimensions: [art.width, art.height], features: { level: features.level, bass: features.bass,
      mid: features.mid, treble: features.treble, rms: features.rms, active: features.active },
    bandMeters: { scale: [-60, 0], ...bandMeters.bands },
    changeMeter: { value: changeMeter.value, pendingPeak: changeMeter.peak },
    rawFlux: features.raw.flux,
    recording: recorder.active, recordingBusy: recorder.busy,
    recordingClock: frameClock.mode,
    clearHold: performance.now() < clearHoldUntil,
    introduction: { elapsed: artwork.entrySeconds, finished: artwork.entryFinished },
    recordedBytes: recorder.result?.blob.size || 0, recordingType: recorder.result?.type || recorder.mimeType,
    drawing: { ...artwork.stats, blank: artwork.voices.every(voice => voice.art.blank), pens: 24,
      queuedSeed: artwork.voices.find(voice => voice.art.queued)?.art.queued.seed || null, flowing: artwork.flowing },
    fps, maxTakeSeconds: MAX_TAKE_SECONDS
  })
});
const frameClock = new FrameClock(frame);
syncControls(); drawWaveform(null); generateAll(true);
frameClock.start();
