import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

/** Resolved on-disk paths of every model file the local provider needs. */
export interface LocalModelPaths {
  whisperEncoder: string;
  whisperDecoder: string;
  whisperTokens: string;
  sileroVad: string;
  speakerEmbedding: string;
}

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const WHISPER_SIZES = ['tiny', 'base', 'small', 'medium'] as const;
export type WhisperSize = (typeof WHISPER_SIZES)[number];

// Note: "recongition" is a typo in the upstream sherpa-onnx release tag, not here.
const SILERO_VAD_URL = `${RELEASE_BASE}/asr-models/silero_vad.onnx`;
const SPEAKER_MODEL_FILE = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';
const SPEAKER_MODEL_URL = `${RELEASE_BASE}/speaker-recongition-models/${SPEAKER_MODEL_FILE}`;

export function getWhisperSize(): WhisperSize {
  const size = (process.env.LOCAL_WHISPER_MODEL || 'base').toLowerCase();
  if (!WHISPER_SIZES.includes(size as WhisperSize)) {
    throw new Error(
      `Invalid LOCAL_WHISPER_MODEL "${size}". Valid values: ${WHISPER_SIZES.join(', ')}`
    );
  }
  return size as WhisperSize;
}

export function getModelsDir(): string {
  const dir = process.env.LOCAL_TRANSCRIPTION_MODELS_DIR
    || path.join(os.homedir(), '.meetingtwin', 'models');
  return path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function whisperFiles(modelsDir: string, size: WhisperSize) {
  const dir = path.join(modelsDir, `sherpa-onnx-whisper-${size}`);
  return {
    dir,
    encoder: path.join(dir, `${size}-encoder.int8.onnx`),
    decoder: path.join(dir, `${size}-decoder.int8.onnx`),
    tokens: path.join(dir, `${size}-tokens.txt`),
  };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`[local-transcription] Downloading ${url} ...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status}) for ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`[local-transcription] Saved ${dest}`);
}

/** Extracts a .tar.bz2 archive using the system `tar` (bsdtar on Windows 10+, GNU/bsd tar on Linux/macOS). */
function extractTarBz2(archive: string, destDir: string): Promise<void> {
  // On Windows use System32's bsdtar explicitly: a GNU tar from Git/MSYS may
  // shadow it in PATH and misparse "C:\..." paths as remote hosts. Running
  // with cwd=destDir and a relative archive name avoids drive-letter parsing.
  const tarBin = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  return new Promise((resolve, reject) => {
    const proc = spawn(tarBin, ['-xjf', path.basename(archive)], { cwd: destDir, stdio: 'inherit' });
    proc.on('error', (err) =>
      reject(new Error(`Failed to run system "tar" (required to extract models): ${err.message}`)));
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with code ${code} extracting ${archive}`)));
  });
}

async function ensureWhisperModel(modelsDir: string, size: WhisperSize): Promise<void> {
  const files = whisperFiles(modelsDir, size);
  if (fs.existsSync(files.encoder) && fs.existsSync(files.decoder) && fs.existsSync(files.tokens)) {
    return;
  }
  const archive = path.join(modelsDir, `sherpa-onnx-whisper-${size}.tar.bz2`);
  if (!fs.existsSync(archive)) {
    await downloadFile(`${RELEASE_BASE}/asr-models/sherpa-onnx-whisper-${size}.tar.bz2`, archive);
  }
  console.log(`[local-transcription] Extracting ${archive} ...`);
  await extractTarBz2(archive, modelsDir);
  if (!fs.existsSync(files.encoder) || !fs.existsSync(files.decoder) || !fs.existsSync(files.tokens)) {
    throw new Error(
      `Whisper model extraction did not produce the expected files in ${files.dir}. ` +
      `Delete ${archive} and retry, or download manually from ${RELEASE_BASE}/asr-models/`
    );
  }
  fs.rmSync(archive, { force: true });
}

async function ensureSingleFile(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) return;
  await downloadFile(url, dest);
}

/**
 * Ensures every model needed by the local provider is present on disk,
 * downloading them on first use, and returns their paths.
 */
export async function ensureModels(): Promise<LocalModelPaths> {
  const modelsDir = getModelsDir();
  const size = getWhisperSize();
  fs.mkdirSync(modelsDir, { recursive: true });

  await ensureWhisperModel(modelsDir, size);
  const vadPath = path.join(modelsDir, 'silero_vad.onnx');
  await ensureSingleFile(SILERO_VAD_URL, vadPath);
  const speakerPath = path.join(modelsDir, SPEAKER_MODEL_FILE);
  await ensureSingleFile(SPEAKER_MODEL_URL, speakerPath);

  const files = whisperFiles(modelsDir, size);
  return {
    whisperEncoder: files.encoder,
    whisperDecoder: files.decoder,
    whisperTokens: files.tokens,
    sileroVad: vadPath,
    speakerEmbedding: speakerPath,
  };
}
