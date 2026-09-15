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
  const files = [];

  const photoPath = path.join(__dirname, 'uploads', student.photoPath);
  if (!fs.existsSync(photoPath)) {
    console.error(`Photo file not found: ${photoPath}`);
    return null;
  }

  const photoExt = path.extname(student.photoPath) || '.jpg';
  files.push({
    key: 'photo',
    name: `${base}_PIC${photoExt}`,
    mimeType: student.photoMime || 'image/jpeg',
    buffer: fs.readFileSync(photoPath)
  });
  console.log(`Photo ready: ${base}_PIC${photoExt} (${files[0].buffer.length} bytes)`);

  if (student.idCardPath) {
    const idPath = path.isAbsolute(student.idCardPath)
      ? student.idCardPath
      : path.join(__dirname, student.idCardPath);
    if (fs.existsSync(idPath)) {
      const ext = path.extname(idPath).slice(1) || 'pdf';
      const isPdf = ext === 'pdf';
      const buf = fs.readFileSync(idPath);
      files.push({
        key: 'idCard',
        name: `${base}_ID.${ext}`,
        mimeType: isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: buf
      });
      console.log(`ID Card (${ext.toUpperCase()}) ready: ${base}_ID.${ext} (${buf.length} bytes)`);
    } else {
      console.error(`ID Card file not found: ${idPath}`);
    }
  }

  if (student.idCardDocxPath) {
    const docxPath = path.isAbsolute(student.idCardDocxPath)
      ? student.idCardDocxPath
      : path.join(__dirname, student.idCardDocxPath);
    if (fs.existsSync(docxPath)) {
      const alreadyHasDocx = files.find(f => f.name.endsWith('.docx'));
      if (!alreadyHasDocx) {
        const buf = fs.readFileSync(docxPath);
        files.push({
          key: 'idCardDocx',
          name: `${base}_ID.docx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: buf
        });
        console.log(`ID Card (DOCX) ready: ${base}_ID.docx (${buf.length} bytes)`);
      }
    } else {
      console.error(`DOCX file not found: ${docxPath}`);
    }
  }

  console.log(`Total files to upload: ${files.length}`);
  return files.length > 0 ? files : null;
}

async function processStudent(id) {
  const student = store.find(id);
  if (!student) return;
  if (student.uploadStatus === 'uploaded') return;

  console.log(`\n=== Processing upload: ${student.lastName}_${student.firstName} (${student.section}) ===`);
  store.update(id, { uploadStatus: 'uploading', uploadError: null });

  const files = buildFiles(student);
  if (!files) {
    const msg = 'Files missing on disk - ID card generation may have failed';
    console.error(msg);
    store.update(id, { uploadStatus: 'failed', uploadError: msg });
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = {};
      let sectionFolderId = null;
      for (const file of files) {
        console.log(`Uploading ${file.name} (${(file.buffer.length / 1024).toFixed(1)}KB) to ${student.section}/...`);
        const result = await googleDrive.uploadStudentPhoto(
          file.buffer, file.name, file.mimeType, student.section
        );
        if (!result.success) throw new Error(result.error || 'upload failed');
        results[file.key] = result;
        if (result.folderId) sectionFolderId = result.folderId;
        console.log(`Uploaded ${file.name} → ${result.fileLink}`);
      }

      const fileLinks = {
        photo: results.photo ? results.photo.fileLink : null,
        idCard: results.idCard ? results.idCard.fileLink : null,
        idCardDocx: results.idCardDocx ? results.idCardDocx.fileLink : null
      };

      if (sectionFolderId) {
        await googleDrive.appendStudentRow(student, fileLinks, sectionFolderId);
        
        const sectionStudents = store.all().filter(s => s.section === student.section);
        console.log(`Generating Excel for ${student.section} (${sectionStudents.length} students)...`);
        await googleDrive.generateSectionExcel(student.section, sectionStudents, sectionFolderId);
      }

      // Update overall logs Excel
      try {
        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
        await googleDrive.generateOverallLogsExcel(rootFolderId);
      } catch (logsErr) {
        console.error('Failed to update overall logs:', logsErr.message);
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
