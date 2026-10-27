import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// 1. REAL YouTube Transcript + Video Details Extractor
app.get('/api/transcript', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  try {
    // Try English captions first, then Hindi ('hi') or auto-generated
    let subtitles = await getSubtitles({ videoID: videoId, lang: 'en' });
    if (!subtitles || subtitles.length === 0) {
      subtitles = await getSubtitles({ videoID: videoId, lang: 'hi' });
    }
    if (!subtitles || subtitles.length === 0) {
      subtitles = await getSubtitles({ videoID: videoId });
    }

    let title = 'YouTube Lecture';
    let description = '';
    try {
      const details = await getVideoDetails({ videoID: videoId, lang: 'en' });
      title = details?.title || title;
      description = details?.description || '';
    } catch {}

    const transcript = (subtitles || []).map(item => ({
      offset: Math.floor(parseFloat(item.start || 0)),
      duration: parseFloat(item.dur || 0),
      text: item.text
    }));

    console.log(`✅ Extracted ${transcript.length} REAL caption lines for video: ${videoId}`);

    if (transcript.length === 0) {
      return res.status(404).json({
        error: 'This YouTube video has no captions/subtitles enabled.'
      });
    }

    res.json({ title, description, transcript });
  } catch (err) {
    console.error('❌ Transcript extraction error:', err.message);
    res.status(500).json({ error: `Failed to fetch transcript: ${err.message}` });
  }
});

// 2. Local Ollama Route (if you select Local Ollama in dropdown)
app.post('/api/ollama', async (req, res) => {
  try {
    const tagsRes = await fetch('http://127.0.0.1:11434/api/tags');
    const tagsData = await tagsRes.json();
    const modelName = req.body.model || tagsData?.models?.[0]?.name || 'llama3.2';

    const ollamaRes = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: req.body.prompt,
        stream: false
      })
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
