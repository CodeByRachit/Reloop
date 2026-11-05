# Reloop

> Distraction-free YouTube study workspace with local AI note indexing and progressive concept mapping.

Reloop transforms YouTube lectures into an interactive study workspace. Instead of switching between a video, a note-taking application, and a mind-mapping tool, Reloop brings everything together in one place.

Paste a YouTube lecture link and enter a focused study session. Reloop extracts the video transcript, generates timestamped lecture notes using local AI models, and progressively builds a visual concept map as you watch.

The application also includes custom video playback controls, chapter navigation, manual timestamps, and persistent session storage, allowing you to resume your learning right where you left off.

---

## Features

- **Local-First AI Execution**: Runs AI models directly in the browser using WebLLM and WebGPU (`SmolLM2-360M` or `Llama-3.2-1B`), or connects to a local Ollama instance (`localhost:11434`). No cloud AI API keys required.

- **Automated Lecture Notes**: Extracts YouTube captions and generates structured, timestamped bullet-point notes at 15-second intervals using the selected local AI model.

- **Progressive Concept Mapping**: Builds a hierarchical 2D concept map in real-time using Mermaid.js. Groups related concepts into topic phases, connecting core ideas with supporting mechanisms, explanations, and insights.

- **Custom Video Playback Controls**: Includes play/pause, 10-second forward and backward seeking, playback speed adjustment, volume control, mute, captions, and fullscreen support.

- **Interactive Chapter Timeline**: Automatically organizes key topics into a navigable timeline. Jump directly to important concepts without manually searching through the entire lecture.

- **Manual Timestamps**: Save important moments during a lecture with custom titles. Timestamps are synchronized with video playback, making it easier to revisit specific explanations.

- **Focus & Fullscreen Guard**: Helps maintain a distraction-free environment by pausing the video and displaying a focus lock when fullscreen is exited or the browser tab loses focus.

- **Persistent Study Sessions**: Uses IndexedDB with persistent browser storage to cache transcripts, generated notes, concept maps, and playback progress. Previously started sessions can be resumed without starting from scratch.

- **Flexible Workspace Layout**: Switch between lecture notes and the concept map using the side inspector. Resize workspace panels to adjust the available viewing space.

- **Figma-Style Concept Canvas**: Provides unrestricted SVG rendering with 10% to 800% zoom, mouse-wheel and trackpad zoom, and click-and-drag panning.

- **Minimalist Interface**: A clean, distraction-free interface with a responsive landing page and a dedicated study workspace, built around Inter and JetBrains Mono typography.

---

## Architecture

```
Reloop/
├── server.js              # Express backend (caption extraction + Ollama proxy)
├── package.json           # Dependencies and scripts
├── .gitignore             # Dependency and environment file exclusions
├── README.md              # Project documentation
└── public/
    ├── landing.html       # Public landing page
    ├── landing.css        # Landing page styling
    ├── landing.js         # Landing page interactions
    ├── youtube.js         # Shared YouTube URL parsing and normalization
    ├── index.html         # Focus-session workspace (served at /focus)
    ├── style.css          # Workspace styling
    └── app.js             # Client logic (WebLLM, YouTube player, notes, Mermaid canvas)
```

---

## Local AI Model Setup

Reloop supports two local AI execution options. Both allow you to generate lecture notes without relying on external cloud AI services.

### Option 1: In-Browser WebLLM (Recommended — No CLI Commands Required)

WebLLM runs directly inside your browser using **WebGPU**. No external model server or command-line installation is required.

1. Open Reloop in a WebGPU-enabled browser (Chrome, Edge, Brave, or another Chromium-based browser).
2. Select one of the in-browser engines from the dropdown:
   - **`Local Engine: SmolLM2 360M`** — Lightweight and faster inference, approximately 360 MB.
   - **`Local Engine: Llama 3.2 1B`** — A larger model with more contextual reasoning capabilities, approximately 880 MB.
3. Start a study session. The browser automatically downloads the selected model weights and caches them locally.
4. Subsequent sessions can reuse the cached model instead of downloading it again.

**Note:** Model loading and inference performance depend on your browser, GPU, available memory, and hardware support for WebGPU.

---

### Option 2: Local Ollama (Optional External Server)

If you prefer running models through [Ollama](https://ollama.com) on your system (`localhost:11434`):

1. **Install Ollama:**

   - macOS / Linux:
     ```bash
     curl -fsSL https://ollama.com/install.sh | sh
     ```

   - Windows: Download and install Ollama from [ollama.com](https://ollama.com/download).

2. **Pull the model:**

   Download the default model used by Reloop:

   ```bash
   ollama pull llama3.2
   ```

   *Optional smaller models:*

   ```bash
   # Lightweight 1B version
   ollama pull llama3.2:1b

   # Smaller SmolLM2 model
   ollama pull smollm2:360m
   ```

3. **Start the Ollama server:**

   ```bash
   ollama serve
   ```

   *(If you use the Ollama Desktop application, the server starts automatically.)*

4. Open Reloop and select **`Localhost: Ollama (11434)`** from the AI engine dropdown.

   Reloop will automatically detect the available local models.

---

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm
- A modern browser (Chrome, Edge, Brave, or another Chromium-based browser)
- WebGPU support for in-browser AI inference
- *(Optional)* Ollama installed if using external model inference

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

   ```text
   http://localhost:3000
   ```

The landing page will be displayed. Paste a YouTube video link to begin a study session.

---

## Usage

1. Open Reloop and paste a valid YouTube video URL on the landing page.
2. Click **Start Learning** to enter the study workspace.
3. Select your preferred AI engine from the toolbar (`SmolLM2 360M`, `Llama 3.2 1B`, or `Localhost: Ollama`).
4. Start watching the lecture. Reloop extracts the available captions and begins generating timestamped notes and concept maps.
5. Use the **Notes** and **Concept Map** panels to switch between generated lecture notes and the visual representation of the concepts.
6. Navigate through important topics using the chapter timeline.
7. Add your own timestamps to bookmark important explanations.
8. Use the video playback controls to seek, adjust playback speed, manage volume, toggle captions, or enter fullscreen mode.
9. Zoom and pan across the concept canvas to explore the generated concept map.
10. Your study progress is automatically saved. Reopen a previously studied lecture to continue from where you left off.

---

## API Endpoints

Reloop uses a lightweight Express backend to handle transcript extraction and local Ollama communication.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/transcript?videoId={id}` | Extracts YouTube captions and video details. |
| POST | `/api/ollama` | Sends prompts to a locally running Ollama model. |

---

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES Modules)
- **Backend**: Node.js, Express.js
- **AI Inference**: WebLLM, WebGPU, Ollama
- **Concept Mapping**: Mermaid.js
- **Video Integration**: YouTube IFrame Player API
- **Storage**: IndexedDB, LocalStorage, SessionStorage
- **Typography**: Inter, JetBrains Mono

---

## Live Demo

Try Reloop here:

[https://reloop-3ug8.onrender.com/](https://reloop-3ug8.onrender.com/)

---

## License

MIT
