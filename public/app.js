import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import {
  extractYouTubeVideoId,
  isYouTubeVideoId,
  normalizeYouTubeUrl,
} from "./youtube.js";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  suppressErrorRendering: true,
  themeVariables: {
    background: "#111113",
    primaryColor: "#18181b",
    primaryTextColor: "#f4f4f5",
    primaryBorderColor: "#3f3f46",
    lineColor: "#a1a1aa",
    secondaryColor: "#1f1f23",
    tertiaryColor: "#27272a",
    fontFamily: "Inter, -apple-system, sans-serif",
    fontSize: "14px",
  },
  flowchart: {
    useMaxWidth: false, // Prevents Mermaid from shrinking large diagrams!
    htmlLabels: true,
    curve: "basis",
    nodeSpacing: 40,
    rankSpacing: 50,
  },
});

const MODELS = {
  "webllm-fast": "SmolLM2-360M-Instruct-q4f16_1-MLC",
  "webllm-deep": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
};

const STEP_INTERVAL_SECONDS = 15;
const NOTE_GENERATION_VERSION = 19;
const CLASSIFICATION_VERSION = 6;
const NON_EDUCATIONAL_MESSAGE =
  "This does not appear to be an educational video. Notes are unavailable for this content.";
const MIN_ZOOM = 0.1; // 10%
const MAX_ZOOM = 8.0; // 800%

let mlcEngine = null;
let loadedModelId = null;
let loadingPromise = null;
let player = null;
let playerReady = false;
let hasActiveVideo = false;
let currentVideoId = null;
let currentVideoTitle = "";
let isStudying = false;
let isGenerating = false;
let focusSeconds = 0;
let lastCompletedStep = -1;
let userEngagedInFullscreen = false; // Guard: Page load par popup aane se rokega
let pendingStartTime = 0;
let lastSavedSec = -1;
let lastSaveTime = 0;

// Pan & Zoom State
let currentZoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

const localEngineSelect = document.getElementById("localEngineSelect");
const ytUrlInput = document.getElementById("ytUrlInput");
const startStudyBtn = document.getElementById("startStudyBtn");
const refreshDiagramBtn = document.getElementById("refreshDiagramBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const studyNotes = document.getElementById("studyNotes");
const mermaidContainer = document.getElementById("mermaidContainer");
const diagramStatus = document.getElementById("diagramStatus");
const lockOverlay = document.getElementById("lockOverlay");
const resumeFocusBtn = document.getElementById("resumeFocusBtn");
const cacheBadge = document.getElementById("cacheBadge");
const focusTimer = document.getElementById("focusTimer");
const videoStartPlaceholder = document.getElementById("videoStartPlaceholder");
const cachedSessionsList = document.getElementById("cachedSessionsList");

// Video Playback Controls
const playbackControls = document.querySelectorAll(".playback-control");

const playPauseBtn = document.getElementById("playPauseBtn");
const skipBackBtn = document.getElementById("skipBackBtn");
const skipForwardBtn = document.getElementById("skipForwardBtn");

const playbackSeek = document.getElementById("playbackSeek");
const playbackCurrentTime = document.getElementById("playbackCurrentTime");
const playbackDuration = document.getElementById("playbackDuration");

const playbackSpeed = document.getElementById("playbackSpeed");
const muteBtn = document.getElementById("muteBtn");
const playbackVolume = document.getElementById("playbackVolume");

const captionsBtn = document.getElementById("captionsBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

const videoPanel = document.querySelector(".video-panel");

const playIcon = playPauseBtn.querySelector(".play-icon");
const pauseIcon = playPauseBtn.querySelector(".pause-icon");

const volumeOnIcon = muteBtn.querySelector(".volume-on-icon");
const volumeOffIcon = muteBtn.querySelector(".volume-off-icon");

const fullscreenEnterIcon = fullscreenBtn.querySelector(
  ".fullscreen-enter-icon",
);
const fullscreenExitIcon = fullscreenBtn.querySelector(".fullscreen-exit-icon");

let isSeeking = false;
let captionsEnabled = false;

async function navigateHome(e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  try {
    syncActiveTabSession();
    await savePlaybackState(true);
  } catch {}
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.error("Unable to exit fullscreen before opening home:", error);
    }
  }
  window.location.assign("/");
}

const brandHomeLink = document.querySelector(".brand-link");
if (brandHomeLink) brandHomeLink.addEventListener("click", navigateHome);

// Topbar Toggles & Side Inspector Elements
const toggleNotesBtn = document.getElementById("toggleNotesBtn");
const toggleDiagramBtn = document.getElementById("toggleDiagramBtn");
const workspaceResizer = document.getElementById("workspaceResizer");
const inspectorSectionResizer = document.getElementById(
  "inspectorSectionResizer",
);
const sideInspector = document.getElementById("sideInspector");
const inspectorTitle = document.getElementById("inspectorTitle");
const closeInspectorBtn = document.getElementById("closeInspectorBtn");
const tabContentNotes = document.getElementById("tabContentNotes");
const tabContentDiagram = document.getElementById("tabContentDiagram");

// Timestamps Elements
const timestampCountBadge = document.getElementById("timestampCountBadge");
const timestampForm = document.getElementById("timestampForm");
const formStampTimeTag = document.getElementById("formStampTimeTag");
const timestampTitleInput = document.getElementById("timestampTitleInput");
const addTimestampSubmitBtn = document.getElementById("addTimestampSubmitBtn");
const timestampsList = document.getElementById("timestampsList");
const emptyTimestampsHint = document.getElementById("emptyTimestampsHint");

let currentTimestamps = [];
let activeInspectorTab = "notes";

// Video Chapters & Concept Timeline Elements
const chaptersTimelineSection = document.getElementById(
  "chaptersTimelineSection",
);
const currentChapterName = document.getElementById("currentChapterName");
const chaptersCountBadge = document.getElementById("chaptersCountBadge");
const chapterTrackWrapper = document.getElementById("chapterTrackWrapper");
const chapterTrackProgress = document.getElementById("chapterTrackProgress");
const chapterMarkersContainer = document.getElementById(
  "chapterMarkersContainer",
);
const chapterPillsRow = document.getElementById("chapterPillsRow");

let videoChapters = [];
let lastRenderedDuration = 0;


// 1. UNLIMITED BROWSER CACHE (IndexedDB)

const DB_NAME = "ReloopBranchingDB_v5";
const STORE_NAME = "study_sessions";

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
        db.createObjectStore(STORE_NAME, { keyPath: "videoId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedSession(videoId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(videoId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function getAllCachedSessions() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
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
    const tx = db.transaction(STORE_NAME, "readwrite");
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
    cachedSessionsList.innerHTML = "";
    return;
  }
  cachedSessionsList.innerHTML = sessions
    .slice(0, 4)
    .map(
      (s) =>
        `<button class="cached-pill" data-vid="${s.videoId}">Resume: ${(s.title || s.videoId).slice(0, 32)}</button>`,
    )
    .join("");

  cachedSessionsList.querySelectorAll(".cached-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      ytUrlInput.value = `https://youtu.be/${btn.dataset.vid}`;
      startStudyBtn.click();
    });
  });
}

initUnlimitedCache();

localEngineSelect.value =
  localStorage.getItem("reloop_local_engine") || "webllm-fast";
localEngineSelect.addEventListener("change", () => {
  localStorage.setItem("reloop_local_engine", localEngineSelect.value);
});

function extractVideoId(url) {
  return extractYouTubeVideoId(url);
}

function isPageReload() {
  const nav = performance.getEntriesByType("navigation");
  if (nav && nav.length > 0) {
    return nav[0].type === "reload";
  }
  return performance.navigation && performance.navigation.type === 1;
}

function formatTime(sec) {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(safe / 60);
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function syncActiveTabSession() {
  if (!currentVideoId) return;
  const cur =
    player && typeof player.getCurrentTime === "function"
      ? player.getCurrentTime()
      : 0;
  const safeTime = Number.isFinite(cur) ? Math.floor(cur) : 0;
  try {
    sessionStorage.setItem(
      "reloop_active_tab_video",
      JSON.stringify({
        videoId: currentVideoId,
        lastTime: safeTime,
        title: currentVideoTitle || currentVideoId,
      }),
    );
  } catch {}
}

async function savePlaybackState(force = false) {
  if (!currentVideoId || !player || typeof player.getCurrentTime !== "function")
    return;
  const currentSec = player.getCurrentTime();
  if (!Number.isFinite(currentSec) || currentSec < 0) return;

  // Always update sessionStorage synchronously first so pagehide/beforeunload never miss it
  syncActiveTabSession();

  const now = Date.now();
  if (
    force ||
    (now - lastSaveTime >= 2000 && Math.abs(currentSec - lastSavedSec) >= 1)
  ) {
    lastSavedSec = currentSec;
    lastSaveTime = now;
    await saveCachedSession(currentVideoId, {
      lastTime: Math.floor(currentSec),
      focusSeconds: focusSeconds,
    }).catch(() => {});
  }
}

window.addEventListener("pagehide", () => {
  syncActiveTabSession();
  savePlaybackState(true);
});
window.addEventListener("beforeunload", () => {
  syncActiveTabSession();
  savePlaybackState(true);
});

function initYouTubePlayer() {
  if (window.YT && window.YT.Player) {
    player = new window.YT.Player("player", {
      height: "100%",
      width: "100%",
      playerVars: { controls: 1, fs: 1, cc_load_policy: 0, rel: 0 },
      events: {
        onReady: () => {
          playerReady = true;
          if (currentVideoId) {
            loadStudyVideo(
              currentVideoId,
              pendingStartTime,
              pendingStartTime > 0,
            );
          }
          updatePlaybackProgress();
          updatePlaybackControlAvailability();
          updatePlaybackControls();
        },
        onStateChange: (event) => {
          updatePlaybackProgress();
          updatePlaybackSpeedOptions();
          updatePlaybackControls();
          if (
            pendingStartTime > 0 &&
            (event.data === 1 || event.data === 5 || event.data === 2)
          ) {
            const target = pendingStartTime;
            if (player && typeof player.seekTo === "function") {
              player.seekTo(target, true);
            }
            if (lockOverlay && !lockOverlay.classList.contains("hidden")) {
              if (player && typeof player.pauseVideo === "function") {
                player.pauseVideo();
              }
            } else {
              pendingStartTime = 0;
            }
          } else if (
            lockOverlay &&
            !lockOverlay.classList.contains("hidden") &&
            event.data === 1
          ) {
            if (player && typeof player.pauseVideo === "function") {
              player.pauseVideo();
            }
          }
          if (event && (event.data === 2 || event.data === 0)) {
            savePlaybackState(true);
          }
        },
      },
    });
  }
}
if (window.YT && window.YT.Player) initYouTubePlayer();
else window.onYouTubeIframeAPIReady = initYouTubePlayer;

function loadStudyVideo(videoId, startSeconds = 0, shouldPause = false) {
  if (!player) return;
  const startAt =
    startSeconds > 0
      ? startSeconds
      : pendingStartTime > 0
        ? pendingStartTime
        : 0;
  if (startAt > 0) {
    if (shouldPause && typeof player.cueVideoById === "function") {
      player.cueVideoById({ videoId, startSeconds: startAt });
    } else if (typeof player.loadVideoById === "function") {
      player.loadVideoById({ videoId, startSeconds: startAt });
      if (shouldPause && typeof player.pauseVideo === "function") {
        player.pauseVideo();
      }
    }
  } else if (typeof player.loadVideoById === "function") {
    player.loadVideoById(videoId);
  }
  hasActiveVideo = true;

  updatePlaybackControlAvailability();
  updatePlaybackSpeedOptions();
  updatePlaybackControls();

  updatePlaybackProgress();
}

function updatePlaybackProgress() {
  if (!player || !playerReady || !hasActiveVideo) return;
  updatePlaybackControls();

  const currentTime = player.getCurrentTime();
  const duration = player.getDuration();
  if (Number.isFinite(currentTime)) {
    if (formStampTimeTag && document.activeElement !== timestampTitleInput) {
      formStampTimeTag.textContent = formatTime(currentTime);
    }
    highlightActiveTimestamp(currentTime);
  }
  if (Number.isFinite(duration) && duration > 0) {
    if (
      Math.abs(duration - lastRenderedDuration) > 1 &&
      videoChapters.length > 0
    ) {
      lastRenderedDuration = duration;
      renderChaptersTimeline(duration);
    }
  }

  if (
    Number.isFinite(currentTime) &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    updateChaptersProgress(currentTime, duration);
  }
}
setInterval(updatePlaybackProgress, 250);

function updatePlaybackControlAvailability() {
  const enabled = playerReady && hasActiveVideo;

  playbackControls.forEach((control) => {
    control.disabled = !enabled;
  });
}

function updatePlaybackSpeedOptions() {
  if (
    !player ||
    !hasActiveVideo ||
    typeof player.getAvailablePlaybackRates !== "function"
  )
    return;

  const availableRates = player.getAvailablePlaybackRates();

  if (!availableRates || availableRates.length === 0) return;

  const currentRate = player.getPlaybackRate();

  playbackSpeed.replaceChildren(
    ...availableRates.map((rate) => {
      const option = document.createElement("option");

      option.value = String(rate);
      option.textContent = `${rate}×`;

      return option;
    }),
  );

  playbackSpeed.value = String(currentRate);
}

function updatePlaybackControls() {
  if (!player || !playerReady || !hasActiveVideo) return;

  const currentTime = player.getCurrentTime();
  const duration = player.getDuration();

  if (Number.isFinite(currentTime)) {
    playbackCurrentTime.textContent = formatTime(currentTime);

    if (!isSeeking) {
      playbackSeek.value = String(currentTime);
    }
  }

  if (Number.isFinite(duration) && duration > 0) {
    playbackSeek.max = String(duration);
    playbackDuration.textContent = formatTime(duration);
  }

  const isPlaying = player.getPlayerState() === 1;

  playPauseBtn.setAttribute(
    "aria-label",
    isPlaying ? "Pause video" : "Play video",
  );

  playPauseBtn.title = isPlaying ? "Pause" : "Play";

  playIcon.classList.toggle("hidden", isPlaying);
  pauseIcon.classList.toggle("hidden", !isPlaying);

  const isMuted = player.isMuted();

  muteBtn.setAttribute("aria-label", isMuted ? "Unmute video" : "Mute video");

  muteBtn.title = isMuted ? "Unmute" : "Mute";

  volumeOnIcon.classList.toggle("hidden", isMuted);
  volumeOffIcon.classList.toggle("hidden", !isMuted);

  playbackVolume.value = String(isMuted ? 0 : player.getVolume());

  const currentRate = player.getPlaybackRate();

  if (
    [...playbackSpeed.options].some(
      (option) => Number(option.value) === currentRate,
    )
  ) {
    playbackSpeed.value = String(currentRate);
  }
}

// PLAY / PAUSE

playPauseBtn.addEventListener("click", () => {
  if (!player) return;

  if (player.getPlayerState() === 1) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

// SKIP BACKWARD

skipBackBtn.addEventListener("click", () => {
  if (!player) return;

  player.seekTo(Math.max(0, player.getCurrentTime() - 10), true);
});

// SKIP FORWARD

skipForwardBtn.addEventListener("click", () => {
  if (!player) return;

  const duration = player.getDuration();
  const target = player.getCurrentTime() + 10;

  player.seekTo(
    Number.isFinite(duration) && duration > 0
      ? Math.min(duration, target)
      : target,
    true,
  );
});

// VIDEO SEEKING

playbackSeek.addEventListener("input", () => {
  isSeeking = true;

  playbackCurrentTime.textContent = formatTime(Number(playbackSeek.value));
});

playbackSeek.addEventListener("change", () => {
  if (player) {
    player.seekTo(Number(playbackSeek.value), true);
  }

  isSeeking = false;
});

// PLAYBACK SPEED

playbackSpeed.addEventListener("change", () => {
  if (player) {
    player.setPlaybackRate(Number(playbackSpeed.value));
  }
});

// MUTE / UNMUTE

muteBtn.addEventListener("click", () => {
  if (!player) return;

  if (player.isMuted()) {
    player.unMute();
  } else {
    player.mute();
  }

  updatePlaybackControls();
});

// VOLUME

playbackVolume.addEventListener("input", () => {
  if (!player) return;

  const volume = Number(playbackVolume.value);

  player.setVolume(volume);

  if (volume === 0) {
    player.mute();
  } else if (player.isMuted()) {
    player.unMute();
  }

  updatePlaybackControls();
});

// CAPTIONS

captionsBtn.addEventListener("click", () => {
  if (!player) return;

  captionsEnabled = !captionsEnabled;

  if (captionsEnabled) {
    player.loadModule("captions");
  } else {
    player.unloadModule("captions");
  }

  captionsBtn.setAttribute(
    "aria-label",
    captionsEnabled ? "Turn captions off" : "Turn captions on",
  );

  captionsBtn.setAttribute("aria-pressed", String(captionsEnabled));
});

// FULLSCREEN

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === videoPanel) {
      await document.exitFullscreen();
    } else {
      await videoPanel.requestFullscreen();
    }
  } catch (err) {
    console.error("Unable to change video fullscreen mode:", err);
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === videoPanel;

  fullscreenBtn.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
  );

  fullscreenBtn.title = isFullscreen ? "Exit fullscreen" : "Fullscreen";

  fullscreenEnterIcon.classList.toggle("hidden", isFullscreen);

  fullscreenExitIcon.classList.toggle("hidden", !isFullscreen);
});


// 2. LOCAL AI ENGINE

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
        },
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

async function runLocalLLM(systemPrompt, userPrompt, maxTokens = 160) {
  const mode = localEngineSelect.value;

  if (mode === "ollama") {
    try {
      const res = await fetch("/api/ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${systemPrompt}\n\n${userPrompt}` }),
      });
      const data = await res.json();
      if (res.ok && data.response && data.response.trim().length > 0) {
        return data.response.trim();
      }
      console.warn(
        "Ollama unavailable or returned empty; auto-falling back to in-browser WebLLM engine",
      );
    } catch (ollamaErr) {
      console.warn(
        "Ollama connection failed; auto-falling back to in-browser WebLLM engine:",
        ollamaErr,
      );
    }
  }

  // Seamless fallback to WebLLM so AI is always active and never dumps raw transcript fragments
  const modelId = (mode !== "ollama" && MODELS[mode]) || MODELS["webllm-fast"];
  const engine = await ensureWebLLMLoaded(modelId);
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  });
  return reply.choices[0]?.message?.content || "";
}

// ============================================================================
// 3. PHRASE CLEANER & ARCHITECTURAL MULTI-BRANCH MERMAID BUILDER
// ============================================================================
const STOP_WORDS_END = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "at",
  "from",
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "how",
  "why",
  "where",
  "when",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "into",
  "about",
  "above",
  "below",
  "beneath",
  "under",
  "over",
  "now",
  "then",
  "here",
  "there",
  "they",
  "them",
  "their",
  "theirs",
  "it",
  "its",
  "this",
  "these",
  "those",
  "we",
  "us",
  "our",
  "you",
  "your",
  "yours",
  "i",
  "me",
  "my",
  "he",
  "him",
  "his",
  "she",
  "her",
  "well",
  "simply",
  "put",
  "terms",
  "actually",
  "just",
  "also",
  "before",
  "after",
  "got",
  "get",
  "gets",
  "getting",
  "goes",
  "go",
  "going",
  "say",
  "saying",
  "says",
  "tell",
  "tells",
  "telling",
  "look",
  "looks",
  "looking",
  "see",
  "sees",
  "seeing",
  "talk",
  "talks",
  "talking",
  "thing",
  "things",
  "part",
  "parts",
  "step",
  "steps",
  "today",
  "now",
  "again",
  "already",
  "very",
  "really",
  "quite",
  "too",
  "so",
  "all",
  "some",
  "any",
  "no",
  "not",
  "only",
  "such",
  "than",
  "more",
  "most",
  "determines",
  "determine",
  "defining",
  "defines",
  "define",
  "generates",
  "generate",
  "generating",
  "occurs",
  "occur",
  "occurring",
  "within",
  "without",
  "through",
  "across",
  "between",
  "produces",
  "produce",
  "producing",
  "converts",
  "convert",
  "converting",
  "transforms",
  "transform",
  "transformed",
  "created",
  "developed",
  "established",
  "occurred",
  "resulted",
  "leads",
  "lead",
  "leading",
  "shows",
  "show",
  "showing",
  "gives",
  "give",
  "giving",
  "makes",
  "make",
  "making",
  "forms",
  "form",
  "forming",
  "causes",
  "cause",
  "causing",
  "includes",
  "include",
  "including",
  "contains",
  "contain",
  "containing",
  "requires",
  "require",
  "allows",
  "allow",
  "allowing",
  "provides",
  "provide",
  "providing",
  "represents",
  "represent",
  "invaded",
  "attacks",
  "move",
  "moved",
  "moving",
  "moves",
  "states",
  "state",
  "equals",
  "equal",
]);

const STOP_WORDS_START = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "so",
  "by",
  "with",
  "if",
  "when",
  "where",
  "why",
  "how",
  "as",
  "to",
  "for",
  "about",
  "into",
  "onto",
  "under",
  "beneath",
  "from",
  "at",
  "in",
  "on",
  "of",
  "before",
  "after",
  "while",
  "because",
  "since",
  "now",
  "then",
  "here",
  "there",
  "they",
  "we",
  "you",
  "i",
  "he",
  "she",
  "it",
  "this",
  "that",
  "these",
  "those",
  "well",
  "simply",
  "put",
  "terms",
  "actually",
  "just",
  "also",
  "let",
  "lets",
  "going",
  "talking",
  "saying",
  "looking",
  "seeing",
  "welcome",
  "hello",
  "hey",
  "today",
  "ok",
  "okay",
  "alright",
  "right",
]);

const FILLER_PREFIXES = [
  /^in summary\b/i,
  /^the study assistant\b/i,
  /^study assistant\b/i,
  /^in the context of\b/i,
  /^today i will explain\b/i,
  /^in today's (?:video|lecture)\b/i,
  /^in this (?:video|lecture)\b/i,
  /^welcome to\b/i,
  /^welcome back\b/i,
  /^let us understand\b/i,
  /^let's talk about\b/i,
  /^we are going to\b/i,
  /^moving on to\b/i,
  /^next up is\b/i,
  /^first of all\b/i,
  /^hello everyone\b/i,
  /^hey guys\b/i,
];

function isNonEnglishScript(text) {
  if (!text) return false;
  return /[\u0900-\u097F\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\u0400-\u04FF]/.test(
    String(text),
  );
}

function isFillerText(text) {
  if (!text) return false;
  return /\b(welcome back|welcome to (?:my|the) channel|like and subscribe|hit the bell|sponsor|sponsored by|link in description|comment below|thanks for watching|see you in the next|subscribe kare|bell icon|swagat hai|channel ko subscribe)\b/i.test(
    text,
  );
}

function isPureFillerSegment(text) {
  if (!text || text.trim().length < 15) return true;
  const clean = text.toLowerCase().trim();

  const fillerSignals = [
    /\b(like\s+and\s+subscribe|subscribe\s+to|hit\s+the\s+bell|smash\s+that\s+like)\b/i,
    /\b(welcome\s+back|welcome\s+to\s+(?:my|the)\s+channel)\b/i,
    /\b(link\s+in\s+the\s+description|check\s+out\s+the\s+links?\s+below)\b/i,
    /\b(sponsored\s+by|thanks\s+to\s+our\s+sponsor|today's\s+sponsor|use\s+my\s+code)\b/i,
    /\b(leave\s+a\s+comment|let\s+me\s+know\s+in\s+the\s+comments)\b/i,
    /\b(thanks\s+for\s+watching|see\s+you\s+guys\s+in\s+the\s+next\s+one|bye\s+bye)\b/i,
    /\b(can\s+you\s+guys\s+hear\s+me|testing\s+the\s+mic|mic\s+check|technical\s+difficulties)\b/i,
    /\b(subscribe\s+kare|channel\s+ko\s+subscribe|video\s+ko\s+like|bell\s+icon)\b/i,
    /\b(aap\s+sabka\s+swagat\s+hai|swagat\s+hai\s+aapka|aaj\s+ke\s+is\s+video\s+mein)\b/i,
    /\b(chaliye\s+shuru\s+karte\s+hain|bina\s+kisi\s+deri\s+ke)\b/i,
  ];

  const matched = fillerSignals.filter((rgx) => rgx.test(clean));
  if (matched.length >= 2) return true;
  if (matched.length === 1 && clean.split(/\s+/).length < 25) return true;

  return false;
}

function stripExamplesForDiagram(text) {
  if (!text) return "";
  let clean = String(text)
    .replace(
      /\b(for\s+example|for\s+instance|such\s+as|e\.g\.|like\s+when|take\s+the\s+example).*$/i,
      "",
    )
    .replace(/\b(analogy|like\s+a\s+pizza|like\s+food|like\s+a\s+car).*$/i, "")
    .replace(/[,;:]\s*$/, "")
    .trim();
  return clean || text;
}

function formatMermaidNodeText(text, maxLineChars = 40, maxTotalChars = 110) {
  if (!text) return "";
  let clean = String(text)
    // Remove all emojis and variation selectors
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0E\uFE0F]/gu,
      "",
    )
    .replace(/["#;`]/g, "")
    .replace(/[<>{}[\]()|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If text exceeds maxTotalChars, truncate cleanly at word boundary
  if (clean.length > maxTotalChars) {
    const slice = clean.slice(0, maxTotalChars);
    const lastSpace = slice.lastIndexOf(" ");
    clean = (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim();
  }

  // Wrap at word boundaries
  const words = clean.split(" ").filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + " " + word).length <= maxLineChars) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.join("<br/>");
}

function cleanLectureTitle(title, maxChars = 75) {
  if (!title) return "Lecture Overview";
  let clean = String(title)
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0E\uFE0F]/gu,
      "",
    )
    .replace(
      /[\[\(].*?(full\s*course|crash\s*course|official|hd|4k|tutorial|lecture|202\d).*?[\]\)]/gi,
      "",
    )
    .replace(/["#;`]/g, "")
    .replace(/[<>{}[\]()|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxChars) return clean;

  const slice = clean.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim();
}

function sanitizeMermaidText(text, maxChars = 80) {
  return formatMermaidNodeText(text, 36, maxChars);
}

function cleanExamplePhrase(text) {
  return String(text || "")
    .replace(
      /^(for example|for instance|such as|like when|consider|take the example of|take|e\.g\.)\s*[:,]?\s*/i,
      "",
    )
    .trim();
}

const BANNED_CONCEPT_WORDS =
  /\b(fair\s*warning|hungry|pizza|taste|tasty|delicious|coffee|cookie|cake|food|sandwich|burger|eating|eat|guy|guys|folks|welcome|subscribe|like|video|channel|watch|watching|talking|saying|warning)\b/gi;

function cleanSpokenDisfluencies(text) {
  if (!text) return "";
  return String(text)
    // Acronym recovery from audio transcription
    .replace(/\b(a\s+l|a\s+i|a\.\s*i\.)\b/gi, "AI")
    .replace(/\b(m\s+l|m\.\s*l\.)\b/gi, "ML")
    .replace(/\b(n\s+n|n\.\s*n\.)\b/gi, "NN")
    .replace(/\b(d\s+l|d\.\s*l\.)\b/gi, "DL")
    .replace(/\b(l\s+l\s+m|l\s+l\s+m\s+s)\b/gi, "LLM")
    // Stutters and disfluencies
    .replace(/\b(let\s*'?s\s+let\s*'?s)\b/gi, "let's")
    .replace(/\b(the\s+the)\b/gi, "the")
    .replace(/\b(that\s+that)\b/gi, "that")
    .replace(/\b(we\s+we)\b/gi, "we")
    .replace(/\b(in\s+in)\b/gi, "in")
    .replace(/\b(is\s+is)\b/gi, "is")
    // Conversational preambles and lead-ins common in lectures (delimit with comma to preserve clause boundaries)
    .replace(
      /\b(terms\s+well\s+put\s+simply|well\s+put\s+simply|simply\s+put|put\s+simply|terms\s+well\s+put)\b/gi,
      ", ",
    )
    .replace(
      /\b(before\s+we\s+(?:get|got)\s+to\s+that|by\s+now\s+before\s+we)\b/gi,
      ", ",
    )
    .replace(
      /\blet\s*'?s\s+(?:address|look\s+at|talk\s+about|consider|examine|discuss)(?:\s+the)?(?:\s+fundamental)?(?:\s+question)?(?:\s+here)?\b/gi,
      ", ",
    )
    .replace(/\b(address\s+the\s+fundamental\s+question)\b/gi, ", ")
    .replace(
      /\b(actually\s+the\s+hierarchy\s+goes(?:\s+this)?|the\s+hierarchy\s+goes(?:\s+this)?)\b/gi,
      ", ",
    )
    .replace(
      /\b(beneath\s+that\s+then\s+we\s+have|beneath\s+that\s+we\s+have)\b/gi,
      ", ",
    )
    .replace(
      /\b(now\s+a\s+subfield\s+of|a\s+subfield\s+of|is\s+a\s+subfield\s+of)\b/gi,
      ", ",
    )
    .replace(
      /\b(what\s+we\s+have\s+here\s+is|what\s+is\s+meant\s+by|as\s+you\s+can\s+see|if\s+you\s+look\s+at)\b/gi,
      ", ",
    )
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

const PREPOSITIONS = new Set([
  "through",
  "across",
  "within",
  "without",
  "between",
  "into",
  "onto",
  "under",
  "over",
  "from",
  "with",
  "about",
  "above",
  "below",
  "beneath",
  "during",
  "towards",
  "around",
]);

const FINITE_VERBS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
]);

function extractUniversalConcept(strippedText, sessionTitle = "", stepIndex = 0) {
  const cleaned = cleanSpokenDisfluencies(strippedText);

  // 1. Definition, relationship, and categorization marker patterns (universal across all academic subjects)
  const patterns = [
    /\b(?:the\s+law\s+of|the\s+concept\s+of|theory\s+of|principle\s+of|model\s+of)\s+([a-zA-Z0-9 -]+?)(?:\s+(?:is|determines|explains|states|defines|describes)\b|[.,;]|$)/i,
    /\b([a-zA-Z0-9 -]+?)\s+(?:is\s+a\s+subset\s+of|is\s+defined\s+as|is\s+known\s+as|is\s+called|is\s+a\s+subfield\s+of|is\s+a\s+branch\s+of|refers\s+to|consists\s+of)\b/i,
    /\b(?:subfield\s+of\s+[a-zA-Z0-9 -]+\s+is)\s+([a-zA-Z0-9 -]{3,30})/i,
    /\b(?:called|known\s+as|named)\s+([a-zA-Z0-9 -]{3,30})/i,
  ];

  for (const pat of patterns) {
    const m = cleaned.match(pat);
    if (m && m[1]) {
      const c = cleanConceptPhrase(m[1], 4);
      if (isValidStudyConcept(c)) return c;
    }
  }

  // 2. Candidate clause extraction & scoring (subject-agnostic linguistics)
  const clauses = cleaned.split(
    /(?<=[.!?])\s+|[;,]+|\s+(?=(?:and|but|while|because|or|then|beneath)\b)/i,
  );
  let bestCandidate = "";
  let bestScore = -1;

  clauses.forEach((clause, clauseIdx) => {
    const words = clause.split(/\s+/).filter((w) => /^[a-zA-Z0-9-]{2,}$/.test(w));
    for (let len = 3; len >= 1; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        const sliceWords = words.slice(i, i + len);
        if (
          sliceWords.some(
            (w) =>
              PREPOSITIONS.has(w.toLowerCase()) ||
              FINITE_VERBS.has(w.toLowerCase()),
          )
        ) {
          continue;
        }

        const candidate = cleanConceptPhrase(sliceWords.join(" "), 4);
        if (!isValidStudyConcept(candidate)) continue;

        let score = 0;
        const cWords = candidate.split(" ");
        if (cWords.length === 2) score += 10;
        else if (cWords.length === 3) score += 8;
        else if (cWords.length === 1) score += 6;
        else score += 4;

        // Position bonus: start of the opening sentence/clause is the subject
        if (clauseIdx === 0 && i === 0) score += 8;

        // Academic noun morphology bonus across sciences, humanities, math
        for (const w of cWords) {
          if (/^[A-Z]{2,}$/.test(w)) score += 10; // Acronym e.g. AI, DNA, RNA, GDP, ATP, CPU
          if (
            /(tion|sion|sis|ism|ity|ment|ology|ence|ance|ics|ure|phy|ist|gen|ose|ium|ate|ia)$/i.test(
              w,
            )
          ) {
            score += 6;
          }
        }

        if (
          sessionTitle &&
          candidate.toLowerCase().includes(sessionTitle.toLowerCase())
        ) {
          score += 3;
        }

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
    }
  });

  return bestCandidate;
}

function isValidStudyConcept(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.toLowerCase().trim();
  if (clean.length < 3 || clean.length > 50) return false;

  // Reject generic placeholders
  if (
    /^(core\s*concept|core\s*principle|topic\s*\d+|concept|untitled)$/i.test(
      clean,
    )
  )
    return false;

  // Reject conversational clauses, sentence fragments, and preambles
  const invalidStart =
    /^(look|and|or|but|so|by|with|if|when|where|why|how|as|to|for|about|talking|saying|feeling|warning|trying|going|welcome|hello|hey|today|now|terms|well|simply|put|actually|before|after|beneath|address|the\s+hierarchy)\b/i;
  if (invalidStart.test(clean)) return false;

  // Reject conversational endings
  const invalidEnd =
    /\b(now|then|they|them|it|this|that|these|those|here|there|put|well|got|get|goes|say|says|saying)\b/i;
  if (invalidEnd.test(clean)) return false;

  // Reject conversational filler, foods, analogies, and unnecessary words
  if (BANNED_CONCEPT_WORDS.test(clean)) return false;

  return true;
}

function cleanDetailPhrase(detail) {
  if (!detail || typeof detail !== "string")
    return "Core technical mechanism and property";
  let clean = cleanSpokenDisfluencies(detail)
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0E\uFE0F]/gu,
      "",
    )
    .replace(/^(concept|detail|summary|mechanism)\s*[:.-]\s*/i, "")
    .replace(BANNED_CONCEPT_WORDS, "")
    // Remove isolated single stray letters at the end (e.g. cut off words from speech recognition)
    .replace(/\s+[b-hj-z]$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  clean = clean.replace(
    /^(and|or|but|so|then|now|actually|also|simply|just)\s+/i,
    "",
  );
  if (clean.length < 8) return "Core technical mechanism and property";
  const compacted = compactNote(clean, 18);
  if (!compacted) return "Core technical mechanism and property";
  return compacted.charAt(0).toUpperCase() + compacted.slice(1);
}

function cleanConceptPhrase(rawText, maxWords = 4) {
  if (!rawText || isNonEnglishScript(rawText)) {
    return "";
  }
  let text = cleanSpokenDisfluencies(rawText)
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0E\uFE0F]/gu,
      "",
    )
    .replace(/["'`:;()\[\]{}|\\/<>]/g, " ")
    .replace(
      /\b(study assistant|transcript|speaker|in summary|look fair warning|fair warning|talking about pizza|by talking about)\b/gi,
      " ",
    )
    .replace(BANNED_CONCEPT_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const regex of FILLER_PREFIXES) {
    text = text.replace(regex, "").trim();
  }

  let words = text
    .replace(/[^\p{L}\p{M}\p{N} -]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Remove leading stop words
  while (
    words.length > 0 &&
    (STOP_WORDS_START.has(words[0].toLowerCase()) ||
      STOP_WORDS_END.has(words[0].toLowerCase()))
  ) {
    words.shift();
  }

  // Remove trailing stop words
  while (
    words.length > 0 &&
    (STOP_WORDS_END.has(words[words.length - 1].toLowerCase()) ||
      STOP_WORDS_START.has(words[words.length - 1].toLowerCase()))
  ) {
    words.pop();
  }

  words = words.slice(0, maxWords);

  // Re-check after slicing
  while (
    words.length > 0 &&
    (STOP_WORDS_END.has(words[words.length - 1].toLowerCase()) ||
      STOP_WORDS_START.has(words[words.length - 1].toLowerCase()))
  ) {
    words.pop();
  }

  if (words.length === 0) return "";
  const result = words
    .map((w) => {
      if (
        /^(ai|ml|nn|dl|llm|llms|nlp|cv|rl|cnn|rnn|sql|api|cpu|gpu|ram|os|html|css|js|json|rest|xml|http|https)$/i.test(
          w,
        )
      ) {
        return w.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");

  return result;
}

function buildStudyFallback(
  spokenText,
  sessionTitle = "",
  stepIndex = 0,
  timeRange = "",
) {
  const cleanTitle = cleanLectureTitle(sessionTitle || "Academic Lecture", 50);

  // Clean speech disfluencies and recover acronyms
  let cleanSpoken = cleanSpokenDisfluencies(spokenText || "");

  // Detect and isolate analogies or examples (e.g., pizza, food, cars) for study notes only
  let exampleText = null;
  const analogyRegex =
    /\b(pizza|burger|sandwich|cookie|cake|coffee|tea|food|eating|delicious|taste|tasty|hungry)\b/i;
  if (analogyRegex.test(cleanSpoken)) {
    exampleText =
      "Food analogy used to illustrate model representation hierarchy";
  } else {
    const exMatch = cleanSpoken.match(
      /\b(for example|for instance|such as|like when|consider|take the example)\s+([^.!?]+)/i,
    );
    if (exMatch && exMatch[2]) {
      exampleText = cleanExamplePhrase(exMatch[0]);
    }
  }

  // Strip conversational banter and analogy words from the technical text
  let strippedText = cleanSpoken
    .replace(
      /\b(look\s*,?\s*fair\s*warning|fair\s*warning|if\s*you(?:'re|\s*are)\s*feeling\s*a\s*little\s*hungry\s*(?:right\s*now)?)\b/gi,
      "",
    )
    .replace(
      /\b(talking\s*about\s*pizza|pizza\s*delicious\s*taste|delicious\s*taste|delicious|tasty|hungry|pizza)\b/gi,
      "",
    )
    .replace(
      /\b(welcome\s*to|welcome\s*back|in\s*this\s*video|let\s*us\s*talk\s*about|we\s*are\s*going\s*to|in\s*today'?s\s*lecture)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  let conceptName = "";
  if (stepIndex === 0) {
    conceptName = `${cleanTitle} Overview`;
  } else {
    conceptName = extractUniversalConcept(strippedText, cleanTitle, stepIndex);
    if (!conceptName || !isValidStudyConcept(conceptName)) {
      conceptName = `${cleanTitle} Step ${stepIndex + 1}`;
    }
  }

  // Construct primary explanation and secondary detail without static repetition
  let primaryNote = "";
  let secondaryNote = "";

  if (stepIndex === 0) {
    primaryNote = `Introduces foundational principles and comparative structure of ${cleanTitle}.`;
    secondaryNote = `Examines theoretical mechanisms, definitions, and operational structure.`;
  } else {
    const sentences = strippedText
      .split(/(?<=[.!?])\s+|[;,]+|\s+(?=(?:and|but|while|because|when)\b)/i)
      .map((s) => s.trim())
      .filter(
        (s) => s.length >= 10 && !isFillerText(s) && !isNonEnglishScript(s),
      );

    if (sentences.length >= 1) {
      primaryNote = cleanDetailPhrase(sentences[0]);
    } else {
      primaryNote = `Examines core theoretical properties and functional mechanisms of ${conceptName}.`;
    }

    if (sentences.length >= 2) {
      secondaryNote = cleanDetailPhrase(sentences[1]);
    } else {
      secondaryNote = `Analyzes operational structure and principles in the context of ${cleanTitle}.`;
    }
  }

  return {
    mainConcept: conceptName,
    primaryNote,
    secondaryNote,
    example: exampleText,
  };
}

function getStepTranscript(session, stepIndex) {
  const startSec = stepIndex * STEP_INTERVAL_SECONDS;
  const endSec = (stepIndex + 1) * STEP_INTERVAL_SECONDS;

  let lines = (session.transcript || [])
    .filter((t) => t.offset >= startSec && t.offset < endSec)
    .map((t) => t.text);

  if (lines.length === 0 && session.transcript) {
    lines = session.transcript
      .filter(
        (t) => t.offset >= Math.max(0, startSec - 5) && t.offset <= endSec + 5,
      )
      .map((t) => t.text);
  }

  return {
    startSec,
    endSec,
    timeRange: `${formatTime(startSec)} - ${formatTime(endSec)}`,
    spokenText: lines.join(" ").replace(/\s+/g, " ").trim(),
  };
}

async function generateMultiBranchStep(
  spokenText,
  timeRange,
  sessionTitle = "",
  stepIndex = 0,
) {
  if (isCorruptedTranscript(spokenText)) {
    return createUnavailableNote(
      timeRange,
      "Caption text is corrupted or not readable",
    );
  }

  // Pre-filter pure promotional filler after the opening segment
  if (stepIndex > 0 && isPureFillerSegment(spokenText)) {
    return {
      isStudyMaterial: false,
      timeRange,
      noteBlock: null,
      mainConcept: null,
      explanation: null,
      subBranchA: null,
      subBranchB: null,
      example: null,
    };
  }

  const systemPrompt = [
    "You are an expert academic study assistant extracting study notes and concept maps from lecture audio.",
    "TASK: Extract the core academic/technical concept and its underlying mechanism from this lecture segment.",
    "CRITICAL RULES:",
    "1. STRICT ENGLISH ONLY: All output must be strictly in English. If the speech is in Hindi, Hinglish, Spanish, or another language, comprehend it and produce notes and concepts strictly in clear English.",
    '2. REAL ACADEMIC CONCEPTS ONLY: CONCEPT must be a formal academic topic, algorithm, property, or theoretical principle (e.g. "Neural Network Architecture", "Supervised Learning", "Feature Representation"). NEVER output conversational remarks or sentence fragments like "Look fair warning if" or "Feeling hungry".',
    "3. NO ANALOGIES OR EXAMPLES IN CONCEPT OR EXPLANATION: Teachers often use casual analogies (e.g. pizza, food, cars, games, dogs). NEVER use analogy words (such as pizza, delicious, food) in CONCEPT or EXPLANATION. Explain only the real academic/technical mechanism.",
    "4. EXAMPLES IN NOTES ONLY, NEVER IN DIAGRAM: If the teacher uses an example or analogy, put it strictly into the EXAMPLE field for study notes. Keep EXAMPLE under 14 words. If no example was given, write exactly: NONE.",
    "5. CONCISE AND PRECISE: CONCEPT must be 2 to 4 capitalized technical words. EXPLANATION must be 1 clear definition or mechanism sentence (max 16 words). DETAIL must be 1 supporting property or insight (max 16 words).",
    "6. OUTPUT FORMAT:",
    "STATUS: STUDY",
    "CONCEPT: <2-4 capitalized technical topic words in English>",
    "EXPLANATION: <1 clear sentence defining the mechanism in English, max 16 words, NO analogies>",
    "DETAIL: <1 key supporting property or insight in English, max 16 words, NO analogies>",
    "EXAMPLE: <Concrete example or analogy mentioned in English, or NONE>",
  ].join("\n");

  const userPrompt = [
    `Lecture Subject: "${sessionTitle || "Academic Lecture"}"`,
    `Segment Time: ${timeRange}`,
    `Transcript Excerpt: "${spokenText}"`,
    "",
    "Extract academic study concept (English only):",
  ].join("\n");

  let parsedConcept = "";
  let parsedExplanation = "";
  let parsedDetail = "";
  let parsedExample = "";

  try {
    const raw = await runLocalLLM(systemPrompt, userPrompt, 160);
    const rawText = String(raw || "").trim();

    if (
      stepIndex > 0 &&
      /status\s*:\s*filler/i.test(rawText) &&
      isPureFillerSegment(spokenText)
    ) {
      return {
        isStudyMaterial: false,
        timeRange,
        noteBlock: null,
        mainConcept: null,
        explanation: null,
        subBranchA: null,
        subBranchB: null,
        example: null,
      };
    }

    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (/^concept\s*:\s*/i.test(line)) {
        parsedConcept = line.replace(/^concept\s*:\s*/i, "").trim();
      } else if (/^explanation\s*:\s*/i.test(line)) {
        parsedExplanation = line.replace(/^explanation\s*:\s*/i, "").trim();
      } else if (/^detail\s*:\s*/i.test(line)) {
        parsedDetail = line.replace(/^detail\s*:\s*/i, "").trim();
      } else if (/^example\s*:\s*/i.test(line)) {
        parsedExample = line.replace(/^example\s*:\s*/i, "").trim();
      } else if (/^main\s*:\s*/i.test(line) && !parsedExplanation) {
        parsedExplanation = line.replace(/^main\s*:\s*/i, "").trim();
      }
    }
  } catch (err) {
    console.warn(
      `Local note generation failed for ${timeRange}; using intelligent fallback.`,
      err,
    );
  }

  // Intelligent fallback recovery if LLM failed or provided unusable concept
  const fallback = buildStudyFallback(
    spokenText,
    sessionTitle,
    stepIndex,
    timeRange,
  );

  let mainConcept = cleanConceptPhrase(parsedConcept, 4);
  if (!isValidStudyConcept(mainConcept) || isNonEnglishScript(mainConcept)) {
    mainConcept = fallback.mainConcept;
  }

  let primaryNote = cleanDetailPhrase(parsedExplanation);
  if (
    !primaryNote ||
    primaryNote === "Core technical mechanism and property" ||
    isNonEnglishScript(primaryNote)
  ) {
    primaryNote = fallback.primaryNote;
  }

  let secondaryNote = cleanDetailPhrase(parsedDetail);
  if (
    !secondaryNote ||
    secondaryNote === "Core technical mechanism and property" ||
    isNonEnglishScript(secondaryNote)
  ) {
    secondaryNote = fallback.secondaryNote;
  }

  let cleanExample = null;
  if (
    parsedExample &&
    !/^(none|n\/a|no example|nil)$/i.test(parsedExample.trim())
  ) {
    cleanExample = cleanExamplePhrase(parsedExample);
  } else if (fallback.example) {
    cleanExample = fallback.example;
  }

  let noteBlock = `[${timeRange}] ${mainConcept.toUpperCase()}\n• Concept: ${primaryNote}\n• Detail: ${secondaryNote}`;
  if (
    cleanExample &&
    cleanExample.toLowerCase() !== "none" &&
    cleanExample.length > 3
  ) {
    noteBlock += `\n• Example: ${cleanExample}`;
  }

  return {
    isStudyMaterial: true,
    timeRange,
    noteBlock,
    mainConcept,
    explanation: primaryNote,
    subBranchA: mainConcept,
    subBranchB: secondaryNote,
    example:
      cleanExample && cleanExample.toLowerCase() !== "none"
        ? cleanExample
        : null,
  };
}

function normalizeNoteText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(
      /^(concept|detail|summary|main idea|supporting detail|main|first line|second line)\s*:\s*/i,
      "",
    )
    .replace(/^(note|line)\s*\d+\s*[:.)-]\s*/i, "")
    .trim()
    .replace(/[.!?]+$/, "");
}

function isCorruptedTranscript(text) {
  return (String(text || "").match(/\uFFFD/g) || []).length > 0;
}

const NON_EDUCATIONAL_PATTERNS = [
  // Music videos, full tracks, official songs
  /\b(official\s+music\s+video|official\s+lyric\s+video|official\s+audio|lyrics?\s+video|audio\s+track|full\s+album|vevo|jukebox|lyrical\s+video|cover\s+song|remix\s+song|video\s+song)\b/i,
  // Fictional movies, trailers, cinema clips
  /\b(official\s+trailer|teaser\s+trailer|movie\s+trailer|short\s+film|feature\s+film|full\s+movie|climax\s+scene|action\s+scene|deleted\s+scene)\b/i,
  // Comedy sketches, pure entertainment, stand-up, pranks, roasts
  /\b(comedy\s+sketch|skit|sketch\s+comedy|stand-?up\s+comedy|pranks?|funny\s+vines|roast\s+of|parody\s+video|reaction\s+video|tik\s*tok\s+compilation)\b/i,
  // Known entertainment / comedy channels
  /\b(be\s*you\s*nick|ashish\s*chanchlani|bb\s*ki\s*vines|carryminati|dhar\s*mann|t-series|zee\s*music|sony\s*music|speed\s*records|yrf|round2hell|harsh\s*beniwal)\b/i,
  // Non-educational gaming & pure entertainment playthroughs
  /\b(gameplay\s+walkthrough\s+part|let'?s\s+play\s+part|gaming\s+funny\s+moments|stream\s+highlights|rage\s+quit)\b/i,
];

const EDUCATIONAL_TITLE_PATTERNS =
  /\b(tutorial|lecture|course|class|lesson|learn\w*|explained|guide|crash\s*course|algorithm|programming|coding|science|math|mathematics|physics|chemistry|biology|history|exam|preparation|notes|study|concept|data\s*structures?|computer\s*science|how\s*to|development|architecture|machine\s*learning|deep\s*learning|ai|neural|network|comparison|vs|overview|introduction|analysis|fundamentals|principles|theory|masterclass|system\s*design|walkthrough|review|solved|solution|interview|gate|jee|neet|upsc|sat|gre|curriculum|syllabus|engineering|calculus|algebra|geometry|statistics|economics|philosophy|psychology|neuroscience|biochemistry|genetics|mechanics|astronomy|electromagnetism|electronics|circuits|database|sql|devops|docker|kubernetes|security|cybersecurity)\b/i;

const EDUCATIONAL_TRANSCRIPT_PATTERNS =
  /\b(for\s+example|we\s+define|in\s+this\s+lecture|let'?s\s+understand|the\s+concept\s+of|how\s+this\s+works|difference\s+between|step\s+one|step\s+two|formula|algorithm|function|property|definition|mechanism|process|principle|important\s+concept|key\s+takeaway|notice\s+that|in\s+other\s+words|theory|structure|calculate|solve|solution|theorem)\b/i;

async function classifyVideoWithLLM(session) {
  const title = String(session.title || "").trim();

  // 1. FAST-TRACK: If title matches strong educational keywords (and is not an explicit prank/parody)
  if (EDUCATIONAL_TITLE_PATTERNS.test(title)) {
    const isExplicitParody =
      /\b(prank|parody\s+sketch|comedy\s+sketch)\b/i.test(title);
    if (!isExplicitParody) {
      return {
        isEducational: true,
        reason: "Matched educational title keywords",
      };
    }
  }

  // 2. High-confidence non-educational patterns in title
  for (const pattern of NON_EDUCATIONAL_PATTERNS) {
    if (pattern.test(title)) {
      return {
        isEducational: false,
        reason:
          "Identified as non-educational entertainment / fictional media from title",
      };
    }
  }

  // 3. Inspect transcript
  const transcript = session.transcript || [];
  if (!transcript.length) {
    return {
      isEducational: true,
      reason: "Defaulted to educational (no transcript)",
    };
  }

  const filteredTranscript = transcript.filter((item) => {
    const t = (item.text || "").trim();
    return t.length > 5 && !isFillerText(t);
  });
  const sourceTranscript =
    filteredTranscript.length >= 8 ? filteredTranscript : transcript;

  // 4. Quick transcript keyword scan across spoken lines
  const transcriptExcerpt = sourceTranscript
    .slice(0, 50)
    .map((item) => item.text || "")
    .filter(Boolean)
    .join(" ");

  const eduMatches = (
    transcriptExcerpt.match(
      new RegExp(EDUCATIONAL_TRANSCRIPT_PATTERNS.source, "gi"),
    ) || []
  ).length;
  if (eduMatches >= 2) {
    return {
      isEducational: true,
      reason: "Detected multiple educational explanation patterns in speech",
    };
  }

  // 5. Build representative sample for AI (skip opening greeting banter)
  const startIndex = sourceTranscript.length > 25 ? 12 : 0;
  const sampleSlice = sourceTranscript.slice(startIndex, startIndex + 35);
  const sampleText = sampleSlice
    .map((item) => item.text || "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 1100);

  if (sampleText.trim().length < 25) {
    return {
      isEducational: true,
      reason: "Transcript excerpt too short, defaulted to educational",
    };
  }

  const systemPrompt = [
    "You are an educational video classifier.",
    "TASK: Determine whether this video contains educational, instructional, academic, tutorial, explainer, or informational content (such as lectures, tutorials, coding, science, math, history, philosophy, skill guides, or concept explanations).",
    "NOTE: Educational videos often have conversational intros, humor, or real-world examples. If the speaker explains, teaches, or demonstrates concepts or skills, classify as EDUCATIONAL.",
    "Only classify as NON_EDUCATIONAL if it is purely non-educational entertainment with no instructional purpose (such as music videos, fictional movies, comedy sketches, pranks, or gaming playthroughs).",
    "Output exactly ONE word: EDUCATIONAL or NON_EDUCATIONAL.",
  ].join("\n");

  const userPrompt = [
    `Title: "${session.title || "Untitled"}"`,
    `Spoken Transcript Excerpt: "${sampleText}"`,
    "",
    "Classification (EDUCATIONAL or NON_EDUCATIONAL):",
  ].join("\n");

  try {
    diagramStatus.textContent = "Analyzing content with AI...";
    const raw = await runLocalLLM(systemPrompt, userPrompt, 40);
    const reply = String(raw || "")
      .trim()
      .toUpperCase();

    const isNonEd = /\b(NON[-_ ]EDUCATIONAL|NOT[-_ ]EDUCATIONAL)\b/i.test(
      reply,
    );
    const isEd = /\bEDUCATIONAL\b/i.test(reply);

    if (isEd && !isNonEd) {
      return {
        isEducational: true,
        reason: "Verified educational lecture by AI",
      };
    }

    if (isNonEd && !isEd) {
      return {
        isEducational: false,
        reason: "Classified as non-educational entertainment by AI",
      };
    }
  } catch (err) {
    console.warn("Local LLM classification timed out or failed:", err);
  }

  // Fallback: Check if title or description has genuine educational markers
  const titleAndDesc =
    `${session.title || ""} ${session.description || ""}`.toLowerCase();
  if (EDUCATIONAL_TITLE_PATTERNS.test(titleAndDesc)) {
    return {
      isEducational: true,
      reason: "Matched educational keywords in fallback",
    };
  }

  return { isEducational: true, reason: "Defaulted to educational" };
}

function showNonEducationalContentMessage() {
  studyNotes.value = NON_EDUCATIONAL_MESSAGE;
  diagramStatus.textContent = "Notes unavailable for this content";
  if (chaptersTimelineSection) {
    chaptersTimelineSection.classList.add("hidden");
  }
  mermaidContainer.innerHTML = `
    <div class="empty-diagram-msg" style="max-width: 440px; margin: auto; padding: 48px 20px; text-align: center;">
      <div style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); margin-bottom: 8px;">Notice</div>
      <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">Non-Educational Content</div>
      <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">${NON_EDUCATIONAL_MESSAGE}</div>
      <button id="forceStudyModeBtn" style="font-size: 0.8rem; font-weight: 500; padding: 7px 16px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color, #3f3f46); background: var(--bg-secondary, #27272a); color: var(--text-primary, #f4f4f5); transition: background 0.15s ease;">
        Generate Notes Anyway
      </button>
    </div>
  `;

  const forceBtn = document.getElementById("forceStudyModeBtn");
  if (forceBtn) {
    forceBtn.onclick = async () => {
      if (!currentVideoId) return;
      let session = await getCachedSession(currentVideoId);
      if (!session) return;
      session = await saveCachedSession(currentVideoId, {
        contentType: "educational",
        classificationVersion: CLASSIFICATION_VERSION,
      });
      if (chaptersTimelineSection) {
        chaptersTimelineSection.classList.remove("hidden");
      }
      diagramStatus.textContent = "Starting study notes indexing...";
      await processStepAtTime(0, true);
      await renderProgressiveUI(session, 0);
    };
  }
}

function createUnavailableNote(timeRange, message) {
  return {
    isStudyMaterial: false,
    timeRange,
    noteBlock: null,
    mainConcept: null,
    explanation: null,
    subBranchA: null,
    subBranchB: null,
    example: null,
  };
}

function compactNote(text, maxWords = 18) {
  const words = normalizeNoteText(text).split(/\s+/).filter(Boolean);
  return words
    .slice(0, maxWords)
    .join(" ")
    .replace(/[,:;]$/, "");
}

function isUsableNote(text) {
  const note = compactNote(text);
  if (note.length < 12 || note.split(/\s+/).length > 22) return false;
  if (
    /study assistant|as an ai|the transcript|this segment|the user asked/i.test(
      note,
    )
  )
    return false;
  if (isFillerText(note)) return false;
  if (isNonEnglishScript(note)) return false;

  const words = note.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);
  const repeatedWordRatio = words.length
    ? 1 - uniqueWords.size / words.length
    : 1;
  return repeatedWordRatio < 0.45;
}

function areSimilarNotes(first, second) {
  const firstWords = new Set(compactNote(first).toLowerCase().split(/\s+/));
  const secondWords = compactNote(second).toLowerCase().split(/\s+/);
  if (!secondWords.length) return true;
  const sharedWords = secondWords.filter((word) => firstWords.has(word)).length;
  return sharedWords / secondWords.length >= 0.65;
}

function buildTranscriptFallback(spokenText) {
  // If the raw transcript is in non-English script, we must NEVER dump raw non-English into the notes!
  if (isNonEnglishScript(spokenText)) {
    return [
      "Lecture concept discussion",
      "Key technical principle explained in audio",
      null,
    ];
  }

  const sentences = spokenText
    .split(
      /(?<=[.!?])\s+|[;,]+|\s+(?=(?:and|but|while|because|when|what if)\b)/i,
    )
    .map((sentence) => compactNote(sentence))
    .filter(
      (sentence) =>
        sentence.length >= 12 &&
        !isFillerText(sentence) &&
        !isNonEnglishScript(sentence),
    );

  const first = sentences[0] || compactNote(spokenText);
  const second =
    sentences.find(
      (sentence) => sentence !== first && !areSimilarNotes(first, sentence),
    ) || "Supporting technical detail from lecture";

  const exampleSentence = sentences.find((s) =>
    /\b(for example|for instance|such as|like when|consider|take the example|e\.g\.)\b/i.test(
      s,
    ),
  );
  const example = exampleSentence ? cleanExamplePhrase(exampleSentence) : null;

  return [first, second, example];
}

function buildSongFallback(spokenText) {
  const words = normalizeNoteText(spokenText).split(/\s+/).filter(Boolean);
  const counts = new Map();
  words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  const repeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
    .join(", ");

  return [
    repeated
      ? `Lyrics repeat the words or phrases: ${repeated}`
      : "This segment contains song lyrics",
    "The captions do not provide enough context for a reliable meaning summary",
  ];
}

function getFullTranscriptText(session) {
  return (session.transcript || [])
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((item) => item.text || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTranscriptIntoChunks(text, maxCharacters = 4500) {
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[,;])\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxCharacters) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? " " : ""}${sentence}`;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, maxCharacters)];
}

function deduplicateTextBlocks(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const result = [];
  const seen = new Set();

  for (const line of lines) {
    const key = line
      .toLowerCase()
      .replace(/[`*_#:.!?|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  return result.join("\n\n");
}

function cleanStudyGuide(text) {
  const cleaned = deduplicateTextBlocks(
    String(text || "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<tree>[\s\S]*?<\/tree>/gi, "")
      .replace(/<node\b[^>]*>[\s\S]*?<\/node>/gi, "")
      .split(/\n\s*(?:in summary|summary|conclusion)\s*:?\s*/i)[0]
      .trim(),
  );
  const lines = cleaned.split(/\r?\n/);
  const result = [];
  const childCountVariantPattern =
    /binary search tree with (?:\d+|n(?:-\d+)?) children/i;
  const childCountVariants = lines.filter((line) =>
    childCountVariantPattern.test(line),
  ).length;

  for (const line of lines) {
    if (childCountVariants > 1 && childCountVariantPattern.test(line)) {
      continue;
    }
    result.push(line);
  }

  const output = result.join("\n").trim();
  if (childCountVariants > 1) {
    return `${output}\n\n> The lecture does not support a separate list of binary-tree types for every possible child count.`;
  }
  return output;
}

async function generateFinalSummary(session) {
  const transcript = getFullTranscriptText(session);
  if (!transcript || isCorruptedTranscript(transcript)) {
    return "A complete summary could not be created because the video captions are missing or corrupted.";
  }

  const chunks = splitTranscriptIntoChunks(transcript);
  const chunkSummaries = [];
  const chunkPrompt = [
    "You are extracting a concept inventory from one part of an educational lecture.",
    "Extract every distinct concept, definition, type, property, relationship, example, or comparison explicitly taught.",
    "Ignore greetings, filler, repeated words, and incomplete caption fragments.",
    "Do not merge different concepts and do not invent facts or conclusions.",
    "If a definition is unclear or conflicts with standard terminology, mark it as unclear instead of guessing.",
    "Do not enumerate arbitrary child counts or invent names such as B2, B3, B10, or Bn unless the lecture explicitly teaches them as named concepts.",
    "Use one line per concept in this exact format: CONCEPT | DEFINITION OR EXPLANATION | EXAMPLE OR RELATIONSHIP.",
    "Keep each line factual and specific. Do not write an introduction or conclusion.",
  ].join(" ");

  for (let index = 0; index < chunks.length; index += 1) {
    diagramStatus.textContent = `Reading lecture section ${index + 1} of ${chunks.length}...`;
    try {
      const summary = await runLocalLLM(
        chunkPrompt,
        `Lecture section ${index + 1}:\n${chunks[index]}\n\nWrite the section summary:`,
        220,
      );
      if (summary.trim()) chunkSummaries.push(deduplicateTextBlocks(summary));
    } catch (err) {
      console.warn(
        `Lecture section ${index + 1} could not be summarized.`,
        err,
      );
    }
  }

  if (!chunkSummaries.length) {
    return "A complete summary could not be created because the local AI engine is unavailable.";
  }

  const finalPrompt = [
    "Create a complete, detailed study guide from the concept inventory below.",
    "Cover every distinct named concept in the inventory; do not omit smaller concepts.",
    "Use a clear title followed by one Markdown heading per concept.",
    "Under each heading, write 2 to 4 complete sentences explaining the definition, properties, relationships, and examples.",
    "Correct obvious wording mistakes and remove filler, but do not add facts that are not supported by the inventory.",
    "If two entries conflict, explain the distinction instead of combining them.",
    'Do not repeat a concept. Do not write an abstract, introduction, conclusion, or an "In summary" paragraph.',
    "Do not generate long lists of hypothetical variants, child counts, or numbered types.",
    "Never output XML, HTML, Mermaid, pseudocode, or a made-up tree representation.",
    "Do not mention transcripts, AI, sections, or the summarization process.",
  ].join(" ");
  const combined = deduplicateTextBlocks(chunkSummaries.join("\n\n"));

  try {
    diagramStatus.textContent = "Writing final lecture summary...";
    const draft = await runLocalLLM(
      finalPrompt,
      `Lecture section summaries:\n${combined}\n\nWrite the final study guide:`,
      900,
    );
    const reviewPrompt = [
      "Review the draft study guide against the supplied concept inventory.",
      "Return the complete corrected study guide only.",
      "Keep every supported concept and explanation.",
      "Remove unsupported claims, invented examples, XML or code, repeated headings, and abstract or summary paragraphs.",
      "Remove any invented list of child-count variants such as B2, B3, B10, Bn, or similar names unless directly supported by the inventory.",
      'If a statement is not supported or is ambiguous, say "The lecture does not make this detail clear."',
      "Do not shorten the guide into a general overview. Keep the guide under 1200 words.",
    ].join(" ");
    const reviewed = await runLocalLLM(
      reviewPrompt,
      `Concept inventory:\n${combined}\n\nDraft study guide:\n${draft}\n\nReturn the corrected study guide:`,
      1000,
    );
    return cleanStudyGuide(reviewed || draft);
  } catch (err) {
    console.warn("Final lecture summary could not be generated.", err);
    return cleanStudyGuide(chunkSummaries.join("\n\n"));
  }
}

async function renderProgressiveUI(session, upToStepIndex) {
  if (session.contentType === "non-educational") {
    showNonEducationalContentMessage();
    return;
  }

  const steps = session.steps || {};
  const orderedKeys = Object.keys(steps)
    .map((k) => parseInt(k, 10))
    .filter((k) => Number.isFinite(k) && k <= upToStepIndex)
    .sort((a, b) => a - b);

  // Strictly filter to steps that contain genuine study material only
  const studyKeys = orderedKeys.filter((k) => {
    const s = steps[k];
    return s && s.isStudyMaterial !== false && s.noteBlock && s.mainConcept;
  });

  if (studyKeys.length === 0) {
    studyNotes.value = `ACTIVE LECTURE: ${session.title || "Session"}\n\nNotes will auto-populate every ${STEP_INTERVAL_SECONDS} seconds of playback as study material is explained.`;
  } else {
    studyNotes.value = studyKeys.map((k) => steps[k].noteBlock).join("\n\n");
    studyNotes.scrollTop = studyNotes.scrollHeight;
  }

  const rootTitle = cleanLectureTitle(session.title || "Lecture Overview", 60);
  const rootLabel = formatMermaidNodeText(rootTitle, 36, 75);
  const mermaidLines = [
    "flowchart TD",
    'ROOT(["' + rootLabel + '"])',
    "classDef default fill:#18181b,stroke:#3f3f46,stroke-width:1.5px,color:#f4f4f5,font-family:Inter,system-ui,sans-serif;",
    "classDef rootNode fill:#27272a,stroke:#52525b,stroke-width:2px,color:#ffffff,font-weight:700,font-size:14px;",
    "classDef conceptNode fill:#0f172a,stroke:#3b82f6,stroke-width:1.5px,color:#f8fafc,font-size:12.5px;",
    "class ROOT rootNode;",
  ];

  const maxVisibleKeys = 100;
  const displayKeys =
    studyKeys.length > maxVisibleKeys
      ? studyKeys.slice(-maxVisibleKeys)
      : studyKeys;
  const isTruncated = studyKeys.length > maxVisibleKeys;

  // Deduplicate consecutive steps with identical or highly repetitive concept & detail
  const uniqueDisplayKeys = [];
  let lastConceptNorm = "";
  let lastDetailNorm = "";

  for (const key of displayKeys) {
    const s = steps[key];
    const cNorm = (s.mainConcept || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const dNorm = (s.explanation || s.subBranchB || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (uniqueDisplayKeys.length > 0) {
      const prevKey = uniqueDisplayKeys[uniqueDisplayKeys.length - 1];
      const prevStep = steps[prevKey];
      const prevDNorm = (prevStep.explanation || prevStep.subBranchB || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      // If both concept and detail repeat, or details are identical/similar boilerplate, skip duplicate node
      if (
        (cNorm === lastConceptNorm && dNorm === lastDetailNorm) ||
        (dNorm === prevDNorm && dNorm.length > 15) ||
        areSimilarNotes(s.explanation, prevStep.explanation)
      ) {
        continue;
      }
    }

    uniqueDisplayKeys.push(key);
    lastConceptNorm = cNorm;
    lastDetailNorm = dNorm;
  }

  uniqueDisplayKeys.forEach((key, i) => {
    const step = steps[key];
    const timeTag = formatTime(key * STEP_INTERVAL_SECONDS);
    const cId = "C" + (i + 1);

    const rawConcept =
      step.mainConcept &&
      !/^(core\s*concept|core\s*principle|topic\s*\d+|concept)$/i.test(
        step.mainConcept.trim(),
      )
        ? step.mainConcept
        : `${rootTitle} Step ${i + 1}`;
    const concept = formatMermaidNodeText(rawConcept, 32, 60);

    // Strip examples and analogies from detail node so the diagram never contains examples
    const rawDetail = stripExamplesForDiagram(
      step.explanation || step.subBranchB || "",
    );
    const detail = formatMermaidNodeText(rawDetail, 40, 110);

    let cardContent =
      "<b>" + (i + 1) + ". " + concept + " (" + timeTag + ")</b>";
    if (
      detail &&
      detail.toLowerCase() !== "main point" &&
      detail.toLowerCase() !== "supporting detail" &&
      detail.toLowerCase() !== "none"
    ) {
      cardContent += "<br/>" + detail;
    }

    mermaidLines.push(cId + '["' + cardContent + '"]');
    mermaidLines.push("class " + cId + " conceptNode;");

    if (i === 0) {
      mermaidLines.push(
        "" + (isTruncated ? "ROOT -.->|...earlier| " : "ROOT ==> ") + " " + cId,
      );
    } else {
      mermaidLines.push("C" + i + " --> " + cId);
    }
  });

  await renderMermaid(mermaidLines.join("\n"));
}

async function processStepAtTime(currentSeconds, forceRegenerate = false) {
  if (!currentVideoId || isGenerating) return;
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;

  const session = await getCachedSession(currentVideoId);
  if (!session || !session.transcript) return;
  if (session.contentType === "non-educational") {
    showNonEducationalContentMessage();
    return;
  }

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

  const { timeRange, spokenText } = getStepTranscript(
    session,
    completedStepIndex,
  );
  if (!spokenText || spokenText.length < 10) return;

  try {
    isGenerating = true;
    diagramStatus.textContent = `Indexing ${timeRange}...`;

    const newStepData = await generateMultiBranchStep(
      spokenText,
      timeRange,
      session.title || "",
      completedStepIndex,
    );
    steps[completedStepIndex] = newStepData;

    const updatedSession = await saveCachedSession(currentVideoId, { steps });
    await renderProgressiveUI(updatedSession, completedStepIndex);

    if (newStepData.isStudyMaterial === false) {
      diagramStatus.textContent = `Filtered non-study segment (${timeRange})`;
    } else if (newStepData.example) {
      diagramStatus.textContent = `Indexed concept + example (${timeRange})`;
    } else {
      diagramStatus.textContent = `Indexed study concept (${timeRange})`;
    }
  } finally {
    isGenerating = false;
  }
}

async function renderMermaid(code) {
  try {
    mermaidContainer.innerHTML = "";
    const id = "mermaidSvg_" + Date.now();
    const { svg } = await mermaid.render(id, code);
    mermaidContainer.innerHTML = `<div id="mermaidZoomTarget">${svg}</div>`;

    const svgEl = mermaidContainer.querySelector("svg");
    if (svgEl) {
      svgEl.style.maxWidth = "none";
      const viewBox = svgEl.getAttribute("viewBox");
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


// 4. HIGH-RANGE ZOOM (10% TO 800%) + DRAG-TO-PAN + WHEEL ZOOM

function applyZoomAndPan() {
  const target = document.getElementById("mermaidZoomTarget");
  if (target) {
    target.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
  }
  zoomResetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
}

function setZoom(newZoom) {
  currentZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +newZoom.toFixed(2)));
  applyZoomAndPan();
}

zoomInBtn.addEventListener("click", () => {
  const step = currentZoom >= 2.0 ? 0.5 : 0.25;
  setZoom(currentZoom + step);
});

zoomOutBtn.addEventListener("click", () => {
  const step = currentZoom > 2.0 ? 0.5 : 0.2;
  setZoom(currentZoom - step);
});

zoomResetBtn.addEventListener("click", () => {
  currentZoom = 1.0;
  panX = 0;
  panY = 0;
  applyZoomAndPan();
});

mermaidContainer.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(currentZoom * zoomFactor);
  },
  { passive: false },
);

mermaidContainer.addEventListener("mousedown", (e) => {
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
  mermaidContainer.classList.add("dragging");
});

window.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  applyZoomAndPan();
});

window.addEventListener("mouseup", () => {
  isPanning = false;
  mermaidContainer.classList.remove("dragging");
});


// 5. START BUTTON, CONTINUOUS WATCH LOOP & FULLSCREEN LOCK (DIRECT POPUP FIXED)
startStudyBtn.addEventListener("click", async () => {
  const url = ytUrlInput.value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) return alert("Enter a valid YouTube URL.");

  currentVideoId = videoId;
  hasActiveVideo = false;
  isStudying = true;
  lastCompletedStep = -1;
  userEngagedInFullscreen = Boolean(document.fullscreenElement);
  lastSavedSec = -1;
  lastSaveTime = 0;

  document.querySelector(".video-wrapper").classList.remove("is-standby");
  videoStartPlaceholder.classList.add("hidden");

  if (!document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
      userEngagedInFullscreen = true;
    } catch (error) {
      userEngagedInFullscreen = false;
      console.error("Unable to enter fullscreen for study session:", error);
    }
  }
  let session = await getCachedSession(videoId);
  if (
    !session ||
    !session.transcript ||
    typeof session.description !== "string" ||
    session.description.length === 0
  ) {
    cacheBadge.textContent = "Fetching Details...";
    const res = await fetch(`/api/transcript?videoId=${videoId}`);
    const data = await res.json();
    if (!res.ok || !data.transcript) {
      alert(data.error || "Subtitles unavailable for this video.");
      return;
    }
    session = await saveCachedSession(videoId, {
      title: data.title,
      description: data.description || "",
      transcript: data.transcript,
      steps: session?.steps || {},
      noteGenerationVersion: NOTE_GENERATION_VERSION,
      timestamps: session?.timestamps || [],
    });
    await renderCachedVideoPills();
  }

  if (session.noteGenerationVersion !== NOTE_GENERATION_VERSION) {
    session = await saveCachedSession(videoId, {
      steps: {},
      noteGenerationVersion: NOTE_GENERATION_VERSION,
    });
  }

  // When refreshing the tab, always start fresh from the first
  const isReload = isPageReload();
  const urlParams = new URLSearchParams(window.location.search);
  const urlTime = Number(urlParams.get("t"));
  const hasResumeParam =
    urlParams.has("resume") || (Number.isFinite(urlTime) && urlTime > 0);
  let hasTabSession = false;
  try {
    hasTabSession =
      sessionStorage.getItem("reloop_in_tab_" + videoId) === "true";
  } catch {}

  const shouldResume = !isReload && (hasResumeParam || hasTabSession);
  let resumeTime = 0;
  if (shouldResume) {
    if (Number.isFinite(urlTime) && urlTime > 0) {
      resumeTime = urlTime;
    } else if (
      session &&
      typeof session.lastTime === "number" &&
      session.lastTime > 2
    ) {
      resumeTime = session.lastTime;
    }
  }

  const isResuming = shouldResume && resumeTime > 0;

  currentVideoTitle = session?.title || videoId;

  if (isReload) {
    try {
      sessionStorage.removeItem("reloop_in_tab_" + videoId);
      sessionStorage.removeItem("reloop_active_tab_video");
    } catch {}
    if (window.history && window.history.replaceState) {
      window.history.replaceState(
        null,
        "",
        `/focus?videoId=${encodeURIComponent(videoId)}`,
      );
    }
  } else {
    try {
      sessionStorage.setItem("reloop_in_tab_" + videoId, "true");
      sessionStorage.setItem(
        "reloop_active_tab_video",
        JSON.stringify({
          videoId,
          lastTime: isResuming ? resumeTime : 0,
          title: currentVideoTitle,
        }),
      );
    } catch {}
  }

  if (isResuming) {
    pendingStartTime = resumeTime;
    focusSeconds = session?.focusSeconds || Math.floor(resumeTime);
    const mins = String(Math.floor(focusSeconds / 60)).padStart(2, "0");
    const secs = String(focusSeconds % 60).padStart(2, "0");
    focusTimer.textContent = `${mins}:${secs}`;
  } else {
    pendingStartTime = 0;
    focusSeconds = 0;
    focusTimer.textContent = "00:00";
    saveCachedSession(videoId, { lastTime: 0, focusSeconds: 0 }).catch(
      () => {},
    );
    lockOverlay.classList.add("hidden");
  }

  if (player && playerReady && player.loadVideoById) {
    loadStudyVideo(videoId, resumeTime, isResuming);
  }

  const mode = localEngineSelect.value;
  if (mode !== "ollama") {
    ensureWebLLMLoaded(MODELS[mode] || MODELS["webllm-fast"]).catch(() => {});
  }

  if (
    !session.contentType ||
    session.classificationVersion !== CLASSIFICATION_VERSION
  ) {
    const classification = await classifyVideoWithLLM(session);
    const contentType = classification.isEducational
      ? "educational"
      : "non-educational";
    session = await saveCachedSession(videoId, {
      contentType,
      classificationVersion: CLASSIFICATION_VERSION,
    });
  }

  if (session.contentType === "non-educational") {
    showNonEducationalContentMessage();
    diagramStatus.textContent = "Notes unavailable for this content";
    if (chaptersTimelineSection) {
      chaptersTimelineSection.classList.add("hidden");
    }
    return;
  }

  if (chaptersTimelineSection) {
    chaptersTimelineSection.classList.remove("hidden");
  }

  currentTimestamps = session.timestamps || [];
  renderTimestampsList();

  videoChapters = extractChaptersFromSession(session);
  const dur =
    player && typeof player.getDuration === "function"
      ? player.getDuration()
      : 0;
  if (dur > 0) {
    lastRenderedDuration = dur;
    renderChaptersTimeline(dur);
  }

  const completedStep =
    isResuming && resumeTime > 0
      ? Math.floor(resumeTime / STEP_INTERVAL_SECONDS) - 1
      : -1;
  lastCompletedStep = completedStep;

  await renderProgressiveUI(session, completedStep);
  if (session.contentType === "non-educational") {
    diagramStatus.textContent = "Notes unavailable for this content";
  } else if (completedStep >= 0) {
    diagramStatus.textContent = `Resumed at ${formatTime(resumeTime)} (Synced up to ${formatTime((completedStep + 1) * STEP_INTERVAL_SECONDS)})`;
  } else if (resumeTime > 0) {
    diagramStatus.textContent = `Resumed at ${formatTime(resumeTime)}`;
  } else {
    diagramStatus.textContent = `Ready: 0:00 - 0:${STEP_INTERVAL_SECONDS}`;
  }

  // Pre-index step 0 immediately so the user immediately gets the initial concept node and notes
  if (
    !isResuming &&
    session.contentType !== "non-educational" &&
    session.transcript &&
    session.transcript.length > 0
  ) {
    processStepAtTime(0, true).catch(() => {});
  }

  if (isResuming) {
    triggerFocusInterrupt("Active tab lost focus.", true);
  }
});

const requestedVideoId = new URLSearchParams(window.location.search).get(
  "videoId",
);
if (requestedVideoId) {
  if (isYouTubeVideoId(requestedVideoId)) {
    ytUrlInput.value = normalizeYouTubeUrl(requestedVideoId);
    startStudyBtn.click();
  } else {
    alert(
      "That YouTube video link is invalid. Enter a valid link to start a session.",
    );
  }
}

refreshDiagramBtn.addEventListener("click", async () => {
  if (!currentVideoId || !player || typeof player.getCurrentTime !== "function")
    return;
  const currentSec = player.getCurrentTime();
  if (Number.isFinite(currentSec)) {
    await processStepAtTime(currentSec, true);
  }
});

setInterval(() => {
  if (!isStudying || !player || typeof player.getCurrentTime !== "function")
    return;

  if (player.getPlayerState && player.getPlayerState() === 1) {
    focusSeconds += 1;
    const mins = String(Math.floor(focusSeconds / 60)).padStart(2, "0");
    const secs = String(focusSeconds % 60).padStart(2, "0");
    focusTimer.textContent = `${mins}:${secs}`;

    const currentSec = player.getCurrentTime();
    if (!Number.isFinite(currentSec) || currentSec < 0) return;

    savePlaybackState(false);

    const completedStep = Math.floor(currentSec / STEP_INTERVAL_SECONDS) - 1;
    const nextStepSec = (completedStep + 2) * STEP_INTERVAL_SECONDS;
    const secsRemaining = Math.max(0, Math.ceil(nextStepSec - currentSec));

    if (!isGenerating && completedStep < 0) {
      diagramStatus.textContent = `Next index in ${secsRemaining}s`;
    }

    if (
      completedStep >= 0 &&
      completedStep !== lastCompletedStep &&
      !isGenerating
    ) {
      lastCompletedStep = completedStep;
      processStepAtTime(currentSec, false);
    }
  }
}, 1000);

// Popup trigger function: Sirf aur sirf tab chalega jab active study ho aur user fullscreen se bahar nikle
function triggerFocusInterrupt(reason, allowBeforeFullscreen = false) {
  if (
    !isStudying ||
    (!allowBeforeFullscreen && (!hasActiveVideo || !userEngagedInFullscreen))
  )
    return;
  syncActiveTabSession();
  savePlaybackState(true);
  if (player && typeof player.pauseVideo === "function") player.pauseVideo();
  const motivationText = document.getElementById("motivationText");
  if (motivationText) {
    motivationText.textContent = `${reason} Return to fullscreen to continue your active study session.`;
  }
  if (lockOverlay) {
    lockOverlay.classList.remove("hidden");
  }
}

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    userEngagedInFullscreen = true;
    if (lockOverlay) lockOverlay.classList.add("hidden");
  } else {
    if (isStudying && userEngagedInFullscreen) {
      triggerFocusInterrupt("Fullscreen mode was exited.");
      userEngagedInFullscreen = false;
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (isStudying && document.hidden && userEngagedInFullscreen) {
    triggerFocusInterrupt("Active tab lost focus.");
  }
});

if (resumeFocusBtn) {
  resumeFocusBtn.onclick = async () => {
    try {
      await document.documentElement.requestFullscreen();
      userEngagedInFullscreen = true;
    } catch (error) {
      userEngagedInFullscreen = false;
      console.error("Unable to resume fullscreen study session:", error);
      return;
    }
    if (player && pendingStartTime > 0 && typeof player.seekTo === "function") {
      player.seekTo(pendingStartTime, true);
      pendingStartTime = 0;
    }
    if (lockOverlay) {
      lockOverlay.classList.add("hidden");
    }
    if (player && typeof player.playVideo === "function") {
      player.playVideo();
    }
  };
}

// ============================================================================
// 6. TIMESTAMPS CREATION & MANAGEMENT
// ============================================================================
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
        No timestamps added yet. Press <strong>T</strong> while watching to bookmark moments.
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
    `,
    )
    .join("");

  timestampsList.querySelectorAll(".timestamp-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".timestamp-delete-btn")) return;
      const targetTime = Number(item.dataset.time);
      if (
        Number.isFinite(targetTime) &&
        player &&
        typeof player.seekTo === "function"
      ) {
        player.seekTo(targetTime, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    });
  });

  timestampsList.querySelectorAll(".timestamp-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idToDelete = btn.dataset.deleteId;
      const deletedIndex = currentTimestamps.findIndex(
        (stamp) => stamp.id === idToDelete,
      );
      const listScrollTop = timestampsList.scrollTop;
      currentTimestamps = currentTimestamps.filter((s) => s.id !== idToDelete);
      renderTimestampsList();
      timestampsList.scrollTop = listScrollTop;
      const remainingDeleteButtons = timestampsList.querySelectorAll(
        ".timestamp-delete-btn",
      );
      remainingDeleteButtons[
        Math.min(deletedIndex, remainingDeleteButtons.length - 1)
      ]?.focus({ preventScroll: true });
      if (currentVideoId) {
        await saveCachedSession(currentVideoId, {
          timestamps: currentTimestamps,
        });
      }
    });
  });
}

async function addTimestamp(sec, title = "") {
  if (!Number.isFinite(sec) || sec < 0) return;
  const safeSec = Math.floor(sec);
  const safeTitle =
    (title || "").trim() || `Key Moment (${formatTime(safeSec)})`;

  const newStamp = {
    id: `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: safeSec,
    title: safeTitle,
    createdAt: Date.now(),
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

  timestampsList.querySelectorAll(".timestamp-item").forEach((item) => {
    const isThisActive = activeStamp && item.dataset.id === activeStamp.id;
    item.classList.toggle("active", !!isThisActive);
  });
}

function initTimestamps() {
  if (timestampForm) {
    timestampForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const curTime =
        player && typeof player.getCurrentTime === "function"
          ? player.getCurrentTime()
          : 0;
      const note = timestampTitleInput ? timestampTitleInput.value : "";
      addTimestamp(curTime, note);
      if (timestampTitleInput) timestampTitleInput.value = "";
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "t" || e.key === "T") {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable)
      ) {
        return;
      }
      if (player && typeof player.getCurrentTime === "function") {
        const curTime = player.getCurrentTime();
        if (Number.isFinite(curTime)) {
          addTimestamp(curTime, "");
        }
      }
    }
  });

  renderTimestampsList();
}

// ============================================================================
// 7. RESIZABLE WORKSPACE & SIDE INSPECTOR TABS (50%-50% & Full-View Logic)
// ============================================================================
function initResizableWorkspace() {
  const inspectorTopWrapper = document.getElementById("inspectorTopWrapper");
  const closeBtn = document.getElementById("closeInspectorBtn");

  if (!sideInspector || !inspectorTopWrapper) return;

  const savedWidth = localStorage.getItem("reloop_side_width");
  if (savedWidth) {
    const w = Math.max(
      280,
      Math.min(window.innerWidth * 0.7, parseInt(savedWidth, 10)),
    );
    sideInspector.style.width = `${w}px`;
    sideInspector.style.setProperty("--side-panel-width", `${w}px`);
  }

  const savedTopRatio = localStorage.getItem("reloop_inspector_top_ratio");
  if (savedTopRatio) {
    const ratio = Math.max(15, Math.min(85, parseFloat(savedTopRatio)));
    if (Number.isFinite(ratio)) {
      sideInspector.style.setProperty("--inspector-top-height", `${ratio}%`);
    }
  }

  // Right sidebar hamesha open rahega taaki Timestamps 100% display ho
  sideInspector.classList.remove("collapsed");
  if (workspaceResizer) workspaceResizer.classList.remove("collapsed");

  // Start me Top section closed rahega
  closeTopSection();

  function openTopSection(tabName) {
    activeInspectorTab = tabName;
    inspectorTopWrapper.classList.remove("hidden");

    if (inspectorTitle) {
      inspectorTitle.textContent =
        tabName === "diagram" ? "CONCEPT ARCHITECTURE" : "LECTURE NOTES";
    }
    if (tabContentNotes)
      tabContentNotes.classList.toggle("active", tabName === "notes");
    if (tabContentDiagram)
      tabContentDiagram.classList.toggle("active", tabName === "diagram");

    if (toggleNotesBtn)
      toggleNotesBtn.classList.toggle("active", tabName === "notes");
    if (toggleDiagramBtn)
      toggleDiagramBtn.classList.toggle("active", tabName === "diagram");

    if (tabName === "diagram") {
      setTimeout(applyZoomAndPan, 60);
    }
  }

  function closeTopSection() {
    activeInspectorTab = null;
    inspectorTopWrapper.classList.add("hidden");

    if (toggleNotesBtn) toggleNotesBtn.classList.remove("active");
    if (toggleDiagramBtn) toggleDiagramBtn.classList.remove("active");
  }

  function toggleTopSection(tabName) {
    const isAlreadyOpen = !inspectorTopWrapper.classList.contains("hidden");
    if (isAlreadyOpen && activeInspectorTab === tabName) {
      closeTopSection();
    } else {
      openTopSection(tabName);
    }
  }

  if (toggleNotesBtn) {
    toggleNotesBtn.onclick = (e) => {
      e.preventDefault();
      toggleTopSection("notes");
    };
  }

  if (toggleDiagramBtn) {
    toggleDiagramBtn.onclick = (e) => {
      e.preventDefault();
      toggleTopSection("diagram");
    };
  }

  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTopSection();
    };
  }

  // Resizer bar dragging logic
  if (workspaceResizer) {
    let isResizing = false;

    workspaceResizer.addEventListener("pointerdown", (e) => {
      isResizing = true;
      sideInspector.classList.add("is-dragging");
      workspaceResizer.classList.add("is-dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      workspaceResizer.setPointerCapture(e.pointerId);
    });

    window.addEventListener("pointermove", (e) => {
      if (!isResizing) return;
      const container = document.getElementById("workspaceContainer");
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const newWidth = Math.max(
        280,
        Math.min(containerRect.width * 0.75, containerRect.right - e.clientX),
      );
      sideInspector.style.width = `${newWidth}px`;
      sideInspector.style.setProperty("--side-panel-width", `${newWidth}px`);
    });

    window.addEventListener("pointerup", () => {
      if (!isResizing) return;
      isResizing = false;
      sideInspector.classList.remove("is-dragging");
      workspaceResizer.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const currentW = parseInt(sideInspector.style.width, 10);
      if (currentW > 0) {
        localStorage.setItem("reloop_side_width", currentW);
      }
    });

    workspaceResizer.addEventListener("dblclick", () => {
      const defaultW = 450;
      sideInspector.style.width = `${defaultW}px`;
      sideInspector.style.setProperty("--side-panel-width", `${defaultW}px`);
      localStorage.setItem("reloop_side_width", defaultW);
    });
  }

  // Horizontal Section Resizer dragging logic (between Top Notes/Map and Bottom Timestamps)
  if (inspectorSectionResizer) {
    let isVerticalResizing = false;

    inspectorSectionResizer.addEventListener("pointerdown", (e) => {
      if (inspectorTopWrapper.classList.contains("hidden")) return;

      isVerticalResizing = true;
      sideInspector.classList.add("is-dragging-vertical");
      inspectorSectionResizer.classList.add("is-dragging");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      inspectorSectionResizer.setPointerCapture(e.pointerId);
    });

    window.addEventListener("pointermove", (e) => {
      if (!isVerticalResizing) return;
      const inspectorRect = sideInspector.getBoundingClientRect();
      if (inspectorRect.height <= 0) return;

      const rawHeight = e.clientY - inspectorRect.top;
      // Allow comfortable range: min 120px for top, min 100px for timestamps
      const clampedHeight = Math.max(
        120,
        Math.min(inspectorRect.height - 100, rawHeight),
      );
      const ratio = (clampedHeight / inspectorRect.height) * 100;

      sideInspector.style.setProperty(
        "--inspector-top-height",
        `${ratio.toFixed(2)}%`,
      );

      if (activeInspectorTab === "diagram") {
        applyZoomAndPan();
      }
    });

    window.addEventListener("pointerup", () => {
      if (!isVerticalResizing) return;
      isVerticalResizing = false;
      sideInspector.classList.remove("is-dragging-vertical");
      inspectorSectionResizer.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const currentVal = sideInspector.style.getPropertyValue(
        "--inspector-top-height",
      );
      if (currentVal) {
        localStorage.setItem(
          "reloop_inspector_top_ratio",
          parseFloat(currentVal),
        );
      }
    });

    inspectorSectionResizer.addEventListener("dblclick", () => {
      sideInspector.style.setProperty("--inspector-top-height", "50%");
      localStorage.removeItem("reloop_inspector_top_ratio");
      if (activeInspectorTab === "diagram") {
        applyZoomAndPan();
      }
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
  const desc = session.description || "";

  const lines = desc.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(
      /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\s*[-–—~to]+\s*(?:(?:\d{1,2}):)?\d{1,2}:\d{2})?\s*[-–—~|•:\s]+(.+)$/i,
    );
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const totalSec = hours * 3600 + minutes * 60 + seconds;
      let label = match[4].replace(/^[-–—~|•:\s]+/, "").trim();
      label = label.replace(/[-–—~|•:\s]+$/, "").trim();
      if (isNonEnglishScript(label)) {
        label = `Topic ${chapters.length + 1}`;
      }
      if (
        label.length > 1 &&
        !chapters.some((c) => Math.abs(c.time - totalSec) < 3)
      ) {
        chapters.push({ time: totalSec, title: label });
      }
    }
  }

  if (chapters.length >= 2) {
    chapters.sort((a, b) => a.time - b.time);
    return chapters;
  }

  const transcript = session.transcript || [];
  if (transcript.length > 0) {
    const lastItem = transcript[transcript.length - 1];
    const totalDuration = lastItem.offset + (lastItem.duration || 10);
    const partsCount = totalDuration > 1200 ? 4 : totalDuration > 300 ? 3 : 2;
    const stepDuration = Math.floor(totalDuration / partsCount);

    chapters.push({ time: 0, title: "Introduction" });
    for (let p = 1; p < partsCount; p++) {
      const targetTime = p * stepDuration;
      const nearestLine = transcript.find((l) => l.offset >= targetTime);
      const actualTime = nearestLine
        ? Math.floor(nearestLine.offset)
        : targetTime;
      const rawText = nearestLine
        ? (nearestLine.text || "").replace(/\[.*?\]|\(.*?\)/g, "").trim()
        : "";
      const words = rawText.split(/\s+/).filter((w) => w.length > 2);
      const topicSnippet = words.slice(0, 4).join(" ");
      const cleanSnippet =
        topicSnippet.length > 3 && !isNonEnglishScript(topicSnippet)
          ? cleanConceptPhrase(topicSnippet, 4)
          : `Part ${p + 1}`;
      chapters.push({
        time: actualTime,
        title: cleanSnippet.charAt(0).toUpperCase() + cleanSnippet.slice(1),
      });
    }
  } else {
    chapters.push({ time: 0, title: "Introduction" });
  }

  chapters.sort((a, b) => a.time - b.time);
  return chapters;
}

function renderChaptersTimeline(duration) {
  if (!chapterMarkersContainer || !chapterPillsRow) return;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;

  if (chaptersCountBadge) {
    chaptersCountBadge.textContent = `${videoChapters.length} ${videoChapters.length === 1 ? "topic" : "topics"}`;
  }

  chapterMarkersContainer.innerHTML = videoChapters
    .map((chapter, index) => {
      const leftPct = Math.min(
        99.5,
        Math.max(0.5, (chapter.time / safeDuration) * 100),
      );
      return `
        <div class="chapter-marker-point"
             data-index="${index}"
             data-time="${chapter.time}"
             data-tooltip="${formatTime(chapter.time)} - ${escapeHtml(chapter.title)}"
             style="left: ${leftPct.toFixed(2)}%;">
        </div>
      `;
    })
    .join("");

  chapterPillsRow.innerHTML = videoChapters
    .map(
      (chapter, index) => `
      <button class="chapter-pill" type="button" data-index="${index}" data-time="${chapter.time}">
        <span class="chapter-pill-time">${formatTime(chapter.time)}</span>
        <span class="chapter-pill-title">${escapeHtml(chapter.title)}</span>
      </button>
    `,
    )
    .join("");

  chapterMarkersContainer
    .querySelectorAll(".chapter-marker-point")
    .forEach((point) => {
      point.addEventListener("click", (e) => {
        e.stopPropagation();
        const time = Number(point.dataset.time);
        if (
          Number.isFinite(time) &&
          player &&
          typeof player.seekTo === "function"
        ) {
          player.seekTo(time, true);
          if (player.getPlayerState && player.getPlayerState() !== 1) {
            player.playVideo();
          }
        }
      });
    });

  chapterPillsRow.querySelectorAll(".chapter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const time = Number(pill.dataset.time);
      if (
        Number.isFinite(time) &&
        player &&
        typeof player.seekTo === "function"
      ) {
        player.seekTo(time, true);
        if (player.getPlayerState && player.getPlayerState() !== 1) {
          player.playVideo();
        }
      }
    });
  });
}

function updateChaptersProgress(currentTime, duration) {
  if (!chapterTrackProgress || !Number.isFinite(duration) || duration <= 0)
    return;
  const progressPct = Math.min(
    100,
    Math.max(0, (currentTime / duration) * 100),
  );
  chapterTrackProgress.style.width = `${progressPct}%`;

  if (videoChapters.length === 0) return;

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

  if (chapterMarkersContainer) {
    chapterMarkersContainer
      .querySelectorAll(".chapter-marker-point")
      .forEach((point) => {
        const pTime = Number(point.dataset.time);
        const isPassed = pTime <= currentTime;
        const isActive = Number(point.dataset.index) === activeIndex;
        point.classList.toggle("passed", isPassed);
        point.classList.toggle("active", isActive);
      });
  }

  if (chapterPillsRow) {
    chapterPillsRow.querySelectorAll(".chapter-pill").forEach((pill) => {
      const isActive = Number(pill.dataset.index) === activeIndex;
      pill.classList.toggle("active", isActive);
    });
  }
}

if (chapterTrackWrapper) {
  chapterTrackWrapper.addEventListener("click", (e) => {
    if (e.target.closest(".chapter-marker-point")) return;
    const rect = chapterTrackWrapper.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    if (player && typeof player.getDuration === "function") {
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
