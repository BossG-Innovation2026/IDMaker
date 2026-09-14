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
  const { generateIDCardDocx } = require('./idCardGenerator');
  
  let docxBuffer;
  try {
    docxBuffer = generateIDCardDocx(student, photoBuf);
  } catch (e) {
    console.error('DOCX generation error:', e.message);
    return { pdfPath: null, docxPath: null };
  }
  
  if (!docxBuffer || docxBuffer.length < 100) {
    console.error('DOCX buffer is empty or too small:', docxBuffer ? docxBuffer.length : 0);
    return { pdfPath: null, docxPath: null };
  }
  
  if (docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4B) {
    console.error('DOCX buffer is not a valid ZIP/DOCX file');
    return { pdfPath: null, docxPath: null };
  }
  
  const uploadsDir = path.join(__dirname, 'uploads');
  const docxPath = path.join(uploadsDir, `${student.id}_ID.docx`);
  
  try {
    fs.writeFileSync(docxPath, docxBuffer);
    console.log(`DOCX saved: ${docxPath} (${docxBuffer.length} bytes)`);
  } catch (e) {
    console.error('Failed to write DOCX:', e.message);
    return { pdfPath: null, docxPath: null };
  }
  
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
      const userProfile = path.join(uploadsDir, `lo_profile_${student.id}`);
      console.log(`Converting DOCX to PDF: ${loPath}`);
      console.log(`Input DOCX: ${docxPath} (exists: ${fs.existsSync(docxPath)})`);
      console.log(`Output dir: ${uploadsDir} (exists: ${fs.existsSync(uploadsDir)})`);
      
      try { fs.mkdirSync(userProfile, { recursive: true }); } catch(e) {}
      
      // Use absolute paths and ensure proper escaping
      const absDocxPath = path.resolve(docxPath);
      const absOutDir = path.resolve(uploadsDir);
      const absProfileDir = path.resolve(userProfile);
      
      // Build command with proper escaping for Linux
      const cmd = `"${loPath}" --headless --norestore --nolockcheck --convert-to pdf --outdir "${absOutDir}" --env:UserInstallation="file://${absProfileDir}" "${absDocxPath}"`;
      console.log(`LibreOffice cmd: ${cmd}`);
      
      let stdout = '', stderr = '';
      try {
        const result = execSync(cmd, { 
          timeout: 60000, 
          windowsHide: true, 
          stdio: 'pipe', 
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: absProfileDir,
            TMPDIR: absProfileDir
          }
        });
        stdout = result || '';
      } catch(e) {
        stdout = (e.stdout || '').toString();
        stderr = (e.stderr || e.message).toString();
      }
      console.log(`LibreOffice stdout: ${stdout.substring(0, 500)}`);
      console.log(`LibreOffice stderr: ${stderr.substring(0, 500)}`);
      
      // List files in uploads dir after conversion
      try {
        const files = fs.readdirSync(uploadsDir).filter(f => f.includes(student.id));
        console.log(`Uploads dir files for ${student.id}: ${files.join(', ')}`);
      } catch(e) {}
      
      if (fs.existsSync(pdfPath)) {
        const pdfSize = fs.statSync(pdfPath).size;
        console.log(`PDF saved: ${pdfPath} (${pdfSize} bytes)`);
        return { pdfPath, docxPath };
      } else {
        console.error('PDF file not found after conversion');
        // Try alternative output location
        const altPdfPath = path.join(uploadsDir, `${path.basename(docxPath, '.docx')}.pdf`);
        if (fs.existsSync(altPdfPath)) {
          console.log(`Found PDF at alternative path: ${altPdfPath}`);
          fs.renameSync(altPdfPath, pdfPath);
          const pdfSize = fs.statSync(pdfPath).size;
          console.log(`PDF saved (renamed): ${pdfPath} (${pdfSize} bytes)`);
          return { pdfPath, docxPath };
        }
      }
    } else {
      console.warn('LibreOffice not found - PDF conversion skipped');
    }
  } catch (e) {
    console.error('PDF conversion error:', e.message);
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
      
      if (result.docxPath && fs.existsSync(result.docxPath)) {
        student.idCardDocxPath = `uploads/${path.basename(result.docxPath)}`;
        console.log(`DOCX ready: ${student.idCardDocxPath}`);
      }
      if (result.pdfPath && fs.existsSync(result.pdfPath)) {
        student.idCardPath = `uploads/${path.basename(result.pdfPath)}`;
        student.idCardMime = 'application/pdf';
        console.log(`PDF ready: ${student.idCardPath}`);
      } else {
        console.warn('PDF not generated - DOCX will be uploaded only');
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
