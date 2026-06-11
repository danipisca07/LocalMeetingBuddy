# Fase 2 — Trascrizione batch da file nella GUI

## Obiettivo

Rendere funzionante la tab **Trascrizione File**: l'utente indica il percorso di un file
audio/video, sceglie provider/traccia/skip-LLM, avvia la trascrizione batch e segue
l'avanzamento fino ai file di output — l'equivalente di `node scripts/transcribe-file.js` via
GUI. Per riuso, la pipeline batch viene estratta dallo script CLI in un modulo condiviso.

Leggere prima `plans/gui/README.md` (protocollo WebSocket, convenzioni) e assicurarsi che le
fasi 0 e 1 siano completate.

## Prerequisiti

- Fase 0: `gui.js` con server + dispatcher WS, `public/` con shell a tab.
- Fase 1: gestione meeting live in `gui.js` (serve per il mutex meeting/batch).

## Contesto essenziale

`scripts/transcribe-file.js` oggi fa: parse argomenti → risoluzione provider (override di
`process.env.TRANSCRIPTION_PROVIDER` se `--provider`) → `probeAudioStreams(inputPath)`
(`src/audio-file-source.js`) → per ogni traccia: `decodeTrackToPcm16(inputPath, trackIndex)` →
`createTranscriptionService(deepgramApiKey)` (`src/transcription`) con handler `'transcription'`
(soglia confidenza 0.85, label `trackN-speaker` o `speaker-N`) → `await
service.transcribeBatch(pcm, {sampleRate: PIPELINE_SAMPLE_RATE, source, baseTimestamp})` →
infine `saveMeetingOutputs(transcriptManager, aiClient, {outDir, prefix: basename del file,
skipLlm})`. Tutto il progress è oggi su console.log.

## File da creare

### 1. `src/batch-transcription.js` (nuovo, CJS)

Estrarre la pipeline in una funzione riusabile:

```js
/**
 * Transcribe every audio track of a file with the same pipeline as the CLI script.
 *
 * @param {string} inputPath  absolute path of the input file (already validated existing)
 * @param {{
 *   provider?: string|null,      // 'local'|'deepgram'|null → null = use env
 *   track?: number|null,         // only this audio stream (null = all)
 *   skipLlm?: boolean,
 *   outDir?: string,             // default 'meetings'
 *   confidenceThreshold?: number,// default 0.85
 *   onEvent?: (evt) => void,     // progress callback, see below
 * }} options
 * @returns {Promise<{outputs: {transcriptPath: string, recapPath: string|null}, prefix: string}>}
 */
async function transcribeFile(inputPath, options = {}) { /* ... */ }
module.exports = { transcribeFile };
```

Eventi `onEvent(evt)` (sostituiscono i console.log dello script):

- `{state:'probing'}` — prima di `probeAudioStreams`
- `{state:'decoding', track, totalTracks}` — prima del decode di ogni traccia
- `{state:'transcribing', track, totalTracks, durationSec}` — prima di `transcribeBatch`
- `{state:'transcription', label, text}` — per ogni riga trascritta (oltre la soglia)
- `{state:'track-done', track}`
- `{state:'saving'}` — prima di `saveMeetingOutputs`
- `{state:'done', outputs}` — fine

Dettagli:

- Comportamento identico allo script attuale: stesso ordine di operazioni, stessa logica label
  (`trackN-speaker` se più tracce, `speaker-N` se una), stesso `baseTimestamp = Date.now()`,
  stesso prefix `path.basename(inputPath, path.extname(inputPath))`.
- Errori: `track` richiesto non esistente → throw con messaggio
  `track N not found. Available tracks: ...` (come oggi); provider deepgram senza
  `DEEPGRAM_API_KEY` → throw (stesso messaggio dello script). Errori `'error'` del servizio di
  trascrizione → inoltrati a `onEvent({state:'transcription-error', track, message})` senza
  interrompere (come oggi, che logga e prosegue).
- L'override provider: se `options.provider` è valorizzato, impostare
  `process.env.TRANSCRIPTION_PROVIDER` prima di chiamare la factory (stesso meccanismo dello
  script attuale; documentarlo nel JSDoc) e ripristinare il valore precedente in un `finally`.
- `saveMeetingOutputs` ritorna void: i percorsi output vanno ricostruiti con la stessa logica di
  `src/meeting-output.js` (`<outDir>/<prefix>-meeting-transcript.txt`, recap `.md` solo se non
  skipLlm).

## File da modificare

### 2. `scripts/transcribe-file.js` (refactor, comportamento identico)

Mantenere: parse argomenti, `printUsage()`, validazione esistenza file, check API key, banner.
Sostituire il corpo con una chiamata a `transcribeFile(inputPath, {provider, track, skipLlm,
outDir, onEvent})` dove `onEvent` riproduce **esattamente** le stampe attuali
(`Decoding track N...`, `Transcribing track N (X.Xs of audio)...`, `[label]: text`,
`Track N done.`, ecc.). Output console identico a prima del refactor.

### 3. `gui.js`

- Stato modulo: `let batchJob = null;` (`{jobId, state}`); jobId = stringa breve
  (`Date.now().toString(36)` va bene).
- Caso dispatcher `startBatch` (`{command:'startBatch', filePath, provider?, track?, skipLlm?}`):
  1. Rifiutare se `batchJob` attivo o meeting live in corso (i device/modelli possono
     confliggere): `{type:'error', data:{message:'Operazione già in corso'}}` al mittente.
  2. Validare `filePath`: stringa non vuota, `path.resolve`, `fs.existsSync` → altrimenti
     `{type:'error', data:{message:'File non trovato: ...'}}`.
  3. Avviare `transcribeFile(...)` senza await bloccante del dispatcher (fire con `.then/.catch`
     o funzione async separata): ogni `onEvent` → broadcast
     `{type:'batch-progress', data:{jobId, ...evt}}`. Throttle non necessario.
  4. A successo: broadcast `{type:'batch-progress', data:{jobId, state:'done', outputs}}`; a
     errore: `{..., state:'error', message: err.message}`. In entrambi i casi `batchJob = null`.
- Aggiornare il mutex di `startMeeting` (fase 1): rifiutare se `batchJob` attivo.

### 4. `public/` — tab Trascrizione File (`#tab-batch`)

```
┌──────────────────────────────────────────────┐
│ File:     [ C:\percorso\file.mp4         ]   │
│ Provider: [default ▾]  Traccia: [tutte ▾/n]  │
│ [ ] Salta recap LLM            [Trascrivi]   │
├──────────────────────────────────────────────┤
│ Avanzamento                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ Analisi file…                            │ │
│ │ Decodifica traccia 0/2…                  │ │
│ │ [track0-1]: testo trascritto…            │ │
│ │ ✔ Completato → meetings\file-…txt        │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- Input testo per il **percorso assoluto** del file (niente upload multipart: tool locale
  single-user; il server legge direttamente dal filesystem). Select provider con opzioni
  `default (da .env)` / `local` / `deepgram`; campo traccia numerico opzionale; checkbox
  "Salta recap LLM".
- Bottone **Trascrivi** → invia `startBatch`; disabilitato mentre un job è in corso.
- Handler `batch-progress`: appende righe leggibili al log di avanzamento (una per stato, le
  righe `transcription` come `[label]: text`); su `done` mostra i percorsi output; su `error`
  messaggio in rosso e riabilita il bottone. Autoscroll come il pannello live.

## Test da aggiungere

`test/batch-transcription.test.js`: con un mock di servizio non serve hardware ma serve
ffmpeg/ffprobe; se esiste già una fixture audio in `test/fixtures/` (controllare — la usa
`test/local-transcription.test.js`), testare `transcribeFile` end-to-end con
`provider:'local'` può essere lento: in tal caso limitarsi a testare (a) errore su file
inesistente gestito dal chiamante, (b) errore su track inesistente, (c) ripristino di
`process.env.TRANSCRIPTION_PROVIDER` dopo override. Seguire lo stile dei test esistenti.

## Criteri di accettazione

- [ ] `node scripts/transcribe-file.js <file> [--provider local] [--track n] [--skip-llm]`
      produce output console e file **identici** a prima del refactor.
- [ ] Dalla GUI: percorso file + Trascrivi → log di avanzamento in tempo reale (probe, decode,
      righe trascritte, salvataggio) → percorsi output mostrati; file presenti in `meetings/`
      uguali a quelli prodotti dallo script CLI sullo stesso input.
- [ ] File inesistente → errore mostrato in GUI, nessun crash del server.
- [ ] Batch rifiutato se meeting live in corso e viceversa.
- [ ] `npm test` e `npm run typecheck` passano.

## Verifica

```powershell
npm test
npm run typecheck
# CLI invariata (usare una fixture o un file audio qualsiasi):
node scripts/transcribe-file.js test\fixtures\<file> --provider local --skip-llm --out tmp-out
npm run gui
# Manuale: stessa trascrizione dalla tab Trascrizione File, confrontare i file di output.
```
