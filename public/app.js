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
    fontSize: '13px'
  },
  flowchart: {
    curve: 'basis',
    nodeSpacing: 35,
    rankSpacing: 45
  }
});

const MODELS = {
  'webllm-fast': 'SmolLM2-360M-Instruct-q4f16_1-MLC',
  'webllm-deep': 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
};

const STEP_INTERVAL_SECONDS = 15;

let mlcEngine = null;
let loadedModelId = null;
let loadingPromise = null;
let player = null;
let playerReady = false;
let currentVideoId = null;
let isStudying = false;
let isGenerating = false;
let focusSeconds = 0;
let lastCompletedStep = -1;
let currentZoom = 1;

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
        }
      }
    });
  }
}
if (window.YT && window.YT.Player) initYouTubePlayer();
else window.onYouTubeIframeAPIReady = initYouTubePlayer;

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
    mermaidContainer.innerHTML = `<div id="mermaidZoomTarget" style="transform: scale(${currentZoom}); transform-origin: top center; transition: transform 0.18s ease;">${svg}</div>`;
  } catch (err) {
    mermaidContainer.innerHTML = `<pre style="color:#52525b; font-size:0.78rem;">${code}</pre>`;
  }
}

// ============================================================================
// 4. ZOOM CONTROLS, START BUTTON & FULLSCREEN LOCK
// ============================================================================
function applyZoom() {
  const target = document.getElementById('mermaidZoomTarget');
  if (target) target.style.transform = `scale(${currentZoom})`;
  zoomResetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
}

zoomInBtn.addEventListener('click', () => {
  currentZoom = Math.min(2.0, +(currentZoom + 0.15).toFixed(2));
  applyZoom();
});

zoomOutBtn.addEventListener('click', () => {
  currentZoom = Math.max(0.5, +(currentZoom - 0.15).toFixed(2));
  applyZoom();
});

zoomResetBtn.addEventListener('click', () => {
  currentZoom = 1.0;
  applyZoom();
});

startStudyBtn.addEventListener('click', async () => {
  const url = ytUrlInput.value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) return alert('Enter a valid YouTube URL.');

  currentVideoId = videoId;
  isStudying = true;
  lastCompletedStep = -1;

  videoStartPlaceholder.classList.add('hidden');

  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen().catch(() => {});
  }

  if (player && playerReady && player.loadVideoById) {
    player.loadVideoById(videoId);
  }

  let session = await getCachedSession(videoId);
  if (!session || !session.transcript) {
    cacheBadge.textContent = 'Fetching Captions...';
    const res = await fetch(`/api/transcript?videoId=${videoId}`);
    const data = await res.json();
    if (!res.ok || !data.transcript) {
      alert(data.error || 'Subtitles unavailable for this video.');
      return;
    }
    session = await saveCachedSession(videoId, {
      title: data.title,
      transcript: data.transcript,
      steps: {}
    });
    await renderCachedVideoPills();
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
