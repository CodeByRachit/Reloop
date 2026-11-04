import { extractYouTubeVideoId, normalizeYouTubeUrl } from './youtube.js';

const videoForm = document.getElementById('videoForm');
const videoUrlInput = document.getElementById('videoUrl');
const startLearningButton = document.getElementById('startLearning');
const formMessage = document.getElementById('formMessage');
let isNavigating = false;

videoUrlInput.addEventListener('input', () => {
  startLearningButton.disabled = !videoUrlInput.value.trim() || isNavigating;
  if (formMessage.textContent) {
    formMessage.textContent = '';
    formMessage.classList.remove('is-error');
    videoUrlInput.removeAttribute('aria-invalid');
  }
});

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
  isNavigating = true;
  startLearningButton.disabled = true;
  startLearningButton.classList.add('is-loading');
  startLearningButton.setAttribute('aria-busy', 'true');
  formMessage.textContent = 'Opening your study space…';
  formMessage.classList.remove('is-error');
  window.location.assign(`/focus?videoId=${encodeURIComponent(videoId)}`);
});

document.getElementById('returnToInput').addEventListener('click', () => {
  videoForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => videoUrlInput.focus({ preventScroll: true }), 350);
});

document.getElementById('copyrightYear').textContent = String(new Date().getFullYear());

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
