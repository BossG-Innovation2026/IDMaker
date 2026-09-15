process.env.TZ = 'Etc/GMT-8';

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const googleDrive = require('./googleDrive');
const store = require('./store');
const uploadQueue = require('./uploadQueue');
const { generateIDCardDocx } = require('./idCardGenerator');

// Load env vars in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory rate limiter: 10 requests per minute per IP
const rateLimitMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000;
  const maxReq = 10;
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  if (timestamps.length >= maxReq) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  next();
}
setInterval(() => { rateLimitMap.clear(); }, 120000); // cleanup every 2min

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

// Predefined classes list
const classes = [
  '11 COMMERCE',
  '11 MECHELIN',
  '11 ARISTOTLE',
  '11 ENTERPRENEURS',
  '11 ALCARAZ',
  '11 ADLER',
  '11 CHATTERTON',
  '11 PATRIOTS',
  '11 DILIGENT',
  '11 DRIVEN',
  '11 SAPIENTA',
  '11 CROISSANT',
  '11 BLOOM',
  '11 ANALYTICAL',
  '11 BERNOULLI',
  '11 ERUDITE',
  '11 CANNOLI',
  '11 H. DIAZ',
  '11 ALS',
  '11 SNED'
];

// Routes

// Get list of classes
app.get('/api/classes', (req, res) => {
  res.json(classes);
});

// Generate ID card (DOCX only)
function generateIDCardFile(student, photoBuf) {
  try {
    const docxBuffer = generateIDCardDocx(student, photoBuf);

    if (!docxBuffer || docxBuffer.length < 100) {
      console.error('DOCX buffer is empty or too small:', docxBuffer ? docxBuffer.length : 0);
      return { docxPath: null };
    }

    if (docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4B) {
      console.error('DOCX buffer is not a valid ZIP/DOCX file');
      return { docxPath: null };
    }

    const uploadsDir = path.join(__dirname, 'uploads');
    const docxPath = path.join(uploadsDir, `${student.id}_ID.docx`);

    fs.writeFileSync(docxPath, docxBuffer);
    console.log(`DOCX saved: ${docxPath} (${docxBuffer.length} bytes)`);
    return { docxPath };
  } catch (error) {
    console.error('ID card generation failed:', error.message);
    return { docxPath: null };
  }
}

function present(student) {
  return {
    ...student,
    photoUrl: `/uploads/${student.photoPath}`
  };
}

// Diagnostic endpoint — check Google Drive status
app.get('/api/drive-status', async (req, res) => {
  try {
    const googleDrive = require('./googleDrive');
    await googleDrive.initialize();
    res.json({
      initialized: googleDrive.initialized,
      authType: googleDrive.authType || 'unknown',
      canList: !!googleDrive.drive
    });
  } catch (error) {
    res.json({ initialized: false, error: error.message });
  }
});

// Check for duplicate student (LRN + surname + first name)
app.get('/api/students/check-duplicate', (req, res) => {
  const { firstName, lastName, lrn } = req.query;
  if (!firstName && !lastName && !lrn) {
    return res.json({ isDuplicate: false });
  }

  const result = store.checkDuplicate(firstName, lastName, lrn);
  res.json(result);
});

// Override endpoint — delete old + create new atomically
app.post('/api/students/override', rateLimiter, upload.single('photo'), async (req, res) => {
  try {
    const {
      firstName, middleName, lastName, sex, birthday,
      lrn, section, address, parentName, contactNumber, existingId
    } = req.body;

    if (!firstName || !lastName || !sex || !birthday || !lrn || !section || !address || !parentName || !contactNumber) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    // STEP 1: Locate existing record
    const existing = store.find(existingId);
    if (!existing) {
      return res.status(404).json({ error: 'Existing student record not found' });
    }

    // STEP 2: Create NEW student record FIRST (before deleting old)
    const student = {
      id: uuidv4(),
      firstName, middleName: middleName || '', lastName, sex, birthday,
      lrn, section, address, parentName, contactNumber,
      photoPath: req.file.filename,
      photoMime: req.file.mimetype,
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Generate ID card files
    try {
      const photoBuf = fs.readFileSync(path.join(__dirname, 'uploads', student.photoPath));
      const result = generateIDCardFile(student, photoBuf);
      if (result.docxPath && fs.existsSync(result.docxPath)) {
        student.idCardDocxPath = `uploads/${path.basename(result.docxPath)}`;
      }
    } catch (idCardError) {
      console.error('[OVERRIDE] ID card generation error:', idCardError.message);
    }

    // Save new student to store
    store.add(student);

    // STEP 3: Delete old files and record
    const uploadsDir = path.join(__dirname, 'uploads');
    const filesDeleted = [];

    function deleteFile(filePath, label) {
      try {
        const fullPath = path.join(uploadsDir, path.basename(filePath));
        console.log(`[OVERRIDE] Deleting ${label}: ${fullPath}`);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          filesDeleted.push(label);
          console.log(`[OVERRIDE] ${label} deleted successfully`);
        }
      } catch (e) {
        console.error(`[OVERRIDE] Warning: failed to delete ${label}:`, e.message);
      }
    }

    if (existing.photoPath) deleteFile(existing.photoPath, 'photo');
    if (existing.idCardDocxPath) deleteFile(existing.idCardDocxPath, 'DOCX');

    // Log the old record as overridden BEFORE removing it
    store.logOverride({ ...existing, overriddenAt: new Date().toISOString() });

    // Remove old record from store
    store.remove(existing.id);
    console.log(`[OVERRIDE] Replaced ${existing.id} (${existing.firstName} ${existing.lastName}) → ${student.id} — files removed: ${filesDeleted.join(', ') || 'none'}`);

    // Delete old Google Drive files and sheet row (non-blocking)
    const googleDrive = require('./googleDrive');
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';
    googleDrive.deleteStudentDriveFiles(existing, folderId).catch(e =>
      console.error('[OVERRIDE] Warning: Drive file deletion failed:', e.message)
    );

    // Enqueue upload for new student
    uploadQueue.enqueue(student.id);

    res.status(202).json({
      success: true,
      message: 'Override complete. New student record created.',
      student: present(student),
      override: {
        deletedId: existingId,
        deletedFiles: filesDeleted
      }
    });
  } catch (error) {
    console.error('Override error:', error);
    res.status(500).json({ error: 'Override failed: ' + error.message });
  }
});

// Submit student data with photo
app.post('/api/students', rateLimiter, upload.single('photo'), async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      sex,
      birthday,
      lrn,
      section,
      address,
      parentName,
      contactNumber
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !sex || !birthday || !lrn || !section || !address || !parentName || !contactNumber) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    // Backend duplicate check — authoritative
    const dupCheck = store.checkDuplicate(firstName, lastName, lrn);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({
        error: 'DUPLICATE',
        duplicate: true,
        matchedByName: dupCheck.matchedByName,
        matchedByLRN: dupCheck.matchedByLRN,
        existing: {
          id: dupCheck.matches[0].id,
          firstName: dupCheck.matches[0].firstName,
          lastName: dupCheck.matches[0].lastName,
          lrn: dupCheck.matches[0].lrn,
          section: dupCheck.matches[0].section,
          createdAt: dupCheck.matches[0].createdAt
        }
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    const student = {
      id: uuidv4(),
      firstName,
      middleName: middleName || '',
      lastName,
      sex,
      birthday,
      lrn,
      section,
      address,
      parentName,
      contactNumber,
      photoPath: req.file.filename,
      photoMime: req.file.mimetype,
      uploadStatus: 'pending',
      uploadError: null,
      driveUploaded: false,
      driveLink: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Generate ID card on disk for background upload
    try {
      const photoBuf = fs.readFileSync(path.join(__dirname, 'uploads', student.photoPath));
      const result = generateIDCardFile(student, photoBuf);
      
      if (result.docxPath && fs.existsSync(result.docxPath)) {
        student.idCardDocxPath = `uploads/${path.basename(result.docxPath)}`;
        console.log(`DOCX ready: ${student.idCardDocxPath}`);
      }
    } catch (idCardError) {
      console.error('ID card generation failed:', idCardError.message);
    }

    store.add(student);
    // Pass prebuilt buffers to queue — skips re-reading from disk
    const prebuiltFiles = { photo: photoBuf, photoExt: path.extname(student.photoPath) || '.jpg' };
    uploadQueue.enqueue(student.id, prebuiltFiles);

    // Respond immediately; uploads continue in the background
    res.status(202).json({
      success: true,
      message: 'Student saved. Files are uploading to Google Drive in the background.',
      student: present(student)
    });
  } catch (error) {
    console.error('Error saving student:', error);
    res.status(500).json({ error: 'Failed to save student data' });
  }
});

// Get all students
app.get('/api/students', (req, res) => {
  res.json(store.all().map(present));
});

// Get one student's upload status
app.get('/api/students/:id/status', (req, res) => {
  const student = store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  res.json({
    id: student.id,
    uploadStatus: student.uploadStatus,
    uploadError: student.uploadError,
    driveUploaded: !!student.driveUploaded,
    driveLink: student.driveLink,
    driveFiles: student.driveFiles || null,
    hasPdf: !!student.idCardPath,
    hasDocx: !!student.idCardDocxPath
  });
});

// Delete a student
app.delete('/api/students/:id', (req, res) => {
  const student = store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  
  const uploadsDir = path.join(__dirname, 'uploads');
  try {
    if (student.photoPath) {
      const p = path.join(uploadsDir, student.photoPath);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (student.idCardDocxPath) {
      const p = path.join(uploadsDir, path.basename(student.idCardDocxPath));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    console.warn('Error cleaning up files:', e.message);
  }
  
  store.remove(student.id);
  res.json({ success: true, message: 'Student deleted' });
});

// Re-queue a failed/pending upload
app.post('/api/students/:id/resync', (req, res) => {
  const student = store.find(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  store.update(student.id, { uploadStatus: 'pending', uploadError: null });
  uploadQueue.enqueue(student.id);
  res.json({ success: true, message: 'Re-queued for upload', id: student.id });
});

// Queue stats
app.get('/api/queue', (req, res) => {
  res.json(uploadQueue.stats());
});

// Manual re-sync of a single student
app.post('/api/save-to-drive', rateLimiter, (req, res) => {
  const { studentId } = req.body;
  const student = store.find(studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  store.update(student.id, { uploadStatus: 'pending', uploadError: null });
  uploadQueue.enqueue(student.id);
  res.json({ success: true, message: 'Re-queued for upload', id: student.id });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Classes available: ${classes.length} predefined`);
  console.log('Google Drive integration: Enabled');

  // Load persisted queue from disk
  uploadQueue.loadQueue();

  // Recover unfinished uploads (skip already-uploaded)
  const pending = store.all().filter(s => s.uploadStatus !== 'uploaded' && s.uploadStatus !== 'uploading');
  if (pending.length > 0) {
    console.log(`↻ Re-queuing ${pending.length} unfinished upload(s)`);
    pending.forEach(s => {
      store.update(s.id, { uploadStatus: 'pending' });
      uploadQueue.enqueue(s.id);
    });
  }
});
