# AutoScribe

AutoScribe is an offline, AI-powered transcription tool designed for churches to help hearing-impaired attendees follow along with sermons and services in real time. It runs entirely on-device with no internet connection required after initial setup.

## Features

- **Real-time speech-to-text** using Whisper (via Transformers.js) running locally on CPU
- **Multilingual support** with English and Spanish transcription, plus Spanish-to-English translation
- **Readable pacing** with sentence-by-sentence, word-by-word, and instant display modes (150 to 300 WPM)
- **Customizable display** including font family, size, color themes (light, dark, high contrast), and line height
- **Multiple viewing options**: operator control panel, fullscreen display window, and networked viewers for phones and tablets via WebSocket
- **Bible reference detection** that automatically formats spoken references (e.g., "John 316", "John chapter 3 verse 16") into a standardized bold display
- **QR code generation** for easy connection from mobile devices on the same network
- **Session management** with start, pause, resume, stop, and transcript export to text file
- **Audio input testing** to verify microphone or line-in levels before starting a session
- **Cross-platform** support for macOS, Windows, Linux, and Raspberry Pi

## Requirements

- **Node.js** 18 or later
- **SoX** (Sound eXchange) for audio capture
  - macOS: `brew install sox`
  - Ubuntu/Debian: `sudo apt install sox`
  - Windows: [Download from SourceForge](https://sourceforge.net/projects/sox/)

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm start
```

On first launch, AutoScribe will download the Whisper speech recognition model (approximately 250 MB). This only happens once and the model is cached locally for future use.

### Build for macOS

```bash
npm run make
```

The distributable will be created in `out/make/zip/darwin/`.

### Build for Linux (including Raspberry Pi)

```bash
npm run make:pi
```

## Architecture

AutoScribe is built with Electron and uses a multi-window architecture:

```
Main Process
  ├── Audio Capture (node-record-lpcm16 + SoX)
  ├── Whisper STT Engine (@huggingface/transformers, ONNX)
  ├── Pacing Controller (WPM throttling and sentence segmentation)
  ├── Control Window (operator interface)
  ├── Display Window (fullscreen paced output)
  └── Network Server (Express + WebSocket for remote viewers)
```

### Audio Pipeline

Audio is captured from a microphone or soundboard input at 16kHz mono PCM, then fed into the Whisper model which produces transcription segments. These segments flow through the pacing controller before reaching the display.

### Display System

The operator always sees transcription output immediately. The display window and network viewers receive paced output according to the configured WPM setting, giving the audience time to read comfortably.

### Network Viewers

When the network server is enabled, any device on the same local network can connect via a web browser to view the live transcription. The viewer page is fully self-contained and adjusts to the display settings configured by the operator.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Electron 40, TypeScript 5 |
| UI | React 18, TailwindCSS 3 |
| Speech-to-Text | Whisper (onnx-community/whisper-small) via @huggingface/transformers |
| Audio Capture | node-record-lpcm16, SoX |
| Network | Express 5, WebSocket (ws) |
| Build | electron-forge, Webpack |
| NLP | compromise (sentence segmentation) |

## Project Structure

```
src/
  main/                  # Electron main process
    audio/               # Audio capture and processing
    stt/                 # Speech-to-text engine (Whisper)
    transcript/          # Buffer, pacing controller, storage
    server/              # HTTP + WebSocket server for network viewers
    ipc/                 # IPC handler registration
    index.ts             # App entry point, window management
  renderer/
    control/             # Operator control panel (React)
    display/             # Fullscreen display window (React)
  shared/
    types/               # Shared TypeScript interfaces
    bibleReferences.ts   # Bible reference detection and normalization
  preload/               # Context bridge scripts
  assets/                # Logo and app icon
```

## Configuration

All settings are adjustable from the control panel at runtime:

| Setting | Options |
|---------|---------|
| Pacing Mode | Sentence-by-sentence, Word-by-word, Instant |
| WPM | 150 to 300 |
| Font | Arial, Verdana, Georgia, OpenDyslexic |
| Font Size | 16px to 72px |
| Display Theme | Light, Dark, High Contrast |
| Control Panel Theme | Light, Dark, High Contrast |
| Language | English, Spanish, Spanish to English translation |
| Audio Input | Microphone or Line-in, with device selection |

## License

MIT
