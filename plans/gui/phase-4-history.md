# Fase 4 — Storico meeting nella GUI

## Obiettivo

Rendere funzionante la tab **Storico**: elenco dei meeting salvati nella cartella `meetings/`
con possibilità di leggere transcript e recap di ciascuno.

Leggere prima `plans/gui/README.md` (convenzioni, route HTTP) e assicurarsi che le fasi
precedenti siano completate (serve almeno la fase 0; il refresh automatico aggancia eventi
delle fasi 1–2 se presenti).

## Prerequisiti

- Fase 0: `gui.js` con express, `public/` con shell a tab e registro handler WS.

## Contesto essenziale

`src/meeting-output.js` salva ogni meeting come coppia di file in `meetings/` (o `--out`
custom, ma la GUI considera solo `meetings/`):

- `<prefix>-meeting-transcript.txt` — transcript completo
- `<prefix>-meeting-recap.md` — recap LLM (assente se skipLlm o errore LLM)

Il `prefix` è una ISO date troncata (es. `2026-02-05T1830`) per i meeting live, oppure il
basename del file di input per i batch (es. `riunione-cliente`). Nella cartella possono esserci
anche prefissi storici diversi (timestamp epoch ms). Non assumere un formato di prefix: trattare
il prefix come stringa opaca e usare l'mtime del file per data e ordinamento.

## File da creare

### 1. `src/meeting-history.js` (nuovo, CJS)

```js
/**
 * @returns {Promise<Array<{prefix: string, hasTranscript: boolean, hasRecap: boolean,
 *                          mtimeMs: number, sizeBytes: number}>>}
 *          sorted by mtime descending (newest first)
 */
async function listMeetings(dir = 'meetings') { /* ... */ }

/**
 * @returns {Promise<{prefix: string, transcript: string|null, recap: string|null}>}
 * @throws  on invalid prefix (path traversal) or when neither file exists
 */
async function getMeeting(prefix, dir = 'meetings') { /* ... */ }

module.exports = { listMeetings, getMeeting };
```

Dettagli:

- `listMeetings`: `fs.promises.readdir`; raggruppare per prefix con la regex
  `^(.+)-meeting-(transcript|recap)\.(txt|md)$` (transcript→`.txt`, recap→`.md`; ignorare file
  che non matchano). `mtimeMs`/`sizeBytes` dal transcript se presente, altrimenti dal recap
  (`fs.promises.stat`). Directory inesistente → ritornare `[]` (non errore).
- `getMeeting`: **sanificare il prefix** — rifiutare con throw se contiene `/`, `\`, `..` o
  caratteri di controllo, e verificare comunque che i path risolti
  (`path.resolve(dir, ...)`) restino dentro `path.resolve(dir)` (difesa dal path traversal).
  Leggere i due file in utf8; quello mancante → `null`; entrambi mancanti → throw.

### 2. Modifiche a `gui.js`

- **`GET /api/meetings`** → `listMeetings()`, risposta JSON; 500 con `{error}` su errore
  imprevisto.
- **`GET /api/meetings/:prefix`** → `getMeeting(req.params.prefix)`; 404 con `{error:'Meeting
  non trovato'}` se il throw indica file mancanti o prefix non valido (400 per prefix non
  valido va bene in alternativa, ma non esporre dettagli del filesystem nei messaggi).

### 3. `public/` — tab Storico (`#tab-history`)

```
┌──────────────────────────────────────────────┐
│ Meeting salvati                 [Aggiorna]   │
│ ┌──────────────────────────────────────────┐ │
│ │ 2026-06-11T1530   52 KB  [📄] [📝]      │ │  📄 transcript, 📝 recap (se presente)
│ │ riunione-cliente  18 KB  [📄] [📝]      │ │
│ │ 2026-02-05T1103   75 KB  [📄]           │ │
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ 2026-06-11T1530 — Transcript | Recap         │
│ ┌──────────────────────────────────────────┐ │
│ │ <contenuto in <pre>, scrollabile>        │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- All'apertura della tab (e con **Aggiorna**): `GET /api/meetings`, lista ordinata dal più
  recente, con data leggibile (da `mtimeMs`, locale it) e dimensione formattata.
- Click su un meeting → `GET /api/meetings/<prefix>` (encodeURIComponent) → viewer con due
  sotto-tab/bottoni "Transcript" e "Recap" (Recap disabilitato se `recap === null`). Contenuto
  in `<pre>` con `textContent` (il recap è markdown mostrato raw: accettabile per questa
  versione).
- Refresh automatico della lista quando arriva via WS `{type:'status', data:{state:'stopped'}}`
  (fine meeting live) o `{type:'batch-progress', data:{state:'done'}}` (fine batch), se questi
  handler esistono (fasi 1–2): agganciarsi al registro handler senza sovrascrivere quelli
  esistenti (es. supportare una lista di subscriber per tipo, o chiamare la funzione di refresh
  dagli handler esistenti).

## Test da aggiungere

`test/meeting-history.test.js` (node --test, su directory temporanea creata nel test):

- `listMeetings`: raggruppa transcript+recap per prefix; meeting senza recap → `hasRecap:
  false`; ordina per mtime discendente; directory inesistente → `[]`; file estranei ignorati.
- `getMeeting`: ritorna i contenuti; recap mancante → `null`; prefix con `..`/`/`/`\` → throw;
  prefix inesistente → throw.

## Criteri di accettazione

- [ ] La tab Storico elenca i meeting già presenti in `meetings/` (inclusi quelli con prefissi
      storici di formato diverso), dal più recente.
- [ ] Apertura di transcript e recap funzionante; meeting senza recap gestito (bottone
      disabilitato, nessun errore).
- [ ] `GET /api/meetings/..%2F..%2Fpackage` (e simili) → 400/404, mai contenuto di file fuori
      da `meetings/`.
- [ ] Dopo la fine di un meeting live o di un batch, la lista si aggiorna da sola.
- [ ] `npm test` e `npm run typecheck` passano.

## Verifica

```powershell
npm test
npm run typecheck
npm run gui
# Manuale: aprire la tab Storico con file esistenti in meetings/; aprire transcript e recap;
# provare un prefix malevolo via curl:
#   curl http://localhost:3000/api/meetings/..%2F..%2Fpackage.json   → 400/404
# completare un meeting o un batch e verificare il refresh automatico della lista.
```
