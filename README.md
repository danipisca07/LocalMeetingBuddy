# MeetingTwin

## Purpose

MeetingTwin is an AI-powered meeting assistant that runs locally. It transcribes both your microphone and system audio in real-time, maintains full meeting context, and lets you query an AI assistant while the meeting is in progress.

**Core Features:**

- **Real-time Transcription**: Captures and transcribes system audio and microphone simultaneously.
- **Context-Aware AI Assistant**: Answers questions about the ongoing meeting.
- **Dual-Source Recording**: Labels audio as `[user]` (you) and `[caller-N]` (participants).
- **Flexible LLM Support**: Anthropic Claude or Groq.
- **Web GUI**: Browser-based interface with live meeting, file transcription, configuration, and meeting history — no Electron, no build step.
- **Batch Transcription**: Transcribe recorded audio/video files offline.
- **Local Transcription**: Fully on-device via Whisper (no cloud API needed).

## Requirements

1. **Node.js**
2. **API Keys**:
   - **Deepgram API Key** — for cloud speech-to-text (or use local provider instead).
   - **Anthropic API Key** OR **Groq API Key** — for AI inference.
3. **Loopback Audio Driver** — routes system audio back as an input so MeetingTwin can hear meeting participants:
   - **macOS**: [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole?tab=readme-ov-file#installation-instructions)
   - **Windows**: [VB-Audio Cable](https://vb-audio.com/Cable/)

## Setup

### 1. Install

```bash
git clone <repository-url>
cd MeetingTwin
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your keys:

| Variable | Description |
| --- | --- |
| `DEEPGRAM_API_KEY` | Deepgram key (skip if using local provider) |
| `ANTHROPIC_API_KEY` | Anthropic key (Claude) |
| `GROQ_API_KEY` | Groq key |
| `DEEPGRAM_LANGUAGE` | Meeting language code ([see docs](https://developers.deepgram.com/docs/models-languages-overview)) |

#### Local transcription (no cloud, no API key)

Set `TRANSCRIPTION_PROVIDER=local` to run fully on-device using Whisper via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Models (~200 MB) are downloaded automatically to `~/.meetingtwin/models` on first run.

| Variable | Description |
| --- | --- |
| `LOCAL_WHISPER_MODEL` | `tiny` / `base` / `small` / `medium` / `large-v3` (default: `base`). `large-v3` downloads ~1 GB on first use (slower start, best quality). |
| `LOCAL_SPEAKER_THRESHOLD` | Speaker diarization sensitivity (lower = more utterances merged) |
| `LOCAL_TRANSCRIPTION_MODELS_DIR` | Override models directory |

Transcripts are emitted per utterance (~1 s of silence) rather than word-by-word; slightly higher latency than Deepgram in exchange for full privacy.

### 3. Audio Device Configuration

Find the device IDs for your microphone and loopback device:

```bash
node scripts/check-audio.js
```

The output lists all input devices. Loopback candidates are marked with `*** POTENTIAL LOOPBACK DEVICE ***`. Set the IDs in `.env`:

```env
AUDIO_DEVICE_ID_MIC=<your-microphone-id>
AUDIO_DEVICE_ID_SYSTEM=<your-loopback-device-id>
```

Make sure your meeting software (Zoom, Teams, etc.) outputs audio to the loopback device.

To also hear the audio yourself during the meeting:

- **Windows**: Enable "Listen to this device" for the virtual cable in Windows Sound settings.

  ![Windows audio settings screenshot](images/win-audio-settings.png)
- **macOS**: Create a mixed audio output that includes BlackHole 2ch.

  ![macOS audio settings screenshot](images/macos-audio-settings.png)

## Usage — GUI (recommended)

Start the GUI server:

```bash
npm run gui
```

The server starts on `http://localhost:3000` (override with `GUI_PORT`). Your browser opens automatically. The GUI has four tabs:

### Live Meeting tab

Start and stop meetings from the browser. Real-time transcript appears as the meeting progresses; a built-in AI chat lets you query the transcript at any time. On stop, the transcript and recap are saved to `meetings/`.

### File Transcription tab

Transcribe a recorded audio or video file (mp4, mkv, mp3, m4a, wav, …). Enter the file path, choose the provider, and click Transcribe. Progress is shown in real-time; outputs land in `meetings/`.

### Configuration tab

Change audio devices, transcription provider, language, and session flags without editing `.env`. Changes apply to the current server session only and do not persist to `.env`.

### History tab

Browse all meetings saved in `meetings/`. Select a meeting to read its transcript or recap.

> The GUI supports English and Italian; switch languages with the selector in the top-right corner.

## Usage — CLI

### Live meeting

```bash
node index.js
```

The terminal shows real-time transcripts labeled `[user]` or `[#number]`. Type queries at the `MeetingTwin >` prompt:

- `Summarize the last 5 minutes.`
- `What did the caller say about the deadline?`
- `Translate the last point into Italian.`
- `exit` / `quit` — stop and save outputs.

Outputs saved to `meetings/`:

- `<date>-meeting-transcript.txt`
- `<date>-meeting-recap.md`

### Batch transcription

```bash
node scripts/transcribe-file.js <input-file> [options]
```

| Option | Description |
| --- | --- |
| `--provider <type>` | `local` or `deepgram` (default: from `.env`) |
| `--out <dir>` | Output directory (default: `meetings`) |
| `--track <n>` | Transcribe only audio stream `n` (default: all) |
| `--skip-llm` | Write transcript only; skip LLM recap |

Examples:

```bash
# Offline, no API key
node scripts/transcribe-file.js recordings/standup.mp4 --provider local

# Deepgram, transcript only
node scripts/transcribe-file.js call.m4a --provider deepgram --skip-llm
```

Every audio track is transcribed and diarized independently. A single mixed track is split into speakers automatically (`speaker-0`, `speaker-1`, …); multi-track files interleave utterances chronologically.
