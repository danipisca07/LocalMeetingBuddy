# Fase 3 — Pannello configurazione nella GUI

## Obiettivo

Rendere funzionante la tab **Configurazione**: scelta dei dispositivi audio (mic e loopback di
sistema), del provider di trascrizione, della lingua e dei flag principali — senza modificare a
mano il file `.env`. Le impostazioni valgono per la sessione GUI corrente (in-memory).

Leggere prima `plans/gui/README.md` (convenzioni, route HTTP) e assicurarsi che le fasi 0–2
siano completate.

## Prerequisiti

- Fase 0: `gui.js` con express e dispatcher WS.
- Fase 1: comando `startMeeting` in `gui.js` (oggi legge la config dalle env).
- Fase 2: comando `startBatch` in `gui.js`.

## Contesto essenziale

- Le factory esistenti (`createTranscriptionService`, `createAIService`, servizi locali) leggono
  la configurazione **da `process.env`** al momento della creazione. Strategia: il
  `ConfigManager` tiene lo stato in-memory e lo riversa su `process.env` con `applyToEnv()`
  prima di creare sessioni/job — così **nessuna modifica** ai moduli esistenti.
- **Persistenza: in-memory per sessione del server.** Niente scrittura del file `.env` in questa
  versione (evita corruzione/perdita di commenti). Il `.env` resta la sorgente dei default al
  boot. Un eventuale "Salva su .env" è estensione futura.
- Le **API key non vanno mai esposte** via HTTP/WS: il ConfigManager non le gestisce proprio.
- Lista dispositivi: `require('naudiodon').getDevices()`, filtrare `maxInputChannels > 0`;
  euristica loopback come `scripts/check-audio.js` (nome contenente `loopback`, `stereo mix`,
  `virtual`, `vb-audio`).

## File da creare

### 1. `src/config-manager.js` (nuovo, CJS)

```js
const MANAGED_KEYS = {
  transcriptionProvider: 'TRANSCRIPTION_PROVIDER',
  audioDeviceIdMic: 'AUDIO_DEVICE_ID_MIC',
  audioDeviceIdSystem: 'AUDIO_DEVICE_ID_SYSTEM',
  isLiveMeeting: 'IS_LIVE_MEETING',
  skipLlm: 'SKIP_LLM',
  deepgramLanguage: 'DEEPGRAM_LANGUAGE',
  localWhisperModel: 'LOCAL_WHISPER_MODEL',
  localTranscriptionLanguage: 'LOCAL_TRANSCRIPTION_LANGUAGE',
};

class ConfigManager {
  constructor() { this.config = this._loadFromEnv(); }
  _loadFromEnv() { /* legge process.env per ogni MANAGED_KEY; boolean per isLiveMeeting/skipLlm */ }
  get() { /* copia difensiva di this.config */ }
  update(partial) { /* valida e fonde; ignora chiavi sconosciute; ritorna la config aggiornata */ }
  applyToEnv() { /* scrive ogni valore su process.env[ENV_NAME]; boolean → 'true'/'false' */ }
}
module.exports = { ConfigManager, MANAGED_KEYS };
```

Validazioni in `update()`: `transcriptionProvider` ∈ {`deepgram`, `local`} (lowercase);
`audioDeviceIdMic`/`audioDeviceIdSystem` stringa numerica o vuota; boolean veri per i flag;
`localWhisperModel` ∈ {`tiny`,`base`,`small`,`medium`} se valorizzato; lingue stringa breve
(`it`, `en`, …) senza validazione rigida. Valore non valido → throw `Error` con messaggio
esplicito (il server lo trasforma in 400).

### 2. Modifiche a `gui.js`

- Istanziare `const configManager = new ConfigManager()` all'avvio (dopo dotenv).
- **`GET /api/devices`**: `naudiodon.getDevices()` filtrati per input; risposta
  `[{id, name, maxInputChannels, defaultSampleRate, isLoopbackCandidate}]`. Caricare naudiodon
  in try/catch: se il modulo nativo fallisce, rispondere 500 con `{error: message}`.
- **`GET /api/config`**: `configManager.get()`.
- **`POST /api/config`**: rifiutare con 409 se meeting live o job batch in corso
  (`{error:'Impossibile modificare la configurazione durante un meeting o una trascrizione'}`);
  altrimenti `update(req.body)` (400 su errore di validazione) + `applyToEnv()`, risposta
  `{ok:true, config}`.
- **`startMeeting`** (fase 1) e **`startBatch`** (fase 2): prima di creare sessione/job,
  chiamare `configManager.applyToEnv()` e leggere i valori da `configManager.get()` invece che
  direttamente dalle env (per `deepgramApiKey` continuare a leggere `process.env.DEEPGRAM_API_KEY`,
  che non è gestita dal ConfigManager).

### 3. `public/` — tab Configurazione (`#tab-config`)

```
┌──────────────────────────────────────────────┐
│ Dispositivi audio              [Aggiorna]    │
│ Microfono:      [ (1) Microphone … ▾ ]       │
│ Audio sistema:  [ (4) VB-Audio …  ▾ ]  ★     │  ★ = candidato loopback evidenziato
├──────────────────────────────────────────────┤
│ Trascrizione                                 │
│ Provider: [deepgram ▾]   Lingua: [it]        │
│ Modello Whisper locale: [base ▾]             │
├──────────────────────────────────────────────┤
│ Opzioni                                      │
│ [x] Meeting dal vivo (IS_LIVE_MEETING)       │
│ [ ] Salta recap LLM (SKIP_LLM)               │
├──────────────────────────────────────────────┤
│ [Salva]   Le modifiche valgono per la        │
│           sessione corrente della GUI.       │
└──────────────────────────────────────────────┘
```

- All'apertura della tab: `GET /api/config` per popolare i campi e `GET /api/devices` per le
  select dei dispositivi (opzione vuota "— da .env —" quando l'ID non è impostato). Bottone
  **Aggiorna** ricarica i dispositivi. I candidati loopback vanno marcati visivamente nella
  select dell'audio di sistema.
- **Salva** → `POST /api/config` con i valori del form; mostrare conferma inline o l'errore
  (400/409) restituito dal server.
- Mostrare i campi Whisper/lingua locale solo (o evidenziati) quando provider = `local`, e la
  lingua Deepgram quando provider = `deepgram` (semplice show/hide, non bloccante).
- Nota fissa in fondo alla tab: le modifiche sono per-sessione e non scrivono il file `.env`.

## Test da aggiungere

`test/config-manager.test.js` (node --test, nessun hardware richiesto):

- `_loadFromEnv`/costruttore: legge i default dalle env (impostare/ripulire `process.env` nel
  test).
- `update`: fonde valori validi, ignora chiavi sconosciute, throw su provider non valido.
- `applyToEnv`: scrive i valori su `process.env` (boolean come `'true'`/`'false'`).
- Verificare che il ConfigManager non contenga mai chiavi API (nessuna chiave `*ApiKey` in
  `get()`).

## Criteri di accettazione

- [ ] `GET /api/devices` elenca i dispositivi di input con flag loopback corretto (confrontare
      con `node scripts/check-audio.js`).
- [ ] Dalla GUI: cambiare provider/device e salvare → il **prossimo** meeting live o batch usa
      i nuovi valori (verificabile con provider `local` vs `deepgram` nei log/output).
- [ ] `POST /api/config` durante un meeting in corso → 409, GUI mostra l'errore.
- [ ] Nessuna API key compare in alcuna risposta HTTP/WS (ispezionare `GET /api/config`).
- [ ] Il file `.env` non viene mai modificato; la CLI (`node index.js`) continua a leggere il
      `.env` come prima.
- [ ] `npm test` e `npm run typecheck` passano.

## Verifica

```powershell
npm test
npm run typecheck
node scripts\check-audio.js    # confronto lista dispositivi con GET /api/devices
npm run gui
# Manuale: cambiare config dalla tab, avviare un meeting/batch e verificare che usi i nuovi
# valori; verificare il 409 con meeting in corso; verificare che .env sia intatto (git diff).
```
