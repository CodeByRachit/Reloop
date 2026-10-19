import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  suppressErrorRendering: true,
  themeVariables: {
    background: '#ffffff',
    primaryColor: '#ffffff',
    primaryTextColor: '#09090b',
    primaryBorderColor: '#18181b',
    lineColor: '#52525b',
    secondaryColor: '#f4f4f5',
    tertiaryColor: '#fafafa',
    fontFamily: 'Inter, -apple-system, sans-serif',
    fontSize: '14px'
  },
  flowchart: {
    useMaxWidth: false, // Prevents Mermaid from shrinking large diagrams!
    htmlLabels: true,
    curve: 'basis',
    nodeSpacing: 40,
    rankSpacing: 50
  }
});

const MODELS = {
  'webllm-fast': 'SmolLM2-360M-Instruct-q4f16_1-MLC',
  'webllm-deep': 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
};

const STEP_INTERVAL_SECONDS = 15;
const MIN_ZOOM = 0.1; // 10%
const MAX_ZOOM = 8.0; // 800%

let mlcEngine = null;
let loadedModelId = null;
let loadingPromise = null;
let player = null;
let playerReady = false;
let hasActiveVideo = false;
let currentVideoId = null;
let isStudying = false;
let isGenerating = false;
let focusSeconds = 0;
let lastCompletedStep = -1;
let isSeeking = false;
let captionsEnabled = false;

// Pan & Zoom State
let currentZoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

const localEngineSelect = document.getElementById('localEngineSelect');
const ytUrlInput = document.getElementById('ytUrlInput');
const startStudyBtn = document.getElementById('startStudyBtn');
const refreshDiagramBtn = document.getElementById('refreshDiagramBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const studyNotes = document.getElementById('studyNotes');
const mermaidContainer = document.getElementById('mermaidContainer');
const diagramStatus = document.getElementById('diagramStatus');
const lockOverlay = document.getElementById('lockOverlay');
const resumeFocusBtn = document.getElementById('resumeFocusBtn');
const cacheBadge = document.getElementById('cacheBadge');
const focusTimer = document.getElementById('focusTimer');
const videoStartPlaceholder = document.getElementById('videoStartPlaceholder');
const cachedSessionsList = document.getElementById('cachedSessionsList');
const playbackControls = document.querySelectorAll('.playback-control');
const playPauseBtn = document.getElementById('playPauseBtn');
const skipBackBtn = document.getElementById('skipBackBtn');
const skipForwardBtn = document.getElementById('skipForwardBtn');
const playbackSeek = document.getElementById('playbackSeek');
const playbackCurrentTime = document.getElementById('playbackCurrentTime');
const playbackDuration = document.getElementById('playbackDuration');
const playbackSpeed = document.getElementById('playbackSpeed');
const muteBtn = document.getElementById('muteBtn');
const playbackVolume = document.getElementById('playbackVolume');
const captionsBtn = document.getElementById('captionsBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const videoPanel = document.querySelector('.video-panel');
const playIcon = playPauseBtn.querySelector('.play-icon');
const pauseIcon = playPauseBtn.querySelector('.pause-icon');
const volumeOnIcon = muteBtn.querySelector('.volume-on-icon');
const volumeOffIcon = muteBtn.querySelector('.volume-off-icon');
const fullscreenEnterIcon = fullscreenBtn.querySelector('.fullscreen-enter-icon');
const fullscreenExitIcon = fullscreenBtn.querySelector('.fullscreen-exit-icon');

// Topbar Toggles & Side Inspector Elements
const toggleNotesBtn = document.getElementById('toggleNotesBtn');
const toggleDiagramBtn = document.getElementById('toggleDiagramBtn');
const workspaceResizer = document.getElementById('workspaceResizer');
const sideInspector = document.getElementById('sideInspector');
const inspectorTitle = document.getElementById('inspectorTitle');
const closeInspectorBtn = document.getElementById('closeInspectorBtn');
const tabContentNotes = document.getElementById('tabContentNotes');
const tabContentDiagram = document.getElementById('tabContentDiagram');

// Timestamps Elements
const timestampCountBadge = document.getElementById('timestampCountBadge');
const quickStampBtn = document.getElementById('quickStampBtn');
const quickStampTimePreview = document.getElementById('quickStampTimePreview');
const timestampForm = document.getElementById('timestampForm');
const formStampTimeTag = document.getElementById('formStampTimeTag');
const timestampTitleInput = document.getElementById('timestampTitleInput');
const addTimestampSubmitBtn = document.getElementById('addTimestampSubmitBtn');
const timestampsList = document.getElementById('timestampsList');
const emptyTimestampsHint = document.getElementById('emptyTimestampsHint');

let currentTimestamps = [];
let activeInspectorTab = 'notes';

// Video Chapters & Concept Timeline Elements
const chaptersTimelineSection = document.getElementById('chaptersTimelineSection');
const currentChapterName = document.getElementById('currentChapterName');
const chaptersCountBadge = document.getElementById('chaptersCountBadge');
const chapterTrackWrapper = document.getElementById('chapterTrackWrapper');
const chapterTrackProgress = document.getElementById('chapterTrackProgress');
const chapterMarkersContainer = document.getElementById('chapterMarkersContainer');
const chapterPillsRow = document.getElementById('chapterPillsRow');

let videoChapters = [];
let lastRenderedDuration = 0;

// ============================================================================
// 1. UNLIMITED BROWSER CACHE (IndexedDB)
// ============================================================================
const DB_NAME = 'ReloopBranchingDB_v4';
const STORE_NAME = 'study_sessions';

async function initUnlimitedCache() {
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist().catch(() => {});
  }
  await updateCacheUsageBadge();
  await renderCachedVideoPills();
}

async function updateCacheUsageBadge() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage } = await navigator.storage.estimate();
    const mb = ((usage || 0) / (1024 * 1024)).toFixed(0);
    cacheBadge.textContent = `Storage: ${mb} MB`;
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'videoId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedSession(videoId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(videoId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function getAllCachedSessions() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function saveCachedSession(videoId, data) {
  const existing = (await getCachedSession(videoId)) || { videoId };
  const updated = { ...existing, ...data, updatedAt: Date.now() };
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(updated);
    tx.oncomplete = () => {
      updateCacheUsageBadge();
      resolve(updated);
    };
  });
}

async function renderCachedVideoPills() {
  const sessions = await getAllCachedSessions();
  if (!sessions.length) {
    cachedSessionsList.innerHTML = '';
    return;
  }
  cachedSessionsList.innerHTML = sessions
    .slice(0, 4)
    .map(
      (s) =>
        `<button class="cached-pill" data-vid="${s.videoId}">Resume: ${(s.title || s.videoId).slice(0, 32)}</button>`
    )
    .join('');

  cachedSessionsList.querySelectorAll('.cached-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      ytUrlInput.value = `https://youtu.be/${btn.dataset.vid}`;
      startStudyBtn.click();
    });
  });
}

initUnlimitedCache();

localEngineSelect.value = localStorage.getItem('reloop_local_engine') || 'webllm-fast';
localEngineSelect.addEventListener('change', () => {
  localStorage.setItem('reloop_local_engine', localEngineSelect.value);
});

function extractVideoId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

function formatTime(sec) {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(safe / 60);
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function initYouTubePlayer() {
  if (window.YT && window.YT.Player) {
    player = new window.YT.Player('player', {
      height: '100%',
      width: '100%',
      playerVars: { rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          playerReady = true;
          if (currentVideoId) {
            loadStudyVideo(currentVideoId);
          }
          updatePlaybackControlAvailability();
          updatePlaybackControls();
        },
        onStateChange: () => {
          updatePlaybackSpeedOptions();
          updatePlaybackControls();
        }
      }
    });
  }
}
if (window.YT && window.YT.Player) initYouTubePlayer();
else window.onYouTubeIframeAPIReady = initYouTubePlayer;

function loadStudyVideo(videoId) {
  if (!player) return;
  if (captionsEnabled) player.unloadModule('captions');
  captionsEnabled = false;
  captionsBtn.textContent = 'CC Off';
  captionsBtn.setAttribute('aria-pressed', 'false');
  playbackSeek.value = '0';
  playbackSeek.max = '0';
  playbackCurrentTime.textContent = '0:00';
  playbackDuration.textContent = '0:00';
  player.loadVideoById(videoId);
  hasActiveVideo = true;
  updatePlaybackControlAvailability();
  updatePlaybackSpeedOptions();
}

function updatePlaybackControlAvailability() {
  const enabled = playerReady && hasActiveVideo;
  playbackControls.forEach((control) => {
    control.disabled = !enabled;
  });
}

function updatePlaybackSpeedOptions() {
  if (!player || !hasActiveVideo || typeof player.getAvailablePlaybackRates !== 'function') return;

  const availableRates = player.getAvailablePlaybackRates();
  if (!availableRates || availableRates.length === 0) return;

  const currentRate = player.getPlaybackRate();
  playbackSpeed.replaceChildren(
    ...availableRates.map((rate) => {
      const option = document.createElement('option');
      option.value = String(rate);
      option.textContent = `${rate}×`;
      return option;
    })
  );
  playbackSpeed.value = String(currentRate);
}

function updatePlaybackControls() {
  if (!player || !playerReady || !hasActiveVideo) return;

  const currentTime = player.getCurrentTime();
  const duration = player.getDuration();
  if (Number.isFinite(currentTime)) {
    playbackCurrentTime.textContent = formatTime(currentTime);
    if (quickStampTimePreview) quickStampTimePreview.textContent = formatTime(currentTime);
    if (formStampTimeTag && document.activeElement !== timestampTitleInput) {
      formStampTimeTag.textContent = formatTime(currentTime);
    }
    highlightActiveTimestamp(currentTime);
    if (!isSeeking) playbackSeek.value = String(currentTime);
  }
  if (Number.isFinite(duration) && duration > 0) {
    playbackSeek.max = String(duration);
    playbackDuration.textContent = formatTime(duration);
    if (Math.abs(duration - lastRenderedDuration) > 1 && videoChapters.length > 0) {
      lastRenderedDuration = duration;
      renderChaptersTimeline(duration);
    }
  }

  if (Number.isFinite(currentTime) && Number.isFinite(duration) && duration > 0) {
    updateChaptersProgress(currentTime, duration);
  }

  const isPlaying = player.getPlayerState() === 1;
  playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause video' : 'Play video');
  playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
  playIcon.classList.toggle('hidden', isPlaying);
  pauseIcon.classList.toggle('hidden', !isPlaying);

  const isMuted = player.isMuted();
  muteBtn.setAttribute('aria-label', isMuted ? 'Unmute video' : 'Mute video');
  muteBtn.title = isMuted ? 'Unmute' : 'Mute';
  volumeOnIcon.classList.toggle('hidden', isMuted);
  volumeOffIcon.classList.toggle('hidden', !isMuted);
  playbackVolume.value = String(isMuted ? 0 : player.getVolume());

  const currentRate = player.getPlaybackRate();
  if ([...playbackSpeed.options].some((option) => Number(option.value) === currentRate)) {
    playbackSpeed.value = String(currentRate);
  }
}

playPauseBtn.addEventListener('click', () => {
  if (!player) return;
  if (player.getPlayerState() === 1) player.pauseVideo();
  else player.playVideo();
});

skipBackBtn.addEventListener('click', () => {
  if (!player) return;
  player.seekTo(Math.max(0, player.getCurrentTime() - 10), true);
});

skipForwardBtn.addEventListener('click', () => {
  if (!player) return;
  const duration = player.getDuration();
  const target = player.getCurrentTime() + 10;
  player.seekTo(Number.isFinite(duration) && duration > 0 ? Math.min(duration, target) : target, true);
});

playbackSeek.addEventListener('input', () => {
  isSeeking = true;
  playbackCurrentTime.textContent = formatTime(Number(playbackSeek.value));
});
playbackSeek.addEventListener('change', () => {
  if (player) player.seekTo(Number(playbackSeek.value), true);
  isSeeking = false;
});

playbackSpeed.addEventListener('change', () => {
  if (player) player.setPlaybackRate(Number(playbackSpeed.value));
});

muteBtn.addEventListener('click', () => {
  if (!player) return;
  if (player.isMuted()) player.unMute();
  else player.mute();
  updatePlaybackControls();
});

playbackVolume.addEventListener('input', () => {
  if (!player) return;
  const volume = Number(playbackVolume.value);
  player.setVolume(volume);
  if (volume === 0) player.mute();
  else if (player.isMuted()) player.unMute();
  updatePlaybackControls();
});

captionsBtn.addEventListener('click', () => {
  if (!player) return;
  captionsEnabled = !captionsEnabled;
  if (captionsEnabled) player.loadModule('captions');
  else player.unloadModule('captions');
  captionsBtn.setAttribute('aria-label', captionsEnabled ? 'Turn captions off' : 'Turn captions on');
  captionsBtn.setAttribute('aria-pressed', String(captionsEnabled));
});

fullscreenBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === videoPanel) {
      await document.exitFullscreen();
    } else {
      await videoPanel.requestFullscreen();
    }
  } catch (err) {
    console.error('Unable to change video fullscreen mode:', err);
  }
});

document.addEventListener('fullscreenchange', () => {
  const isFullscreen = document.fullscreenElement === videoPanel;
  fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
  fullscreenEnterIcon.classList.toggle('hidden', isFullscreen);
  fullscreenExitIcon.classList.toggle('hidden', !isFullscreen);
});

setInterval(updatePlaybackControls, 250);

// ============================================================================
// 2. LOCAL AI ENGINE
// ============================================================================
async function ensureWebLLMLoaded(targetModelId) {
  if (mlcEngine && loadedModelId === targetModelId) return mlcEngine;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      mlcEngine = await webllm.CreateMLCEngine(targetModelId, {
        initProgressCallback: (report) => {
          const pct = Math.round((report.progress || 0) * 100);
          cacheBadge.textContent = `Model Sync: ${pct}%`;
          diagramStatus.textContent = `Initializing Local Model (${pct}%)`;
        }
      });
      loadedModelId = targetModelId;
      loadingPromise = null;
      await updateCacheUsageBadge();
      return mlcEngine;
    } catch (err) {
      loadingPromise = null;
      throw err;
    }
  })();

  return loadingPromise;
}

async function runLocalLLM(systemPrompt, userPrompt) {
  const mode = localEngineSelect.value;

  if (mode === 'ollama') {
    const res = await fetch('/api/ollama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `${systemPrompt}\n\n${userPrompt}` })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ollama offline');
    return data.response || '';
  } else {
    const modelId = MODELS[mode] || MODELS['webllm-fast'];
    const engine = await ensureWebLLMLoaded(modelId);
    const reply = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 140
    });
    return reply.choices[0]?.message?.content || '';
  }
}

// ============================================================================
// 3. PHRASE CLEANER & ARCHITECTURAL MULTI-BRANCH MERMAID BUILDER
// ============================================================================
const STOP_WORDS_END = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'as', 'by', 'at', 'from', 'that', 'which', 'who', 'how', 'why', 'where', 'when',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'into', 'about'
]);

const FILLER_PREFIXES = [
  /^in summary\b/i,
  /^the study assistant\b/i,
  /^study assistant\b/i,
  /^in the context of\b/i,
  /^today i will explain\b/i,
  /^in this video\b/i,
  /^welcome to\b/i,
  /^let us understand\b/i
];

function cleanConceptPhrase(rawText, maxWords = 5) {
  let text = (rawText || '')
    .replace(/["'`:;()\[\]{}|\\/<>]/g, ' ')
    .replace(/\b(study assistant|transcript|speaker|in summary)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const regex of FILLER_PREFIXES) {
    text = text.replace(regex, '').trim();
  }

  let words = text
    .replace(/[^a-zA-Z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);

  while (words.length > 2 && STOP_WORDS_END.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  while (words.length > 2 && STOP_WORDS_END.has(words[0].toLowerCase())) {
    words.shift();
  }

  if (words.length === 0) return 'Core Principle';
  const result = words.join(' ');
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function getStepTranscript(session, stepIndex) {
  const startSec = stepIndex * STEP_INTERVAL_SECONDS;
  const endSec = (stepIndex + 1) * STEP_INTERVAL_SECONDS;

  let lines = (session.transcript || [])
    .filter((t) => t.offset >= startSec && t.offset < endSec)
    .map((t) => t.text);

  if (lines.length === 0 && session.transcript) {
    lines = session.transcript
      .filter((t) => t.offset >= Math.max(0, startSec - 5) && t.offset <= endSec + 5)
      .map((t) => t.text);
  }

  return {
    startSec,
    endSec,
    timeRange: `${formatTime(startSec)} - ${formatTime(endSec)}`,
    spokenText: lines.join(' ').replace(/\s+/g, ' ').trim()
  };
}

async function generateMultiBranchStep(spokenText, timeRange) {
  const systemPrompt =
    'Extract key technical points directly from the text. Never mention yourself or say "study assistant". Output 2 short bullet points starting with "- ".';
  const userPrompt = `Text (${timeRange}): "${spokenText}"\n\nWrite 2 concise technical bullet points summarizing the main concept and how it works:`;

  let bullets = [];
  try {
    const raw = await runLocalLLM(systemPrompt, userPrompt);
    bullets = raw
      .split('\n')
      .map((l) => l.replace(/^[-*•#\d.]+\s*/, '').replace(/"/g, '').trim())
      .filter((l) => l.length > 10 && !/study assistant/i.test(l));
  } catch {}

  const clauses = spokenText
    .split(/[.,;?!]|(?:\band\b|\bbecause\b|\bwhich\b|\bwhere\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  const primaryNote = bullets[0] || clauses[0] || spokenText.slice(0, 90);
  const secondaryNote = bullets[1] || clauses[1] || clauses[0] || spokenText.slice(30, 110);

  const mainConcept = cleanConceptPhrase(primaryNote, 4);
  const subBranchA = cleanConceptPhrase(primaryNote.split(/\s+/).slice(3).join(' ') || clauses[0] || primaryNote, 5);
  const subBranchB = cleanConceptPhrase(secondaryNote, 5);

  return {
    noteBlock: `[${timeRange}] ${mainConcept.toUpperCase()}\n- Concept: ${primaryNote}\n- Detail: ${secondaryNote}`,
    mainConcept,
    subBranchA: subBranchA !== mainConcept ? subBranchA : cleanConceptPhrase(clauses[1] || 'Core Mechanism', 4),
    subBranchB: subBranchB !== subBranchA ? subBranchB : cleanConceptPhrase(clauses[2] || 'Key Outcome', 4)
  };
}

async function renderProgressiveUI(session, upToStepIndex) {
  const steps = session.steps || {};
  const orderedKeys = Object.keys(steps)
    .map((k) => parseInt(k, 10))
    .filter((k) => Number.isFinite(k) && k <= upToStepIndex)
    .sort((a, b) => a - b);

  if (orderedKeys.length === 0) {
    studyNotes.value = `ACTIVE LECTURE: ${session.title || 'Session'}\nNotes and concept nodes will populate every ${STEP_INTERVAL_SECONDS} seconds of playback.`;
  } else {
    studyNotes.value = orderedKeys.map((k) => steps[k].noteBlock).join('\n\n');
    studyNotes.scrollTop = studyNotes.scrollHeight;
  }

  const rootTitle = cleanConceptPhrase(session.title || 'Main Lecture Topic', 4);
  const lines = [
    'flowchart TD',
    `ROOT(["${rootTitle}"])`,
    'classDef rootStyle fill:#18181b,stroke:#18181b,stroke-width:2px,color:#ffffff,font-weight:bold;',
    'classDef conceptStyle fill:#ffffff,stroke:#18181b,stroke-width:1.5px,color:#09090b;',
    'classDef activeStyle fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#14532d;',
    'classDef detailStyle fill:#f4f4f5,stroke:#a1a1aa,stroke-width:1px,color:#3f3f46;',
    'class ROOT rootStyle;'
  ];

  const phaseGroups = {};
  orderedKeys.forEach((stepKey, idx) => {
    const phaseNum = Math.floor(idx / 3) + 1;
    if (!phaseGroups[phaseNum]) phaseGroups[phaseNum] = [];
    phaseGroups[phaseNum].push({ stepKey, idx, data: steps[stepKey] });
  });

  let prevConceptId = null;

  Object.keys(phaseGroups).forEach((phaseNum) => {
    const group = phaseGroups[phaseNum];
    const startSec = group[0].stepKey * STEP_INTERVAL_SECONDS;
    const endSec = (group[group.length - 1].stepKey + 1) * STEP_INTERVAL_SECONDS;

    lines.push(`subgraph P${phaseNum} ["Phase ${phaseNum} (${formatTime(startSec)} - ${formatTime(endSec)})"]`);
    lines.push('direction TB');

    group.forEach(({ stepKey, idx, data }) => {
      const cId = `C${idx + 1}`;
      const aId = `A${idx + 1}`;
      const bId = `B${idx + 1}`;
      const timeTag = formatTime((stepKey + 1) * STEP_INTERVAL_SECONDS);

      lines.push(`${cId}{{"${idx + 1}. ${data.mainConcept} (${timeTag})"}}`);
      lines.push(`${aId}["${data.subBranchA}"]`);
      lines.push(`${bId}(["${data.subBranchB}"])`);

      lines.push(`${cId} -->|Mechanism| ${aId}`);
      lines.push(`${cId} -->|Detail| ${bId}`);

      const isLatest = idx === orderedKeys.length - 1;
      lines.push(`class ${cId} ${isLatest ? 'activeStyle' : 'conceptStyle'};`);
      lines.push(`class ${aId},${bId} detailStyle;`);
    });

    lines.push('end');
    lines.push(`style P${phaseNum} fill:#fafafa,stroke:#e4e4e7,stroke-width:1px,color:#52525b`);

    const firstConceptInPhase = `C${group[0].idx + 1}`;
    lines.push(`ROOT ==>|Section ${phaseNum}| ${firstConceptInPhase}`);

    group.forEach(({ idx }, gIdx) => {
      const cId = `C${idx + 1}`;
      if (gIdx > 0) {
        const prevInGroup = `C${group[gIdx - 1].idx + 1}`;
        lines.push(`${prevInGroup} ==> ${cId}`);
        lines.push(`B${group[gIdx - 1].idx + 1} -.-> ${cId}`);
      } else if (prevConceptId) {
        lines.push(`${prevConceptId} -.-> ${cId}`);
      }
      prevConceptId = cId;
    });
  });

  await renderMermaid(lines.join('\n'));
}

async function processStepAtTime(currentSeconds, forceRegenerate = false) {
  if (!currentVideoId || isGenerating) return;
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;

  const session = await getCachedSession(currentVideoId);
  if (!session || !session.transcript) return;

  const completedStepIndex = forceRegenerate
    ? Math.floor(currentSeconds / STEP_INTERVAL_SECONDS)
    : Math.floor(currentSeconds / STEP_INTERVAL_SECONDS) - 1;

  if (completedStepIndex < 0) {
    diagramStatus.textContent = `Tracking 0:00 - 0:${STEP_INTERVAL_SECONDS}`;
    await renderProgressiveUI(session, -1);
    return;
  }

  const steps = session.steps || {};

  if (!forceRegenerate && steps[completedStepIndex]) {
    await renderProgressiveUI(session, completedStepIndex);
    diagramStatus.textContent = `Synced up to ${formatTime((completedStepIndex + 1) * STEP_INTERVAL_SECONDS)}`;
    return;
  }

  const { timeRange, spokenText } = getStepTranscript(session, completedStepIndex);
  if (!spokenText || spokenText.length < 10) return;

  try {
    isGenerating = true;
    diagramStatus.textContent = `Indexing ${timeRange}...`;

    const newStepData = await generateMultiBranchStep(spokenText, timeRange);
    steps[completedStepIndex] = newStepData;

    const updatedSession = await saveCachedSession(currentVideoId, { steps });
    await renderProgressiveUI(updatedSession, completedStepIndex);

    diagramStatus.textContent = `Updated (${timeRange})`;
  } finally {
    isGenerating = false;
  }
}

async function renderMermaid(code) {
  try {
    mermaidContainer.innerHTML = '';
    const id = 'mermaidSvg_' + Date.now();
    const { svg } = await mermaid.render(id, code);
    mermaidContainer.innerHTML = `<div id="mermaidZoomTarget">${svg}</div>`;

    // Strip any inline max-width so the SVG stays crisp and full-sized
    const svgEl = mermaidContainer.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = 'none';
      const viewBox = svgEl.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.split(/\s+|,/).map(Number);
        if (parts.length === 4 && parts[2] > 0) {
          svgEl.style.width = `${Math.max(parts[2], 520)}px`;
        }
      }
    }

    applyZoomAndPan();
  } catch (err) {
    mermaidContainer.innerHTML = `<pre style="color:#52525b; font-size:0.78rem;">${code}</pre>`;
  }
}

// ============================================================================
// 4. HIGH-RANGE ZOOM (10% TO 800%) + DRAG-TO-PAN + WHEEL ZOOM
// ============================================================================
function applyZoomAndPan() {
  const target = document.getElementById('mermaidZoomTarget');
  if (target) {
    target.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
  }
  zoomResetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
}

function setZoom(newZoom) {
  currentZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +newZoom.toFixed(2)));
  applyZoomAndPan();
}

zoomInBtn.addEventListener('click', () => {
  const step = currentZoom >= 2.0 ? 0.5 : 0.25;
  setZoom(currentZoom + step);
});

zoomOutBtn.addEventListener('click', () => {
  const step = currentZoom > 2.0 ? 0.5 : 0.2;
  setZoom(currentZoom - step);
});

zoomResetBtn.addEventListener('click', () => {
  currentZoom = 1.0;
  panX = 0;
  panY = 0;
  applyZoomAndPan();
});

// Mouse Wheel / Trackpad Pinch Zoom inside Mermaid Canvas (up to 800%)
mermaidContainer.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(currentZoom * zoomFactor);
  },
  { passive: false }
);

// Click-and-Drag Panning inside Mermaid Canvas
mermaidContainer.addEventListener('mousedown', (e) => {
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
  mermaidContainer.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  applyZoomAndPan();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  mermaidContainer.classList.remove('dragging');
});

// ============================================================================
// 5. START BUTTON, CONTINUOUS WATCH LOOP & FULLSCREEN LOCK
// ============================================================================
startStudyBtn.addEventListener('click', async () => {
  const url = ytUrlInput.value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) return alert('Enter a valid YouTube URL.');

  currentVideoId = videoId;
  hasActiveVideo = false;
  updatePlaybackControlAvailability();
  isStudying = true;
  lastCompletedStep = -1;

  videoStartPlaceholder.classList.add('hidden');

  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen().catch(() => {});
  }

  if (player && playerReady && player.loadVideoById) {
    loadStudyVideo(videoId);
  }

  let session = await getCachedSession(videoId);
  if (!session || !session.transcript || typeof session.description !== 'string' || session.description.length === 0) {
    cacheBadge.textContent = 'Fetching Details...';
    const res = await fetch(`/api/transcript?videoId=${videoId}`);
    const data = await res.json();
    if (!res.ok || !data.transcript) {
      alert(data.error || 'Subtitles unavailable for this video.');
      return;
    }
    session = await saveCachedSession(videoId, {
      title: data.title,
      description: data.description || '',
      transcript: data.transcript,
      steps: session?.steps || {},
      timestamps: session?.timestamps || []
    });
    await renderCachedVideoPills();
  }

  currentTimestamps = session.timestamps || [];
  renderTimestampsList();

  videoChapters = extractChaptersFromSession(session);
  const dur = player && typeof player.getDuration === 'function' ? player.getDuration() : 0;
  if (dur > 0) {
    lastRenderedDuration = dur;
    renderChaptersTimeline(dur);
  }

  await renderProgressiveUI(session, -1);
  diagramStatus.textContent = `Awaiting segment 0:00 - 0:${STEP_INTERVAL_SECONDS}`;

  const mode = localEngineSelect.value;
  if (mode !== 'ollama') {
    ensureWebLLMLoaded(MODELS[mode] || MODELS['webllm-fast']).catch(() => {});
  }
});

refreshDiagramBtn.addEventListener('click', async () => {
  if (!currentVideoId || !player || typeof player.getCurrentTime !== 'function') return;
  const currentSec = player.getCurrentTime();
  if (Number.isFinite(currentSec)) {
    await processStepAtTime(currentSec, true);
  }
});

setInterval(() => {
  if (!isStudying || !player || typeof player.getCurrentTime !== 'function') return;

  if (player.getPlayerState && player.getPlayerState() === 1) {
    focusSeconds += 1;
    const mins = String(Math.floor(focusSeconds / 60)).padStart(2, '0');
    const secs = String(focusSeconds % 60).padStart(2, '0');
    focusTimer.textContent = `${mins}:${secs}`;

    const currentSec = player.getCurrentTime();
    if (!Number.isFinite(currentSec) || currentSec < 0) return;

    const completedStep = Math.floor(currentSec / STEP_INTERVAL_SECONDS) - 1;
    const nextStepSec = (completedStep + 2) * STEP_INTERVAL_SECONDS;
    const secsRemaining = Math.max(0, Math.ceil(nextStepSec - currentSec));

    if (!isGenerating && completedStep < 0) {
      diagramStatus.textContent = `Next index in ${secsRemaining}s`;
    }

    if (completedStep >= 0 && completedStep !== lastCompletedStep && !isGenerating) {
      lastCompletedStep = completedStep;
      processStepAtTime(currentSec, false);
    }
  }
}, 1000);

function triggerFocusInterrupt(reason) {
  if (!isStudying) return;
  if (player && player.pauseVideo) player.pauseVideo();
  document.getElementById('motivationText').textContent = `${reason} Return to fullscreen to continue your active study session.`;
  lockOverlay.classList.remove('hidden');
}

document.addEventListener('fullscreenchange', () => {
  if (isStudying && !document.fullscreenElement) triggerFocusInterrupt('Fullscreen mode was exited.');
});

document.addEventListener('visibilitychange', () => {
  if (isStudying && document.hidden) triggerFocusInterrupt('Active tab lost focus.');
});

resumeFocusBtn.addEventListener('click', async () => {
  await document.documentElement.requestFullscreen().catch(() => {});
  lockOverlay.classList.add('hidden');
  if (player && player.playVideo) player.playVideo();
});

// ============================================================================
// 6. TIMESTAMPS CREATION & MANAGEMENT
// ============================================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTimestampsList() {
  if (!timestampsList) return;
  const count = currentTimestamps.length;
  if (timestampCountBadge) {
    timestampCountBadge.textContent = `${count} saved`;
  }

  if (count === 0) {
    timestampsList.innerHTML = `
      <div class="empty-timestamps-hint" id="emptyTimestampsHint">
        No timestamps added yet. Click <strong>+ Mark at 0:00</strong> or press <strong>T</strong> while watching to bookmark moments.
      </div>
    `;
    return;
  }

  timestampsList.innerHTML = currentTimestamps
    .map(
      (stamp) => `
      <div class="timestamp-item" data-id="${stamp.id}" data-time="${stamp.time}">
        <div class="timestamp-item-left">
          <span class="timestamp-badge">${formatTime(stamp.time)}</span>
          <span class="timestamp-text" title="${escapeHtml(stamp.title)}">${escapeHtml(stamp.title)}</span>
        </div>
        <button class="timestamp-delete-btn" type="button" title="Delete timestamp" data-delete-id="${stamp.id}">✕</button>
      </div>
    `
    )
    .join('');

  timestampsList.querySelectorAll('.timestamp-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.timestamp-delete-btn')) return;
      const targetTime = Number(item.dataset.time);
      if (Number.isFinite(targetTime) && player && typeof player.seekTo === 'function') {
        player.seekTo(targetTime, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    });
  });

  timestampsList.querySelectorAll('.timestamp-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idToDelete = btn.dataset.deleteId;
      currentTimestamps = currentTimestamps.filter((s) => s.id !== idToDelete);
      renderTimestampsList();
      if (currentVideoId) {
        await saveCachedSession(currentVideoId, { timestamps: currentTimestamps });
      }
    });
  });
}

async function addTimestamp(sec, title = '') {
  if (!Number.isFinite(sec) || sec < 0) return;
  const safeSec = Math.floor(sec);
  const safeTitle = (title || '').trim() || `Key Moment (${formatTime(safeSec)})`;

  const newStamp = {
    id: `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: safeSec,
    title: safeTitle,
    createdAt: Date.now()
  };

  currentTimestamps.push(newStamp);
  currentTimestamps.sort((a, b) => a.time - b.time);
  renderTimestampsList();

  if (currentVideoId) {
    await saveCachedSession(currentVideoId, { timestamps: currentTimestamps });
  }
}

function highlightActiveTimestamp(curSec) {
  if (!timestampsList || currentTimestamps.length === 0) return;
  let activeStamp = null;
  for (let i = currentTimestamps.length - 1; i >= 0; i--) {
    if (currentTimestamps[i].time <= curSec) {
      activeStamp = currentTimestamps[i];
      break;
    }
  }

  timestampsList.querySelectorAll('.timestamp-item').forEach((item) => {
    const isThisActive = activeStamp && item.dataset.id === activeStamp.id;
    item.classList.toggle('active', !!isThisActive);
  });
}

function initTimestamps() {
  if (quickStampBtn) {
    quickStampBtn.addEventListener('click', () => {
      const curTime = player && typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      if (formStampTimeTag) formStampTimeTag.textContent = formatTime(curTime);
      if (timestampTitleInput) timestampTitleInput.focus();
    });
  }

  if (timestampForm) {
    timestampForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const curTime = player && typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      const note = timestampTitleInput ? timestampTitleInput.value : '';
      addTimestamp(curTime, note);
      if (timestampTitleInput) timestampTitleInput.value = '';
    });
  }

  // Keyboard shortcut 'T' to quickly mark moment
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }
      if (player && typeof player.getCurrentTime === 'function') {
        const curTime = player.getCurrentTime();
        if (Number.isFinite(curTime)) {
          addTimestamp(curTime, '');
        }
      }
    }
  });

  renderTimestampsList();
}

// ============================================================================
// 7. RESIZABLE WORKSPACE & SIDE INSPECTOR TABS
// ============================================================================
// ============================================================================
// 7. RESIZABLE WORKSPACE & SIDE INSPECTOR TABS
// ============================================================================
function initResizableWorkspace() {
  if (!sideInspector) return;

  const savedWidth = localStorage.getItem('reloop_side_width');
  if (savedWidth) {
    const w = Math.max(280, Math.min(window.innerWidth * 0.7, parseInt(savedWidth, 10)));
    sideInspector.style.width = `${w}px`;
    sideInspector.style.setProperty('--side-panel-width', `${w}px`);
  }

  // Keep sidebar and resizer strictly collapsed by default initially
  sideInspector.classList.add('collapsed');
  if (workspaceResizer) workspaceResizer.classList.add('collapsed');
  if (toggleNotesBtn) toggleNotesBtn.classList.remove('active');
  if (toggleDiagramBtn) toggleDiagramBtn.classList.remove('active');

  function openInspector(tab = 'notes') {
    activeInspectorTab = tab;
    sideInspector.classList.remove('collapsed');
    if (workspaceResizer) workspaceResizer.classList.remove('collapsed');

    if (inspectorTitle) {
      inspectorTitle.textContent = tab === 'diagram' ? 'Concept Architecture' : 'Lecture Notes';
    }
    if (tabContentNotes) tabContentNotes.classList.toggle('active', tab === 'notes');
    if (tabContentDiagram) tabContentDiagram.classList.toggle('active', tab === 'diagram');

    if (toggleNotesBtn) toggleNotesBtn.classList.toggle('active', tab === 'notes');
    if (toggleDiagramBtn) toggleDiagramBtn.classList.toggle('active', tab === 'diagram');

    if (tab === 'diagram') {
      setTimeout(applyZoomAndPan, 60);
    }
  }

  function closeInspector() {
    sideInspector.classList.add('collapsed');
    if (workspaceResizer) workspaceResizer.classList.add('collapsed');
    if (toggleNotesBtn) toggleNotesBtn.classList.remove('active');
    if (toggleDiagramBtn) toggleDiagramBtn.classList.remove('active');
  }

  function toggleInspector(tab) {
    if (!sideInspector.classList.contains('collapsed') && activeInspectorTab === tab) {
      closeInspector();
    } else {
      openInspector(tab);
    }
  }

  if (toggleNotesBtn) toggleNotesBtn.addEventListener('click', () => toggleInspector('notes'));
  if (toggleDiagramBtn) toggleDiagramBtn.addEventListener('click', () => toggleInspector('diagram'));
  if (closeInspectorBtn) closeInspectorBtn.addEventListener('click', () => closeInspector());

  // Draggable splitter / resizer handle
  if (workspaceResizer) {
    let isResizing = false;

    workspaceResizer.addEventListener('pointerdown', (e) => {
      isResizing = true;
      sideInspector.classList.add('is-dragging');
      workspaceResizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      workspaceResizer.setPointerCapture(e.pointerId);
    });

    window.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      const container = document.getElementById('workspaceContainer');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = Math.max(280, Math.min(containerRect.width * 0.75, containerRect.right - e.clientX));
      sideInspector.style.width = `${newWidth}px`;
      sideInspector.style.setProperty('--side-panel-width', `${newWidth}px`);
    });

    window.addEventListener('pointerup', () => {
      if (!isResizing) return;
      isResizing = false;
      sideInspector.classList.remove('is-dragging');
      workspaceResizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const currentW = parseInt(sideInspector.style.width, 10);
      if (currentW > 0) {
        localStorage.setItem('reloop_side_width', currentW);
      }
    });

    workspaceResizer.addEventListener('dblclick', () => {
      const defaultW = 440;
      sideInspector.style.width = `${defaultW}px`;
      sideInspector.style.setProperty('--side-panel-width', `${defaultW}px`);
      localStorage.setItem('reloop_side_width', defaultW);
    });
  }
}

// Initialize workspace and timestamps
initTimestamps();
initResizableWorkspace();

// ============================================================================
// 8. KEY TOPICS & CHAPTERS TIMELINE (Straight line with concept points)
// ============================================================================
function extractChaptersFromSession(session) {
  const chapters = [];
  const desc = session.description || '';

  // 1. Try to find chapters with timestamps in description
  // e.g. "0:00 - 4:32 ~ Hamare Saath Shri Raghunath" or "00:00 - Intro"
  const lines = desc.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\s*[-–—~to]+\s*(?:(?:\d{1,2}):)?\d{1,2}:\d{2})?\s*[-–—~|•:\s]+(.+)$/i);
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const totalSec = hours * 3600 + minutes * 60 + seconds;
      let label = match[4].replace(/^[-–—~|•:\s]+/, '').trim();
      label = label.replace(/[-–—~|•:\s]+$/, '').trim();
      if (label.length > 1 && !chapters.some((c) => Math.abs(c.time - totalSec) < 3)) {
        chapters.push({ time: totalSec, title: label });
      }
    }
  }

  // If description had valid chapters (at least 2), sort and return them
  if (chapters.length >= 2) {
    chapters.sort((a, b) => a.time - b.time);
    return chapters;
  }

  // 2. If NO chapters in description:
  // ONLY create relevant milestones (at most 3 to 5 key moments, not too many unnecessary timestamps)
  const transcript = session.transcript || [];
  if (transcript.length > 0) {
    const lastItem = transcript[transcript.length - 1];
    const totalDuration = lastItem.offset + (lastItem.duration || 10);
    const partsCount = totalDuration > 1200 ? 4 : (totalDuration > 300 ? 3 : 2);
    const stepDuration = Math.floor(totalDuration / partsCount);

    chapters.push({ time: 0, title: 'Introduction' });
    for (let p = 1; p < partsCount; p++) {
      const targetTime = p * stepDuration;
      const nearestLine = transcript.find((l) => l.offset >= targetTime);
      const actualTime = nearestLine ? Math.floor(nearestLine.offset) : targetTime;
      const rawText = nearestLine ? (nearestLine.text || '').replace(/\[.*?\]|\(.*?\)/g, '').trim() : '';
      const words = rawText.split(/\s+/).filter((w) => w.length > 2);
      const topicSnippet = words.slice(0, 4).join(' ');
      const cleanSnippet = topicSnippet.length > 3 ? cleanConceptPhrase(topicSnippet, 4) : `Part ${p + 1}`;
      chapters.push({
        time: actualTime,
        title: cleanSnippet.charAt(0).toUpperCase() + cleanSnippet.slice(1)
      });
    }
  } else {
    chapters.push({ time: 0, title: 'Introduction' });
  }

  chapters.sort((a, b) => a.time - b.time);
  return chapters;
}

function renderChaptersTimeline(duration) {
  if (!chapterMarkersContainer || !chapterPillsRow) return;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;

  if (chaptersCountBadge) {
    chaptersCountBadge.textContent = `${videoChapters.length} ${videoChapters.length === 1 ? 'topic' : 'topics'}`;
  }

  // Render Marker Points along the straight line
  chapterMarkersContainer.innerHTML = videoChapters
    .map((chapter, index) => {
      const leftPct = Math.min(99.5, Math.max(0.5, (chapter.time / safeDuration) * 100));
      return `
        <div class="chapter-marker-point"
             data-index="${index}"
             data-time="${chapter.time}"
             data-tooltip="${formatTime(chapter.time)} - ${escapeHtml(chapter.title)}"
             style="left: ${leftPct.toFixed(2)}%;">
        </div>
      `;
    })
    .join('');

  // Render Horizontal Pills beneath the line
  chapterPillsRow.innerHTML = videoChapters
    .map(
      (chapter, index) => `
      <button class="chapter-pill" type="button" data-index="${index}" data-time="${chapter.time}">
        <span class="chapter-pill-time">${formatTime(chapter.time)}</span>
        <span class="chapter-pill-title">${escapeHtml(chapter.title)}</span>
      </button>
    `
    )
    .join('');

  // Add click listeners to markers
  chapterMarkersContainer.querySelectorAll('.chapter-marker-point').forEach((point) => {
    point.addEventListener('click', (e) => {
      e.stopPropagation();
      const time = Number(point.dataset.time);
      if (Number.isFinite(time) && player && typeof player.seekTo === 'function') {
        player.seekTo(time, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    });
  });

  // Add click listeners to pills
  chapterPillsRow.querySelectorAll('.chapter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const time = Number(pill.dataset.time);
      if (Number.isFinite(time) && player && typeof player.seekTo === 'function') {
        player.seekTo(time, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    });
  });
}

function updateChaptersProgress(currentTime, duration) {
  if (!chapterTrackProgress || !Number.isFinite(duration) || duration <= 0) return;
  const progressPct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
  chapterTrackProgress.style.width = `${progressPct}%`;

  if (videoChapters.length === 0) return;

  // Find active chapter index
  let activeIndex = 0;
  for (let i = videoChapters.length - 1; i >= 0; i--) {
    if (videoChapters[i].time <= currentTime) {
      activeIndex = i;
      break;
    }
  }

  const activeChapter = videoChapters[activeIndex];
  if (currentChapterName && activeChapter) {
    currentChapterName.textContent = `${formatTime(activeChapter.time)} — ${activeChapter.title}`;
  }

  // Update points styling
  if (chapterMarkersContainer) {
    chapterMarkersContainer.querySelectorAll('.chapter-marker-point').forEach((point) => {
      const pTime = Number(point.dataset.time);
      const isPassed = pTime <= currentTime;
      const isActive = Number(point.dataset.index) === activeIndex;
      point.classList.toggle('passed', isPassed);
      point.classList.toggle('active', isActive);
    });
  }

  // Update pills styling
  if (chapterPillsRow) {
    chapterPillsRow.querySelectorAll('.chapter-pill').forEach((pill) => {
      const isActive = Number(pill.dataset.index) === activeIndex;
      pill.classList.toggle('active', isActive);
    });
  }
}

// Track click on the straight line track to seek proportionally
if (chapterTrackWrapper) {
  chapterTrackWrapper.addEventListener('click', (e) => {
    if (e.target.closest('.chapter-marker-point')) return;
    const rect = chapterTrackWrapper.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    if (player && typeof player.getDuration === 'function') {
      const dur = player.getDuration();
      if (Number.isFinite(dur) && dur > 0) {
        player.seekTo(dur * pct, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    }
  });
}


