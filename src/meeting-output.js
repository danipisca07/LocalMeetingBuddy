const fs = require('fs');
const path = require('path');

const RECAP_PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'recap-prompt.md');
const FALLBACK_RECAP_PROMPT = "Create a meeting recap in Italian. Format the output in Markdown.";

function loadRecapPrompt() {
  try {
    return fs.readFileSync(RECAP_PROMPT_FILE, 'utf8');
  } catch {
    console.warn(`Recap prompt file not found at ${RECAP_PROMPT_FILE}. Using fallback prompt.`);
    return FALLBACK_RECAP_PROMPT;
  }
}

/**
 * Writes the two end-of-meeting artifacts, shared by the live app and the
 * file-transcription script so both produce identical outputs:
 *   - <outDir>/<prefix>-meeting-transcript.txt  (full transcript)
 *   - <outDir>/<prefix>-meeting-recap.md         (LLM summary, unless skipped)
 *
 * @param {{getTranscript: () => string}} transcriptManager
 * @param {{query: (s: string) => Promise<string>} | null} aiClient
 * @param {{outDir?: string, prefix: string, skipLlm?: boolean}} options
 */
async function saveMeetingOutputs(transcriptManager, aiClient, options = {}) {
  const { outDir = 'meetings', prefix, skipLlm = false } = options;
  if (!prefix) throw new Error('saveMeetingOutputs requires a `prefix`');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const transcriptPath = path.join(outDir, `${prefix}-meeting-transcript.txt`);
  try {
    fs.writeFileSync(transcriptPath, transcriptManager.getTranscript());
    console.log(`\nTranscript saved to ${transcriptPath}`);
  } catch (err) {
    console.error(`\nError saving transcript: ${err.message}\n`);
  }

  if (skipLlm || !aiClient) return;

  try {
    const recap = await aiClient.query(loadRecapPrompt());
    console.log(`\nMeeting Recap: ${recap}\n`);
    const recapPath = path.join(outDir, `${prefix}-meeting-recap.md`);
    fs.writeFileSync(recapPath, recap);
    console.log(`Recap saved to ${recapPath}`);
  } catch (err) {
    console.error(`\nError generating meeting recap: ${err.message}\n`);
  }
}

module.exports = { saveMeetingOutputs };
