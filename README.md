# Reloop

> Distraction-free YouTube study workspace with local AI note indexing and progressive concept mapping.

Reloop turns YouTube video lectures into an active, distraction-free study station. It extracts real YouTube video captions, summarizes 15-second lecture segments in real time using local models (WebLLM via WebGPU or local Ollama), and progressively generates a multi-branch 2D concept map using Mermaid.js.

---

## Features

- **Local-First AI Execution**: Runs in-browser via WebLLM (`SmolLM2-360M` or `Llama-3.2-1B`) utilizing WebGPU, or connects to a local Ollama instance (`localhost:11434`). Zero cloud API keys required.
- **Progressive Concept Mapping**: Generates a 2D hierarchical flowchart (`flowchart TD`) in real-time, grouping every 45s of lecture into topic phases with core concept hexagons and mechanism/insight sub-branches.
- **Automated Lecture Notes**: Chronologically indexes bullet-point notes for each segment as you watch.
- **Focus & Fullscreen Guard**: Pauses video and displays an active lock modal if fullscreen is exited or the browser tab loses focus.
- **Unlimited IndexedDB Storage**: Uses `indexedDB` with persistent storage (`ReloopBranchingDB_v4`) to cache transcripts, notes, and concept graphs with quick 1-click resume.
- **Minimalist Light Design**: Clean editorial interface inspired by Linear, Notion, and Figma, built with Inter and JetBrains Mono on an architectural dot-grid canvas.

---

## Architecture

```
Reloop/
├── server.js              # Express backend (caption extraction + Ollama proxy)
├── package.json           # Dependencies and scripts
├── .gitignore             # Leakage prevention & dependency exclusion
├── README.md              # Project documentation
└── public/
    ├── index.html         # Main workspace layout
    ├── style.css          # Minimalist Light Theme styles
    └── app.js             # Client logic (WebLLM, YouTube player, Mermaid canvas)
```

---

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- A modern browser with WebGPU support (Chrome, Edge, Brave, or Chromium-based)
- *(Optional)* [Ollama](https://ollama.ai) installed and running locally for local server inference.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/CodeByRachit/Reloop.git
   cd Reloop
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## Usage

1. Select your preferred local engine from the toolbar (`SmolLM2 360M`, `Llama 3.2 1B`, or `Local Ollama`).
2. Paste any YouTube lecture URL that has captions/subtitles enabled.
3. Click **Enter Focus Session** to launch fullscreen mode.
4. Watch the lecture—Reloop will automatically build timestamped notes and grow the concept map step-by-step.
5. Use the canvas controls (`+`, `-`, `100%`) to zoom and navigate the concept diagram.

---

## License

MIT
