import { extractYouTubeVideoId, normalizeYouTubeUrl } from "./youtube.js";

const videoForm = document.getElementById("videoForm");
const videoUrlInput = document.getElementById("videoUrl");
const startLearningButton = document.getElementById("startLearning");
const clearUrlButton = document.getElementById("clearUrl");
const formMessage = document.getElementById("formMessage");
const recentSessionsContainer = document.getElementById("recentSessions");
let isNavigating = false;

function updateClearButton() {
  if (clearUrlButton && videoUrlInput) {
    clearUrlButton.hidden = !videoUrlInput.value.trim();
  }
}

function resetNavigationState() {
  isNavigating = false;
  if (startLearningButton) {
    startLearningButton.classList.remove("is-loading");
    startLearningButton.removeAttribute("aria-busy");
  }

  if (formMessage && formMessage.textContent.startsWith("Opening your study space")) {
    formMessage.textContent = "";
  }

  if (startLearningButton && videoUrlInput) {
    startLearningButton.disabled = !videoUrlInput.value.trim();
  }
  updateClearButton();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResumeSession(isReloadEvent = false) {
  if (!recentSessionsContainer) return;

  if (isReloadEvent) {
    try {
      sessionStorage.removeItem("reloop_active_tab_video");
    } catch {}
    recentSessionsContainer.innerHTML = "";
    return;
  }

  let activeData = null;
  try {
    const raw = sessionStorage.getItem("reloop_active_tab_video");
    if (raw) activeData = JSON.parse(raw);
  } catch {}

  // If no active in-progress video in this tab, do NOT display
  if (!activeData || !activeData.videoId) {
    recentSessionsContainer.innerHTML = "";
    return;
  }

  const rawTitle = activeData.title || activeData.videoId;
  const displayTitle = rawTitle.length > 28 ? rawTitle.slice(0, 26) + "…" : rawTitle;

  recentSessionsContainer.innerHTML = `
    <span class="recent-label">RESUME SESSION:</span>
    <button type="button" class="recent-pill" data-video-id="${escapeHtml(activeData.videoId)}" title="${escapeHtml(rawTitle)}">
      <svg viewBox="0 0 24 24" class="recent-play-icon" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>
      <span>${escapeHtml(displayTitle)}</span>
    </button>
  `;

  const btn = recentSessionsContainer.querySelector(".recent-pill");
  if (btn && videoUrlInput && videoForm) {
    btn.addEventListener("click", () => {
      videoUrlInput.value = normalizeYouTubeUrl ? normalizeYouTubeUrl(activeData.videoId) : `https://youtu.be/${activeData.videoId}`;
      updateClearButton();
      resetNavigationState();
      videoForm.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  }
}

if (videoForm && videoUrlInput && startLearningButton) {
  videoUrlInput.addEventListener("input", () => {
    updateClearButton();
    startLearningButton.disabled = !videoUrlInput.value.trim() || isNavigating;
    videoUrlInput.removeAttribute("aria-invalid");
    if (formMessage) {
      formMessage.textContent = "";
      formMessage.classList.remove("is-error");
    }
  });

  if (clearUrlButton) {
    clearUrlButton.addEventListener("click", () => {
      videoUrlInput.value = "";
      updateClearButton();
      startLearningButton.disabled = true;
      if (formMessage) {
        formMessage.textContent = "";
        formMessage.classList.remove("is-error");
      }
      videoUrlInput.focus();
    });
  }

  videoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isNavigating) return;

    const enteredValue = videoUrlInput.value.trim();
    const videoId = extractYouTubeVideoId(enteredValue);
    if (!videoId) {
      if (formMessage) {
        formMessage.textContent = enteredValue
          ? "Please enter a valid YouTube video link."
          : "Please enter a video link.";
        formMessage.classList.add("is-error");
      }
      videoUrlInput.setAttribute("aria-invalid", "true");
      videoUrlInput.focus();
      return;
    }

    if (normalizeYouTubeUrl) {
      videoUrlInput.value = normalizeYouTubeUrl(videoId);
    }
    updateClearButton();
    isNavigating = true;
    startLearningButton.disabled = true;
    startLearningButton.classList.add("is-loading");
    startLearningButton.setAttribute("aria-busy", "true");
    if (formMessage) {
      formMessage.textContent = "Opening your study space...";
      formMessage.classList.remove("is-error");
    }

    // Check if this video is currently active in this tab
    let isTabResume = false;
    let resumeTime = 0;
    try {
      const raw = sessionStorage.getItem("reloop_active_tab_video");
      if (raw) {
        const activeData = JSON.parse(raw);
        if (activeData && activeData.videoId === videoId) {
          isTabResume = true;
          resumeTime = activeData.lastTime || 0;
        }
      }
    } catch {}

    const destination = new URL("/focus", window.location.origin);
    destination.searchParams.set("videoId", videoId);
    if (isTabResume && resumeTime > 0) {
      destination.searchParams.set("resume", "1");
      destination.searchParams.set("t", String(Math.floor(resumeTime)));
    } else if (isTabResume) {
      destination.searchParams.set("resume", "1");
    }
    window.location.assign(destination.pathname + destination.search);
  });
}

// Restore form state when navigating backward/forward via browser history (bfcache)
window.addEventListener("pageshow", (event) => {
  resetNavigationState();

  const isBfCache = Boolean(event.persisted);
  const navType = performance.getEntriesByType("navigation")[0]?.type;
  const isBackForward = navType === "back_forward";
  const isTrueReload = !isBfCache && !isBackForward && navType === "reload";

  renderResumeSession(isTrueReload);
});

window.addEventListener("popstate", () => {
  resetNavigationState();
  renderResumeSession(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    resetNavigationState();
    renderResumeSession(false);
  }
});

document.querySelectorAll("[data-go-to-focus]").forEach((link) => {
  link.addEventListener("click", () => window.location.assign("/focus"));
});

const returnToInput = document.getElementById("returnToInput");
if (returnToInput && videoForm && videoUrlInput) {
  returnToInput.addEventListener("click", () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    videoForm.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    window.setTimeout(() => videoUrlInput.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
  });
}

const copyrightYear = document.getElementById("copyrightYear");
if (copyrightYear) copyrightYear.textContent = String(new Date().getFullYear());

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealElements = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !prefersReducedMotion) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -35px 0px" });

  document.documentElement.classList.add("reveal-ready");
  revealElements.forEach((element) => revealObserver.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

document.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", (event) => {
    const targetId = link.getAttribute("href");
    if (!targetId || !targetId.startsWith("#")) return;

    const target = document.querySelector(targetId);
    if (!target) return;

    event.preventDefault();
    window.history.pushState(null, "", targetId);
    target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  });
});
