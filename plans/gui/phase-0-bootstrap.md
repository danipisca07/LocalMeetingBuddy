# Fase 0 — Bootstrap architettura GUI

## Obiettivo

Preparare le fondamenta per la GUI web senza aggiungere funzionalità visibili:

1. Estrarre la logica di sessione meeting da `index.js` in una classe riusabile
   `MeetingSession` (`src/meeting-session.js`), usata sia dalla CLI sia (nelle fasi successive)
   dal server GUI.
2. Creare lo scheletro del server `gui.js` (express + WebSocket) e la shell del frontend in
   `public/` con 4 tab placeholder.

Leggere prima `plans/gui/README.md` per il contesto condiviso, il protocollo WebSocket e le
convenzioni vincolanti (in particolare: file da non modificare, comportamento CLI invariato).

## Prerequisiti

Nessuno (prima fase).

## Contesto essenziale

- `index.js` oggi fa tutto inline: crea `DeviceManager` (`src/device-manager.js`), aggiunge i
  device `'mic'` e `'sys'` con `deviceId` da `AUDIO_DEVICE_ID_MIC`/`AUDIO_DEVICE_ID_SYSTEM`,
  label `'live'|'user'` (mic, in base a `IS_LIVE_MEETING`) e `'caller'` (sys), filtra gli eventi
  `'transcription'` con soglia 0.85, etichetta con `determineDisplaySource(isLiveMeeting,
  evt.source, evt.speaker)` da `src/utils.js`, accumula in `TranscriptManager`, crea il client AI
  con `createAIService(transcriptManager)` (`src/ai`), e gestisce un loop readline.
- `src/meeting-output.js` espone `saveMeetingOutputs(transcriptManager, aiClient, {outDir,
  prefix, skipLlm})`.
- Il progetto è CommonJS; `src/ai` e `src/transcription` sono ESM TS caricati nativamente —
  `require('./src/ai')` funziona già così in `index.js`, replicare lo stesso pattern.
- `ws` è già nelle dipendenze; `express` va aggiunto.

## File da creare

### 1. `src/meeting-session.js` (nuovo, CJS)

Classe `MeetingSession extends EventEmitter` che incapsula il ciclo di vita di un meeting live.

```js
const { EventEmitter } = require('events');

class MeetingSession extends EventEmitter {
  /**
   * @param {{
   *   transcriptionProvider?: string,   // default: env TRANSCRIPTION_PROVIDER o 'deepgram'
   *   deepgramApiKey?: string,
   *   isLiveMeeting?: boolean,
   *   audioDeviceIdMic?: string,
   *   audioDeviceIdSystem?: string,
   *   sampleRate?: number,              // default 16000
   *   confidenceThreshold?: number,     // default 0.85
   *   skipLlm?: boolean,
   * }} config
   */
  constructor(config) { /* ... */ }

  /** Crea DeviceManager + device, sottoscrive gli eventi, avvia la cattura. */
  async start() { /* ... */ }

  /** Query AI sul transcript corrente. @returns {Promise<string>} */
  async query(text) { /* ... */ }

  /** @returns {string} transcript completo (delega a TranscriptManager) */
  getTranscript() { /* ... */ }

  /**
   * Ferma i device; se save=true salva transcript+recap via saveMeetingOutputs
   * con prefix = (new Date()).toISOString().slice(0, 16).replace(':', '')
   * (identico a index.js attuale). @returns {Promise<void>}
   */
  async stop({ save = true } = {}) { /* ... */ }
}
```

Dettagli implementativi:

- Il costruttore valida: se `transcriptionProvider === 'deepgram'` e manca `deepgramApiKey`,
  lancia un errore con lo stesso messaggio attuale di `index.js`
  (`DEEPGRAM_API_KEY must be set in .env (or set TRANSCRIPTION_PROVIDER=local)`); il chiamante
  decide come gestirlo (la CLI stampa ed esce, il server risponderà con un errore).
- Crea `TranscriptManager` e `aiClient = createAIService(transcriptManager)` nel costruttore.
- `start()`: crea `DeviceManager`, `addDevice('mic', {deviceId: audioDeviceIdMic, label:
  isLiveMeeting ? 'live' : 'user', apiKey: deepgramApiKey, sampleRate})` e `addDevice('sys',
  {deviceId: audioDeviceIdSystem, label: 'caller', apiKey: deepgramApiKey, sampleRate})` —
  replica esatta di index.js. Sottoscrive `deviceManager.on('transcription')`: scarta gli eventi
  con `confidence !== undefined && confidence < confidenceThreshold`, calcola
  `displaySource = determineDisplaySource(isLiveMeeting, evt.source, evt.speaker)`, chiama
  `transcriptManager.addTranscriptEntry(evt.timestamp, displaySource, evt.text, evt.confidence)`
  e ri-emette `this.emit('transcription', {source: displaySource, text: evt.text, confidence:
  evt.confidence, timestamp: evt.timestamp})`. Inoltra anche `'deviceError'` come
  `this.emit('error', err)`. Infine `await deviceManager.startAll()` e
  `this.emit('status', {state: 'running'})`.
- Esporre una proprietà `isRunning` (boolean).
- `stop()`: idempotente (no-op se non running); `deviceManager.stopAll()`; se `save`, chiama
  `saveMeetingOutputs(this.transcriptManager, this.aiClient, {prefix, skipLlm: this.config.skipLlm})`;
  poi `this.emit('status', {state: 'stopped'})`.
- Nessuna lettura diretta di `process.env` dentro la classe se il valore è passato in config; i
  default da env vanno risolti dal chiamante (index.js / gui.js). Eccezione accettabile: nessuna.
- `module.exports = { MeetingSession }`.

### 2. `gui.js` (nuovo, CJS, root del repo)

Scheletro del server:

- `require('dotenv').config()` come prima riga (come index.js).
- `express()` con `express.json()` e `express.static(path.join(__dirname, 'public'))`.
- `GET /api/health` → `{ok: true}`.
- Server http creato con `http.createServer(app)`; `WebSocketServer` (`ws`) agganciato con
  `{server, path: '/ws'}`.
- Helper `broadcast(message)` che invia `JSON.stringify(message)` a tutti i client con
  `readyState === OPEN`.
- Dispatcher dei messaggi WS: parse JSON (su parse error → `{type:'error', data:{message}}` al
  solo mittente); `switch (msg.command)` per ora senza casi implementati → default
  `{type:'error', data:{message: 'Unknown command: ...'}}`. Strutturarlo perché le fasi
  successive aggiungano i casi.
- Porta da `process.env.GUI_PORT` (default `3000`). Al listen, log dell'URL e apertura
  best-effort del browser: su win32 `exec('start "" "http://localhost:<porta>"')`, su darwin
  `open`, altrimenti `xdg-open`; ignorare errori.
- Shutdown su SIGINT/SIGTERM: chiudere WS server e http server, `process.exit(0)`.
- Creare la directory `meetings` se non esiste (come fa index.js), così le fasi successive non
  devono pensarci.

### 3. `public/index.html`, `public/app.js`, `public/style.css` (nuovi)

Shell della single-page app, in italiano:

- Header con titolo "MeetingTwin" e indicatore stato connessione WS (pallino verde/rosso +
  testo "Connesso"/"Disconnesso").
- Barra tab con 4 voci: **Meeting Live**, **Trascrizione File**, **Configurazione**, **Storico**.
  Il contenuto di ogni tab è un `<section>` con id dedicato (`tab-live`, `tab-batch`,
  `tab-config`, `tab-history`), per ora con un placeholder "Disponibile nella fase N".
- `app.js`: gestione tab (mostra/nascondi sezioni), client WebSocket verso
  `ws://${location.host}/ws` con riconnessione automatica (retry con backoff semplice, es. 1s
  fisso va bene), aggiornamento indicatore di connessione, e un registro handler per tipo di
  messaggio (`const handlers = { transcription: fn, status: fn, ... }`) che le fasi successive
  popoleranno. Loggare in console i messaggi non gestiti.
- `style.css`: stile minimale pulito (layout a colonna, tab orizzontali, dark o light a scelta
  ma leggibile). Niente CDN esterni: tutto locale.

## File da modificare

### 4. `index.js` (refactor, comportamento identico)

- Sostituire la costruzione inline di DeviceManager/TranscriptManager/aiClient con:
  lettura env (come oggi), check `DEEPGRAM_API_KEY` con stesso messaggio e `process.exit(1)`,
  `const session = new MeetingSession({...})`, `session.on('transcription', evt => {...stampa
  e rl.prompt(true)...})`, `await session.start()`.
- La stampa resta `[${evt.source}]: ${evt.text}` (la session emette già il displaySource come
  `source`).
- `history` → `session.getTranscript()`; input libero → `session.query(input)` con gli stessi
  messaggi "Agent is thinking..." / `Agent: ...` / errore attuali; `exit`/`quit` →
  `await session.stop({save: true})` poi shutdown (la session fa già il salvataggio col prefix
  identico a oggi — non duplicarlo in index.js).
- Mantenere: banner iniziale, prompt `MeetingTwin > `, handler SIGINT/SIGTERM, mkdir `meetings`.
- Output console: stringa per stringa identico a prima del refactor.

### 5. `package.json`

- Aggiungere `express` alle `dependencies` (ultima major stabile, installare con
  `npm install express`).
- Aggiungere script: `"gui": "node gui.js"`.

## Test da aggiungere

`test/meeting-session.test.js` (node --test): testare `MeetingSession` iniettando un
DeviceManager finto non è possibile senza modificare la classe — quindi testare ciò che è
testabile senza hardware: (a) il costruttore lancia se provider deepgram senza apiKey; (b) con
`transcriptionProvider: 'local'` il costruttore non lancia; (c) il filtro confidenza e la
ri-emissione `'transcription'` possono essere testati estraendo l'handler in un metodo
`_handleTranscriptionEvent(evt)` richiamabile direttamente nel test (aggiungerlo alla classe).
Guardare `test/device-manager.test.js` e `test/mocks/` per lo stile esistente.

## Criteri di accettazione

- [ ] `src/meeting-session.js` esiste, esporta `MeetingSession`, nessun riferimento a readline
      o console.log applicativi (il log resta nel chiamante).
- [ ] `index.js` usa `MeetingSession`; output console e comportamento identici a prima
      (confronto manuale di una sessione: banner, righe `[source]: text`, history, exit con
      salvataggio).
- [ ] `gui.js` parte con `npm run gui`, serve la shell su `http://localhost:3000`, `/api/health`
      risponde `{ok:true}`, il WS si connette e l'indicatore in pagina diventa verde; un comando
      sconosciuto via WS riceve `{type:'error'}`.
- [ ] Le 4 tab esistono come placeholder navigabili.
- [ ] Nessun file della lista "non modificare" del README è stato toccato.

## Verifica

```powershell
npm install
npm test            # tutti i test passano, inclusi i nuovi
npm run typecheck   # nessun errore
node index.js       # comportamento CLI invariato (richiede device audio configurati in .env)
npm run gui         # apre il browser sulla shell; verificare indicatore WS verde e le 4 tab
```
