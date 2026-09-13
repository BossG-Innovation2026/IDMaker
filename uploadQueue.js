const fs = require('fs');
const path = require('path');
const store = require('./store');
const googleDrive = require('./googleDrive');

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;

const queue = [];
const queuedIds = new Set();
let active = 0;

function enqueue(studentId) {
  if (queuedIds.has(studentId)) return;
  queuedIds.add(studentId);
  queue.push(studentId);
  pump();
}

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const id = queue.shift();
    queuedIds.delete(id);
    active++;
    processStudent(id)
      .catch(err => console.error('Queue job crashed:', err.message))
      .finally(() => { active--; pump(); });
  }
}

function buildFiles(student) {
  const base = `${student.lastName}_${student.firstName}`;
  const photoPath = path.join(__dirname, 'uploads', student.photoPath);
  if (!fs.existsSync(photoPath)) return null;

  const photoExt = path.extname(student.photoPath) || '.jpg';
  const files = [{
    key: 'photo',
    name: `${base}_PIC${photoExt}`,
    mimeType: student.photoMime || 'image/jpeg',
    buffer: fs.readFileSync(photoPath)
  }];

  if (student.idCardPath) {
    const idPath = path.isAbsolute(student.idCardPath)
      ? student.idCardPath
      : path.join(__dirname, student.idCardPath);
    if (fs.existsSync(idPath)) {
      files.push({
        key: 'idCard',
    name: `${base}_ID.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: fs.readFileSync(idPath)
      });
    }
  }

  return files;
}

async function processStudent(id) {
  const student = store.find(id);
  if (!student) return;
  if (student.uploadStatus === 'uploaded') return;

  store.update(id, { uploadStatus: 'uploading', uploadError: null });

  const files = buildFiles(student);
  if (!files) {
    store.update(id, {
      uploadStatus: 'failed',
      uploadError: 'Staged files missing on disk (instance restarted?)'
    });
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = {};
      let sectionFolderId = null;
      for (const file of files) {
        const result = await googleDrive.uploadStudentPhoto(
          file.buffer, file.name, file.mimeType, student.section
        );
        if (!result.success) throw new Error(result.error || 'upload failed');
        results[file.key] = result;
        if (result.folderId) sectionFolderId = result.folderId;
      }

      const fileLinks = {
        photo: results.photo ? results.photo.fileLink : null,
        idCard: results.idCard ? results.idCard.fileLink : null
      };

      if (sectionFolderId) {
        await googleDrive.appendStudentRow(student, fileLinks, sectionFolderId);
      }

      store.update(id, {
        uploadStatus: 'uploaded',
        uploadError: null,
        driveUploaded: true,
        driveLink: results.photo ? results.photo.fileLink : null,
        driveFiles: results
      });
      console.log(`✓ Drive upload complete: ${student.lastName}_${student.firstName} → ${student.section}/`);
      return;
    } catch (error) {
      lastError = error.message || String(error);
      console.error(`Drive upload attempt ${attempt}/${MAX_ATTEMPTS} failed (${id}): ${lastError}`);
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }

  store.update(id, { uploadStatus: 'failed', uploadError: lastError });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stats() {
  return { queued: queue.length, active, concurrency: CONCURRENCY };
}

module.exports = { enqueue, stats };
