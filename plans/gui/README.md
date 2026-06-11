# MeetingTwin GUI — Piano di implementazione (contesto condiviso)

Questo documento contiene il contesto comune a tutte le fasi di implementazione della GUI web.
Ogni fase è descritta in un file `phase-N-*.md` di questa cartella, pensato per essere usato come
prompt autosufficiente per un agente di implementazione. Le fasi vanno eseguite **in ordine**:

| Fase | File | Contenuto |
|------|------|-----------|
| 0 | [phase-0-bootstrap.md](phase-0-bootstrap.md) | Estrazione `MeetingSession`, scheletro server `gui.js`, shell frontend |
| 1 | [phase-1-live-meeting.md](phase-1-live-meeting.md) | Meeting live dalla GUI (start/stop, trascrizione realtime, chat AI) |
| 2 | [phase-2-batch-transcription.md](phase-2-batch-transcription.md) | Trascrizione batch di file audio/video dalla GUI |
| 3 | [phase-3-configuration.md](phase-3-configuration.md) | Pannello configurazione (dispositivi, provider, lingua) |
| 4 | [phase-4-history.md](phase-4-history.md) | Storico dei meeting salvati |

## Obiettivo generale

MeetingTwin è un'app CLI Node.js per trascrizione di meeting live (microfono + loopback audio di
sistema), chat AI contestuale sul transcript e recap finale, più uno script per trascrizione batch
da file. Si vuole aggiungere una GUI che offra le stesse funzioni:

- `index.js` resta l'entry point CLI, **con comportamento identico a oggi**.
- `gui.js` (nuovo) avvia un server HTTP + WebSocket locale e apre il browser su una single-page
  app statica servita da `public/`.

**Decisione tecnologica (già presa, non rimetterla in discussione):** server web locale, **non**
Electron. Il progetto dipende da moduli nativi (`naudiodon`, `sherpa-onnx-node`) compilati per
l'ABI di Node; Electron richiederebbe un rebuild ad alto rischio. Con il server web il processo
resta Node puro.

## Architettura del codebase esistente

- **Module system**: CommonJS a livello top (`"type": "commonjs"` in package.json). Le cartelle
  `src/ai/` e `src/transcription/` sono moduli ESM TypeScript caricati nativamente (hanno un
  proprio `package.json` con `"type": "module", "main": "index.ts"`). Non c'è build step: il
  codice gira sulla versione di Node già in uso (require(esm) + type-stripping nativo).
- **`index.js`** — entry CLI: crea `DeviceManager`, aggiunge device `'mic'` e `'sys'`, filtra gli
  eventi `'transcription'` con soglia confidenza 0.85, etichetta le righe con
  `determineDisplaySource()` (`src/utils.js`), accumula in `TranscriptManager`, loop readline
  (input libero → query AI; `exit`/`quit` → salvataggio output; `history` → stampa transcript).
- **`src/device-manager.js`** — `DeviceManager extends EventEmitter`; eventi: `'transcription'`
  (`{source, text, confidence, timestamp, speaker}`), `'deviceConnected'`, `'deviceDisconnected'`,
  `'deviceError'`. Metodi: `addDevice(id, {deviceId, label, apiKey, sampleRate})`, `startAll()`,
  `stopAll()`.
- **`src/transcript-manager.js`** — store in-memory: `addTranscriptEntry(timestamp, source, text,
  confidence)`, `getTranscript()`.
- **`src/ai/index.ts`** — factory `createAIService(transcriptManager)` → ClaudeClient o GroqClient
  in base alle env (`ANTHROPIC_API_KEY` / `GROQ_API_KEY`); il client espone
  `query(text): Promise<string>`.
- **`src/transcription/index.ts`** — factory `createTranscriptionService(deepgramApiKey)` →
  Deepgram (streaming WS) o locale (sherpa-onnx) in base a `TRANSCRIPTION_PROVIDER`.
- **`src/meeting-output.js`** — `saveMeetingOutputs(transcriptManager, aiClient, {outDir =
  'meetings', prefix, skipLlm})` scrive `<prefix>-meeting-transcript.txt` e
  `<prefix>-meeting-recap.md` (recap generato via LLM, saltato se `skipLlm` o `aiClient` null).
- **`src/audio-file-source.js`** — `probeAudioStreams(path)`, `decodeTrackToPcm16(path, track)`,
  `PIPELINE_SAMPLE_RATE` (ffmpeg/ffprobe static).
- **`scripts/transcribe-file.js`** — CLI batch: probe tracce → decode → `transcribeBatch()` →
  `saveMeetingOutputs()`. Flag: `--provider`, `--out`, `--track`, `--skip-llm`.
- **`scripts/check-audio.js`** — lista dispositivi con `require('naudiodon').getDevices()`
  filtrando `maxInputChannels > 0`, con euristica loopback sul nome (`loopback`, `stereo mix`,
  `virtual`, `vb-audio`).
- **Config** via `.env`/dotenv: `TRANSCRIPTION_PROVIDER`, `DEEPGRAM_API_KEY`,
  `AUDIO_DEVICE_ID_MIC`, `AUDIO_DEVICE_ID_SYSTEM`, `IS_LIVE_MEETING`, `SKIP_LLM`,
  `DEEPGRAM_LANGUAGE`, `LOCAL_WHISPER_MODEL`, `LOCAL_TRANSCRIPTION_LANGUAGE`, API key AI.
- **Test**: `npm test` (node --test, file in `test/`, mock in `test/mocks/`),
  `npm run typecheck` (tsc --noEmit).

## Architettura target della GUI

```
gui.js  (entry point, CJS)
 ├─ express: static su public/, express.json(), route /api/*
 ├─ ws: WebSocketServer su path /ws, broadcast a tutti i client
 ├─ MeetingSession (src/meeting-session.js)   ← fase 0, usata anche da index.js
 ├─ transcribeFile (src/batch-transcription.js) ← fase 2, usata anche dallo script CLI
 ├─ ConfigManager (src/config-manager.js)     ← fase 3
 └─ MeetingHistory (src/meeting-history.js)   ← fase 4

public/index.html + public/app.js + public/style.css  (vanilla, no build step)
 └─ 4 tab: Meeting Live | Trascrizione File | Configurazione | Storico
```

Una sola `MeetingSession` attiva per processo e un solo job batch alla volta (i device audio e i
modelli locali sono risorse esclusive). I messaggi server→client sono **broadcast** a tutti i
WebSocket connessi: più tab del browser mostrano la stessa vista.

## Protocollo WebSocket (specifica unica per tutte le fasi)

Tutti i messaggi sono JSON. Endpoint: `ws://localhost:<porta>/ws`.

### Server → Client

| Messaggio | Quando |
|-----------|--------|
| `{type: 'transcription', data: {source, text, confidence, timestamp}}` | Nuova riga di trascrizione (live meeting) |
| `{type: 'status', data: {state, message?}}` con `state: 'idle'\|'starting'\|'running'\|'stopping'\|'stopped'\|'error'` | Cambio stato del meeting live |
| `{type: 'transcript', data: {text}}` | Risposta a `getTranscript` |
| `{type: 'ai-response', data: {text}}` | Risposta dell'AI a una query |
| `{type: 'ai-error', data: {message}}` | Errore durante una query AI |
| `{type: 'batch-progress', data: {jobId, state, track?, totalTracks?, message?, outputs?}}` con `state: 'probing'\|'decoding'\|'transcribing'\|'saving'\|'done'\|'error'` | Avanzamento job batch |
| `{type: 'error', data: {message}}` | Errore generico / comando sconosciuto o non valido |

### Client → Server

| Comando | Effetto |
|---------|---------|
| `{command: 'startMeeting'}` | Avvia meeting live (errore se già attivo o batch in corso) |
| `{command: 'stopMeeting'}` | Ferma il meeting e salva transcript + recap |
| `{command: 'query', text}` | Query AI sul transcript corrente |
| `{command: 'getTranscript'}` | Richiede il transcript completo corrente |
| `{command: 'startBatch', filePath, provider?, track?, skipLlm?}` | Avvia trascrizione batch del file indicato |

## Route HTTP

| Route | Metodo | Fase | Scopo |
|-------|--------|------|-------|
| `/` e asset statici | GET | 0 | Frontend da `public/` |
| `/api/health` | GET | 0 | `{ok: true}` |
| `/api/devices` | GET | 3 | Lista dispositivi audio di input |
| `/api/config` | GET/POST | 3 | Lettura/modifica configurazione di sessione |
| `/api/meetings` | GET | 4 | Lista meeting salvati |
| `/api/meetings/:prefix` | GET | 4 | Transcript + recap di un meeting |

## Convenzioni vincolanti per tutte le fasi

1. **Nuovo codice server in CommonJS `.js`** (come `index.js`); frontend in vanilla
   HTML/CSS/JS, **nessun framework e nessun build step**.
2. **Non modificare**: `src/device-manager.js`, `src/transcript-manager.js`, `src/ai/*`,
   `src/transcription/*`, `src/meeting-output.js`, `src/audio-file-source.js`, `src/utils.js`,
   `src/chat-history-manager.js`, `src/audio-capture.js`.
3. **Il comportamento CLI non deve cambiare**: `node index.js` e
   `node scripts/transcribe-file.js` devono produrre gli stessi output console e gli stessi file
   di prima.
4. A fine fase: `npm test` e `npm run typecheck` devono passare. Aggiungere test con `node --test`
   riusando i mock in `test/mocks/` dove sensato.
5. **Le API key non devono mai essere inviate al frontend** (né via HTTP né via WS).
6. Testi UI in italiano; identificatori, commenti e codice in inglese, coerenti con lo stile
   esistente del repo.
