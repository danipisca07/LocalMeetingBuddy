# Fase 1 — Meeting live nella GUI

## Obiettivo

Rendere funzionante la tab **Meeting Live**: avvio/stop del meeting dal browser, trascrizione in
tempo reale, chat AI contestuale, salvataggio di transcript e recap allo stop — l'equivalente
completo di `node index.js` ma via GUI.

Leggere prima `plans/gui/README.md` (protocollo WebSocket e convenzioni) e assicurarsi che la
fase 0 sia completata.

## Prerequisiti

- Fase 0 completata: esistono `src/meeting-session.js` (classe `MeetingSession` con `start()`,
  `stop({save})`, `query(text)`, `getTranscript()`, `isRunning`, eventi `'transcription'`,
  `'status'`, `'error'`), `gui.js` con server express + WS e dispatcher comandi, `public/` con
  shell a 4 tab e client WS con registro handler.

## Contesto essenziale

- Il salvataggio allo stop è già dentro `MeetingSession.stop({save: true})`: scrive
  `meetings/<prefix>-meeting-transcript.txt` e `meetings/<prefix>-meeting-recap.md` via
  `saveMeetingOutputs` (`src/meeting-output.js`). Il recap richiede una query LLM e può
  impiegare diversi secondi.
- I device audio sono risorse esclusive: una sola `MeetingSession` attiva per processo.
- La configurazione arriva ancora dalle env (il `ConfigManager` è oggetto della fase 3):
  leggere `TRANSCRIPTION_PROVIDER`, `DEEPGRAM_API_KEY`, `IS_LIVE_MEETING`,
  `AUDIO_DEVICE_ID_MIC`, `AUDIO_DEVICE_ID_SYSTEM`, `SKIP_LLM` in `gui.js` al momento di creare
  la sessione, esattamente come fa `index.js`.

## Modifiche al server (`gui.js`)

Stato del modulo: `let meetingSession = null;` e uno stato corrente
(`'idle'|'starting'|'running'|'stopping'|'stopped'|'error'`) ritrasmesso ai client che si
connettono a meeting già in corso (alla connessione WS, inviare subito l'ultimo `status` noto).

Implementare i casi del dispatcher comandi:

### `startMeeting`

1. Se `meetingSession` esiste ed è running, o c'è un job batch attivo (fase 2 — se non ancora
   implementata, ignorare questa parte ma lasciare un commento/punto di aggancio): rispondere al
   mittente `{type:'error', data:{message:'Meeting già in corso'}}` e non fare nulla.
2. Broadcast `{type:'status', data:{state:'starting'}}`.
3. Creare `new MeetingSession({...config da env...})` dentro try/catch: su errore (es. API key
   mancante) broadcast `{type:'status', data:{state:'error', message: err.message}}` e reset a
   `meetingSession = null`.
4. Collegare gli eventi della sessione al broadcast:
   - `'transcription'` → `{type:'transcription', data: evt}`
   - `'status'` → `{type:'status', data: evt}`
   - `'error'` → `{type:'status', data:{state:'error', message: err.message}}`
5. `await session.start()` in try/catch: su errore, stesso trattamento del punto 3.

### `stopMeeting`

1. Se nessuna sessione attiva → `{type:'error', data:{message:'Nessun meeting in corso'}}` al
   mittente.
2. Broadcast `{type:'status', data:{state:'stopping', message:'Salvataggio in corso…'}}` (il
   recap LLM può richiedere tempo).
3. `await session.stop({save: true})` in try/catch; la sessione emette già
   `{state:'stopped'}`. Aggiungere al messaggio di stato finale i percorsi dei file salvati se
   facilmente ricavabili (il prefix è deterministico: la `MeetingSession` può esporre l'ultimo
   prefix usato, es. proprietà `lastSavePrefix` valorizzata in `stop()` — piccola aggiunta
   consentita a `src/meeting-session.js`).
4. `meetingSession = null`.

### `query`

1. Se nessuna sessione attiva → `{type:'ai-error', data:{message:'Nessun meeting in corso'}}`.
2. `const text = await session.query(msg.text)` in try/catch → broadcast
   `{type:'ai-response', data:{text}}`; su errore broadcast `{type:'ai-error',
   data:{message: err.message}}`.

### `getTranscript`

Rispondere al mittente `{type:'transcript', data:{text: session ? session.getTranscript() : ''}}`.

Nota concorrenza: il dispatcher è async; proteggere `startMeeting`/`stopMeeting` da invocazioni
sovrapposte con un semplice flag di transizione (ignorare comandi mentre `starting`/`stopping`).

## Modifiche al frontend (`public/`)

Tab **Meeting Live** (`#tab-live`), layout a due pannelli verticali:

```
┌──────────────────────────────────────────────┐
│ Stato: ● In corso          [Avvia] [Termina] │
├──────────────────────────────────────────────┤
│ Trascrizione                                 │
│ ┌──────────────────────────────────────────┐ │
│ │ [user]: ciao a tutti…                    │ │
│ │ [caller-0]: buongiorno…                  │ │  ← autoscroll
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ Chat AI                                      │
│ ┌──────────────────────────────────────────┐ │
│ │ Tu: riassumi gli ultimi punti            │ │
│ │ Agent: …                                 │ │
│ └──────────────────────────────────────────┘ │
│ [ input domanda…                  ] [Invia]  │
└──────────────────────────────────────────────┘
```

Comportamenti:

- Bottone **Avvia** → invia `{command:'startMeeting'}`; **Termina** → `{command:'stopMeeting'}`.
  Abilitazione dei bottoni guidata dallo stato: Avvia attivo solo in
  `idle|stopped|error`, Termina solo in `running`. Durante `starting`/`stopping` entrambi
  disabilitati con messaggio di stato visibile (es. "Salvataggio in corso…").
- Handler `transcription`: appende una riga `[source]: text` al pannello trascrizione con
  autoscroll (solo se l'utente è già in fondo, per non interrompere la lettura). Usare
  `textContent` per inserire il testo (mai innerHTML con dati dinamici).
- Handler `status`: aggiorna badge di stato (colore + testo) e l'eventuale `message`. Su
  `stopped` mostrare una notifica inline "Meeting salvato" (+ percorsi file se presenti nel
  messaggio).
- Chat AI: invio con bottone o Enter; alla submit appende "Tu: …", mostra indicatore
  "L'agente sta pensando…", disabilita l'input fino a `ai-response`/`ai-error`; appende la
  risposta (o l'errore in rosso). La chat è utilizzabile solo con meeting in corso.
- Alla connessione/riconnessione WS, inviare `{command:'getTranscript'}` e ripopolare il
  pannello trascrizione dal risultato (handler `transcript`), così un refresh della pagina non
  perde la vista del meeting in corso.

## Criteri di accettazione

- [ ] Dal browser: Avvia → stato "In corso", le righe di trascrizione compaiono in tempo reale
      mentre si parla, con le stesse etichette della CLI (`user`/`caller-N`/`live-N`…).
- [ ] Una domanda nella chat AI riceve la risposta dell'agente (stesso comportamento della CLI).
- [ ] Termina → stato passa per "stopping" e arriva a "stopped"; in `meetings/` compaiono
      `<prefix>-meeting-transcript.txt` e (senza SKIP_LLM) `<prefix>-meeting-recap.md` con lo
      stesso formato prodotto dalla CLI.
- [ ] Refresh della pagina durante un meeting: la trascrizione viene ripopolata e lo stato è
      corretto. Una seconda tab mostra la stessa vista (broadcast).
- [ ] Avviare due volte → errore "Meeting già in corso", nessun crash.
- [ ] `node index.js` continua a funzionare come prima (nessuna regressione CLI).
- [ ] `npm test` e `npm run typecheck` passano.

## Verifica

```powershell
npm test
npm run typecheck
npm run gui
# Manuale nel browser: avvio → parlare al microfono → trascrizione visibile → query AI →
# termina → controllare i file in meetings/ e confrontare il formato con un output della CLI.
```

Se non si dispone di device audio per il test live, verificare almeno: gestione errori di
avvio (es. device ID inesistente → status 'error' mostrato in GUI senza crash del server) e il
flusso `getTranscript`/refresh.
