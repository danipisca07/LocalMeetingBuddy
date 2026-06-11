const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { listMeetings, getMeeting } = require('../src/meeting-history');

// Helper to create a temporary directory
async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-history-test-'));
}

// Helper to cleanup a directory
async function cleanupDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

test('listMeetings: returns empty array for nonexistent directory', async () => {
  const result = await listMeetings('/nonexistent/path');
  assert.deepStrictEqual(result, []);
});

test('listMeetings: groups files by prefix', async () => {
  const tempDir = await createTempDir();
  try {
    // Create test files
    await fs.writeFile(path.join(tempDir, '2026-06-11T1530-meeting-transcript.txt'), 'transcript content');
    await fs.writeFile(path.join(tempDir, '2026-06-11T1530-meeting-recap.md'), '# recap content');

    const result = await listMeetings(tempDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].prefix, '2026-06-11T1530');
    assert.strictEqual(result[0].hasTranscript, true);
    assert.strictEqual(result[0].hasRecap, true);
  } finally {
    await cleanupDir(tempDir);
  }
});

test('listMeetings: handles meeting with only transcript', async () => {
  const tempDir = await createTempDir();
  try {
    await fs.writeFile(path.join(tempDir, 'test-prefix-meeting-transcript.txt'), 'content');

    const result = await listMeetings(tempDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].hasTranscript, true);
    assert.strictEqual(result[0].hasRecap, false);
  } finally {
    await cleanupDir(tempDir);
  }
});

test('listMeetings: ignores files that do not match pattern', async () => {
  const tempDir = await createTempDir();
  try {
    await fs.writeFile(path.join(tempDir, 'some-random-file.txt'), 'content');
    await fs.writeFile(path.join(tempDir, 'test-meeting-transcript.txt'), 'content');

    const result = await listMeetings(tempDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].prefix, 'test');
  } finally {
    await cleanupDir(tempDir);
  }
});

test('listMeetings: sorts by modification time descending (newest first)', async () => {
  const tempDir = await createTempDir();
  try {
    // Create older file
    const oldPath = path.join(tempDir, '2026-02-01T1000-meeting-transcript.txt');
    await fs.writeFile(oldPath, 'old content');

    // Wait a bit and create newer file
    await new Promise(resolve => setTimeout(resolve, 100));
    const newPath = path.join(tempDir, '2026-06-11T1530-meeting-transcript.txt');
    await fs.writeFile(newPath, 'new content');

    const result = await listMeetings(tempDir);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].prefix, '2026-06-11T1530');
    assert.strictEqual(result[1].prefix, '2026-02-01T1000');
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: returns transcript and recap', async () => {
  const tempDir = await createTempDir();
  try {
    const prefix = 'test-meeting';
    await fs.writeFile(
      path.join(tempDir, `${prefix}-meeting-transcript.txt`),
      'transcript content'
    );
    await fs.writeFile(
      path.join(tempDir, `${prefix}-meeting-recap.md`),
      '# Recap\nContent'
    );

    const result = await getMeeting(prefix, tempDir);
    assert.strictEqual(result.prefix, prefix);
    assert.strictEqual(result.transcript, 'transcript content');
    assert.strictEqual(result.recap, '# Recap\nContent');
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: returns null for missing recap', async () => {
  const tempDir = await createTempDir();
  try {
    const prefix = 'test-meeting';
    await fs.writeFile(
      path.join(tempDir, `${prefix}-meeting-transcript.txt`),
      'transcript content'
    );

    const result = await getMeeting(prefix, tempDir);
    assert.strictEqual(result.transcript, 'transcript content');
    assert.strictEqual(result.recap, null);
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: throws error if neither transcript nor recap exists', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('nonexistent', tempDir),
      /Meeting not found/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: rejects prefix with path traversal (..) characters', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('..\\..\\package', tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: rejects prefix with forward slash', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('../etc/passwd', tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: rejects prefix with backslash', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('..\\..\\windows\\system', tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: rejects prefix with control characters', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('test\x00file', tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: rejects empty or invalid prefix', async () => {
  const tempDir = await createTempDir();
  try {
    await assert.rejects(
      () => getMeeting('', tempDir),
      /Invalid prefix/
    );

    await assert.rejects(
      () => getMeeting(null, tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

test('getMeeting: verifies resolved path stays within directory bounds', async () => {
  const tempDir = await createTempDir();
  const parentDir = path.dirname(tempDir);
  try {
    // Try to access a file outside the directory using path traversal
    // This should be blocked even if the resolved path check wasn't there
    await assert.rejects(
      () => getMeeting(`..${path.sep}..${path.sep}package`, tempDir),
      /Invalid prefix/
    );
  } finally {
    await cleanupDir(tempDir);
  }
});
