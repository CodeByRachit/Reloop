import { extractYouTubeVideoId, normalizeYouTubeUrl } from './youtube.js';

const videoForm = document.getElementById('videoForm');
const videoUrlInput = document.getElementById('videoUrl');
const startLearningButton = document.getElementById('startLearning');
const clearUrlButton = document.getElementById('clearUrl');
const formMessage = document.getElementById('formMessage');
const recentSessionsContainer = document.getElementById('recentSessions');
let isNavigating = false;

function updateClearButton() {
  if (clearUrlButton) {
    clearUrlButton.hidden = !videoUrlInput.value.trim();
  }
}

function resetNavigationState() {
  isNavigating = false;
  startLearningButton.classList.remove('is-loading');
  startLearningButton.removeAttribute('aria-busy');

  if (formMessage.textContent.startsWith('Opening your study space')) {
    formMessage.textContent = '';
  }

  const hasValue = Boolean(videoUrlInput.value.trim());
  startLearningButton.disabled = !hasValue;
  updateClearButton();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResumeSession(isReloadEvent = false) {
  if (!recentSessionsContainer) return;

  if (isReloadEvent) {
    try {
      sessionStorage.removeItem('reloop_active_tab_video');
    } catch {}
    recentSessionsContainer.innerHTML = '';
    return;
  }

  let activeData = null;
  try {
    const raw = sessionStorage.getItem('reloop_active_tab_video');
    if (raw) activeData = JSON.parse(raw);
  } catch {}

  // If no active in-progress video in this tab, do NOT display
  if (!activeData || !activeData.videoId) {
    recentSessionsContainer.innerHTML = '';
    return;
  }

  const rawTitle = activeData.title || activeData.videoId;
  const displayTitle = rawTitle.length > 28 ? rawTitle.slice(0, 26) + '…' : rawTitle;

  recentSessionsContainer.innerHTML = `
    <span class="recent-label">RESUME SESSION:</span>
    <button type="button" class="recent-pill" data-video-id="${escapeHtml(activeData.videoId)}" title="${escapeHtml(rawTitle)}">
      <svg viewBox="0 0 24 24" class="recent-play-icon" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>
      <span>${escapeHtml(displayTitle)}</span>
    </button>
  `;

  const btn = recentSessionsContainer.querySelector('.recent-pill');
  if (btn) {
    btn.addEventListener('click', () => {
      videoUrlInput.value = normalizeYouTubeUrl(activeData.videoId);
      updateClearButton();
      resetNavigationState();
      videoForm.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }
}

videoUrlInput.addEventListener('input', () => {
  updateClearButton();
  startLearningButton.disabled = !videoUrlInput.value.trim() || isNavigating;
  if (formMessage.textContent) {
    formMessage.textContent = '';
    formMessage.classList.remove('is-error');
    videoUrlInput.removeAttribute('aria-invalid');
  }
});

if (clearUrlButton) {
  clearUrlButton.addEventListener('click', () => {
    videoUrlInput.value = '';
    updateClearButton();
    startLearningButton.disabled = true;
    if (formMessage.textContent) {
      formMessage.textContent = '';
      formMessage.classList.remove('is-error');
      videoUrlInput.removeAttribute('aria-invalid');
    }
    videoUrlInput.focus();
  });
}

videoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (isNavigating) return;

  const videoId = extractYouTubeVideoId(videoUrlInput.value);
  if (!videoId) {
    formMessage.textContent = 'Enter a valid YouTube link, such as youtube.com/watch?v=…';
    formMessage.classList.add('is-error');
    videoUrlInput.setAttribute('aria-invalid', 'true');
    videoUrlInput.focus();
    return;
  }

  videoUrlInput.value = normalizeYouTubeUrl(videoId);
  updateClearButton();
  isNavigating = true;
  startLearningButton.disabled = true;
  startLearningButton.classList.add('is-loading');
  startLearningButton.setAttribute('aria-busy', 'true');
  formMessage.textContent = 'Opening your study space…';
  formMessage.classList.remove('is-error');

  // Check if this video is currently active in this tab
  let isTabResume = false;
  let resumeTime = 0;
  try {
    const raw = sessionStorage.getItem('reloop_active_tab_video');
    if (raw) {
      const activeData = JSON.parse(raw);
      if (activeData && activeData.videoId === videoId) {
        isTabResume = true;
        resumeTime = activeData.lastTime || 0;
      }
    }
  } catch {}

  const startParam = isTabResume && resumeTime > 0 ? `&resume=1&t=${Math.floor(resumeTime)}` : (isTabResume ? '&resume=1' : '');
  window.location.assign(`/focus?videoId=${encodeURIComponent(videoId)}${startParam}`);
});

// Restore form state when navigating backward/forward via browser history (bfcache)
window.addEventListener('pageshow', (event) => {
  resetNavigationState();

  const isBfCache = Boolean(event.persisted);
  const navType = performance.getEntriesByType('navigation')[0]?.type;
  const isBackForward = navType === 'back_forward';
  const isTrueReload = !isBfCache && !isBackForward && navType === 'reload';

  renderResumeSession(isTrueReload);
});

window.addEventListener('popstate', () => {
  resetNavigationState();
  renderResumeSession(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resetNavigationState();
    renderResumeSession(false);
  }
});

const returnToInput = document.getElementById('returnToInput');
if (returnToInput) {
  returnToInput.addEventListener('click', () => {
    videoForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => videoUrlInput.focus({ preventScroll: true }), 350);
  });
}

const copyrightYear = document.getElementById('copyrightYear');
if (copyrightYear) {
  copyrightYear.textContent = String(new Date().getFullYear());
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.documentElement.classList.add('reveal-ready');
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));
}
