import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YoutubeTranscript } from 'youtube-transcript';
import { getSubtitles, getVideoDetails } from 'youtube-caption-extractor';

const app = express();
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'landing.html'));
});

app.get('/focus', (req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.use(express.static(publicDirectory));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function fetchFromHtmlScrape(videoId) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await pageRes.text();
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) return null;
  const tracks = JSON.parse(match[1]);
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const track = tracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || tracks[0];
  if (!track || !track.baseUrl) return null;

  const xmlRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });
  const xml = await xmlRes.text();
  if (!xml || xml.length < 20) return null;

  const lines = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const text = m[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (text) {
      lines.push({
        offset: Math.floor(parseFloat(m[1])),
        duration: Math.round(parseFloat(m[2]) * 10) / 10,
        text
      });
    }
  }
  return lines.length > 0 ? lines : null;
}

async function extractTranscript(videoId) {
  // Strategy 1: YoutubeTranscript (InnerTube Android client + Web scraping fallback)
  try {
    const res = await YoutubeTranscript.fetchTranscript(videoId);
    if (res && res.length > 0) {
      return res.map(item => ({
        offset: Math.floor((item.offset || 0) / 1000),
        duration: Math.round(((item.duration || 0) / 1000) * 10) / 10,
        text: (item.text || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
      }));
    }
  } catch (err) {
    console.warn(`[Transcript] Strategy 1 (youtube-transcript) failed for ${videoId}:`, err.message);
  }

  // Strategy 2: Direct HTML watch page scraping with User-Agent
  try {
    const res = await fetchFromHtmlScrape(videoId);
    if (res && res.length > 0) {
      return res;
    }
  } catch (err) {
    console.warn(`[Transcript] Strategy 2 (HTML scrape) failed for ${videoId}:`, err.message);
  }

  // Strategy 3: youtube-caption-extractor
  try {
    let subtitles = await getSubtitles({ videoID: videoId, lang: 'en' });
    if (!subtitles || subtitles.length === 0) {
      subtitles = await getSubtitles({ videoID: videoId, lang: 'hi' });
    }
    if (!subtitles || subtitles.length === 0) {
      subtitles = await getSubtitles({ videoID: videoId });
    }
    if (subtitles && subtitles.length > 0) {
      return subtitles.map(item => ({
        offset: Math.floor(parseFloat(item.start || 0)),
        duration: parseFloat(item.dur || 0),
        text: item.text
      }));
    }
  } catch (err) {
    console.warn(`[Transcript] Strategy 3 (youtube-caption-extractor) failed for ${videoId}:`, err.message);
  }

  return [];
}

async function extractMetadata(videoId) {
  let title = 'YouTube Lecture';
  let description = '';

  // 1. Official YouTube oEmbed API (always reliable, never blocked on cloud datacenters)
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      if (oembedData.title) {
        title = oembedData.title;
      }
    }
  } catch {}

  // 2. Try getVideoDetails for description
  try {
    const details = await getVideoDetails({ videoID: videoId, lang: 'en' });
    if (details?.title && title === 'YouTube Lecture') title = details.title;
    if (details?.description) description = details.description;
  } catch {}

  return { title, description };
}

// 1. REAL YouTube Transcript + Video Details Extractor
app.get('/api/transcript', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  try {
    const [{ title, description }, transcript] = await Promise.all([
      extractMetadata(videoId),
      extractTranscript(videoId)
    ]);

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({
        error: 'YouTube captions could not be retrieved for this video. YouTube may be restricting cloud requests or this video has no captions enabled.',
        title,
        description
      });
    }

    console.log(`✅ Extracted ${transcript.length} caption lines for: "${title}" (${videoId})`);
    res.json({ title, description, transcript });
  } catch (err) {
    console.error('❌ Transcript route error:', err.message);
    res.status(500).json({
      error: 'Unable to retrieve transcript from YouTube at this moment. Please try again shortly.'
    });
  }
});

// 2. Local Ollama Route (if you select Local Ollama in dropdown)
app.post('/api/ollama', async (req, res) => {
  try {
    const tagsRes = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(1500)
    });
    const tagsData = await tagsRes.json();
    const modelName = req.body.model || tagsData?.models?.[0]?.name || 'llama3.2';

    const ollamaRes = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: req.body.prompt,
        stream: false
      }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await ollamaRes.json();
    res.json({ response: data.response, model: modelName });
  } catch (err) {
    res.status(500).json({ error: 'Local Ollama is not running on port 11434.' });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`🔁 Reloop Server running at http://localhost:${PORT}`);
});
