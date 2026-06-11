const fs = require('fs').promises;
const path = require('path');

/**
 * List all saved meetings from a directory, sorted by modification time (newest first)
 * @param {string} dir - Directory containing meeting files (default: 'meetings')
 * @returns {Promise<Array<{prefix: string, hasTranscript: boolean, hasRecap: boolean, mtimeMs: number, sizeBytes: number}>>}
 *          sorted by mtime descending (newest first)
 */
async function listMeetings(dir = 'meetings') {
  try {
    const files = await fs.readdir(dir);

    // Pattern to match meeting files: <prefix>-meeting-(transcript|recap).(txt|md)
    const regex = /^(.+)-meeting-(transcript|recap)\.(txt|md)$/;
    const meetings = new Map(); // prefix -> {hasTranscript, hasRecap, transcriptPath, recapPath}

    for (const file of files) {
      const match = file.match(regex);
      if (!match) continue;

      const prefix = match[1];
      const type = match[2]; // 'transcript' or 'recap'

      if (!meetings.has(prefix)) {
        meetings.set(prefix, {
          hasTranscript: false,
          hasRecap: false,
          transcriptPath: null,
          recapPath: null,
        });
      }

      const meeting = meetings.get(prefix);
      if (type === 'transcript') {
        meeting.hasTranscript = true;
        meeting.transcriptPath = path.join(dir, file);
      } else if (type === 'recap') {
        meeting.hasRecap = true;
        meeting.recapPath = path.join(dir, file);
      }
    }

    // Convert to array and get file stats
    const result = [];
    for (const [prefix, info] of meetings) {
      // Get stat from transcript if present, otherwise from recap
      const statPath = info.transcriptPath || info.recapPath;
      if (statPath) {
        const stat = await fs.stat(statPath);
        result.push({
          prefix,
          hasTranscript: info.hasTranscript,
          hasRecap: info.hasRecap,
          mtimeMs: stat.mtimeMs,
          sizeBytes: info.transcriptPath ? (await fs.stat(info.transcriptPath)).size : 0,
        });
      }
    }

    // Sort by mtime descending (newest first)
    result.sort((a, b) => b.mtimeMs - a.mtimeMs);

    return result;
  } catch (err) {
    // If directory doesn't exist, return empty array
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Get the full content (transcript and recap) for a specific meeting by prefix
 * @param {string} prefix - Meeting prefix (must not contain path traversal characters)
 * @param {string} dir - Directory containing meeting files (default: 'meetings')
 * @returns {Promise<{prefix: string, transcript: string|null, recap: string|null}>}
 * @throws Error if prefix is invalid (contains path traversal) or files don't exist
 */
async function getMeeting(prefix, dir = 'meetings') {
  // Sanitize prefix: reject if it contains path traversal characters or control characters
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('Invalid prefix');
  }

  // Check for path traversal: /, \, .., or control characters
  if (prefix.includes('/') || prefix.includes('\\') || prefix.includes('..') || /[\x00-\x1f\x7f]/.test(prefix)) {
    throw new Error('Invalid prefix');
  }

  // Verify that resolved paths stay within the directory
  const baseDir = path.resolve(dir);
  const transcriptPath = path.resolve(dir, `${prefix}-meeting-transcript.txt`);
  const recapPath = path.resolve(dir, `${prefix}-meeting-recap.md`);

  // Ensure resolved paths are within the directory
  if (!transcriptPath.startsWith(baseDir) || !recapPath.startsWith(baseDir)) {
    throw new Error('Invalid prefix');
  }

  let transcript = null;
  let recap = null;
  let foundAny = false;

  // Try to read transcript
  try {
    transcript = await fs.readFile(transcriptPath, 'utf8');
    foundAny = true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // Try to read recap
  try {
    recap = await fs.readFile(recapPath, 'utf8');
    foundAny = true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // If neither file exists, throw error
  if (!foundAny) {
    throw new Error('Meeting not found');
  }

  return { prefix, transcript, recap };
}

module.exports = { listMeetings, getMeeting };
