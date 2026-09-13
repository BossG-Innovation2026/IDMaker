const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const googleDrive = require('./googleDrive');
const store = require('./store');
const uploadQueue = require('./uploadQueue');
const { generateIDCard } = require('./idCardGenerator');

// Load env vars in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Generate ID card (PDF + DOCX on Render, DOCX locally)
function generateIDCardFile(student, photoBuf) {
  const { generateIDCard, generateIDCardDocx } = require('./idCardGenerator');
  const docxBuffer = generateIDCardDocx(student, photoBuf);
  
  const uploadsDir = path.join(__dirname, 'uploads');
  const docxPath = path.join(uploadsDir, `${student.id}_ID.docx`);
  fs.writeFileSync(docxPath, docxBuffer);
  
  try {
    const { execSync } = require('child_process');
    let loPath = null;
    if (process.platform !== 'win32') {
      const paths = ['/usr/bin/libreoffice', '/usr/bin/soffice', '/usr/bin/libreoffice-writer'];
      for (const p of paths) { if (fs.existsSync(p)) { loPath = p; break; } }
      if (!loPath) {
        try { loPath = require('child_process').execSync('which libreoffice 2>/dev/null || which soffice 2>/dev/null', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch(e) {}
      }
    }
    
    if (loPath) {
      const pdfPath = path.join(uploadsDir, `${student.id}_ID.pdf`);
      execSync(`"${loPath}" --headless --convert-to pdf --outdir "${uploadsDir}" "${docxPath}"`, { timeout: 60000, stdio: 'pipe' });
      if (fs.existsSync(pdfPath)) {
        return { pdfPath, docxPath };
      }
    }
  } catch (e) {
    console.error('PDF conversion failed:', e.message);
  }
  
  return { pdfPath: null, docxPath };
}

function present(student) {
  return {
    ...student,
    photoUrl: `/uploads/${student.photoPath}`
  };
}

// Check for duplicate student (surname + firstname + section)
app.get('/api/students/check-duplicate', (req, res) => {
  const { firstName, lastName, section } = req.query;
  if (!firstName || !lastName || !section) {
    return res.json({ duplicate: false });
  }
  
  const students = store.all();
  const duplicate = students.find(s => 
    s.section === section &&
    s.lastName.toUpperCase() === lastName.toUpperCase() &&
    s.firstName.toUpperCase() === firstName.toUpperCase()
  );
  
  if (duplicate) {
    res.json({ 
      duplicate: true, 
      existing: {
        id: duplicate.id,
        firstName: duplicate.firstName,
        lastName: duplicate.lastName,
        section: duplicate.section,
        createdAt: duplicate.createdAt
      }
    });
  } else {
    res.json({ duplicate: false });
  }
});

// Submit student data with photo
app.post('/api/students', upload.single('photo'), async (req, res) => {
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
      createdAt: new Date().toISOString()
    };

    // Generate ID card on disk for background upload
    try {
      const photoBuf = fs.readFileSync(path.join(__dirname, 'uploads', student.photoPath));
      const result = generateIDCardFile(student, photoBuf);
      if (result) {
        if (result.pdfPath && fs.existsSync(result.pdfPath)) {
          student.idCardPath = result.pdfPath;
          student.idCardMime = 'application/pdf';
        }
        if (result.docxPath && fs.existsSync(result.docxPath)) {
          student.idCardDocxPath = result.docxPath;
        }
      }
    } catch (idCardError) {
      console.error('ID card generation failed:', idCardError.message);
    }

    store.add(student);
    uploadQueue.enqueue(student.id);

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
    driveFiles: student.driveFiles || null
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
    if (student.idCardPath) {
      const p = path.join(uploadsDir, path.basename(student.idCardPath));
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
app.post('/api/save-to-drive', (req, res) => {
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

  // Recover unfinished uploads from a previous run
  const pending = store.all().filter(s => s.uploadStatus !== 'uploaded');
  if (pending.length > 0) {
    console.log(`↻ Re-queuing ${pending.length} unfinished upload(s)`);
    pending.forEach(s => {
      store.update(s.id, { uploadStatus: 'pending' });
      uploadQueue.enqueue(s.id);
    });
  }
});
