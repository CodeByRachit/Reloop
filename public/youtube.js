const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be'
]);

export function isYouTubeVideoId(value) {
  return VIDEO_ID_PATTERN.test(value);
}

export function extractYouTubeVideoId(input) {
  if (typeof input !== 'string' || !input.trim()) return null;

  let url;
  try {
    const normalizedInput = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`;
    url = new URL(normalizedInput);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  let videoId = null;
  const segments = url.pathname.split('/').filter(Boolean);

  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    videoId = segments[0];
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else if (['embed', 'shorts', 'live', 'v'].includes(segments[0])) {
    videoId = segments[1];
  }

  return videoId && isYouTubeVideoId(videoId) ? videoId : null;
}

export function normalizeYouTubeUrl(videoId) {
  if (!isYouTubeVideoId(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}
