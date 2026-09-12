const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { jsPDF } = require('jspdf');
const googleDrive = require('./googleDrive');
const store = require('./store');
const uploadQueue = require('./uploadQueue');

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

// Generate receipt PDF server-side
function generateReceipt(student) {
  const doc = new jsPDF();
  const fullName = student.middleName
    ? `${student.firstName} ${student.middleName} ${student.lastName}`
    : `${student.firstName} ${student.lastName}`;

  const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('STUDENT ID REGISTRATION RECEIPT', 105, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('This document serves as proof of registration', 105, 28, { align: 'center' });

  doc.setDrawColor(102, 126, 234);
  doc.setLineWidth(0.5);
  doc.line(20, 32, 190, 32);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('STUDENT INFORMATION', 20, 42);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const startY = 52;
  const lineHeight = 8;
  const fields = [
    { label: 'Name:', value: fullName },
    { label: 'Section:', value: student.section },
    { label: 'LRN:', value: student.lrn },
    { label: 'Birthday:', value: formattedDate },
    { label: 'Address:', value: student.address },
    { label: 'Parent/Guardian:', value: student.parentName },
    { label: 'Contact Number:', value: student.contactNumber }
  ];

  fields.forEach((field, index) => {
    const y = startY + (index * lineHeight);
    doc.setFont('helvetica', 'bold');
    doc.text(field.label, 20, y);
    doc.setFont('helvetica', 'normal');
    doc.text(field.value || '-', 60, y);
  });

  // Add photo
  const photoPath = path.join(__dirname, 'uploads', student.photoPath);
  if (fs.existsSync(photoPath)) {
    const photoData = fs.readFileSync(photoPath);
    const base64Photo = photoData.toString('base64');
    doc.addImage(`data:image/jpeg;base64,${base64Photo}`, 'JPEG', 150, 40, 30, 40);
  }

  const footerY = startY + (fields.length * lineHeight) + 10;
  doc.setDrawColor(102, 126, 234);
  doc.line(20, footerY, 190, footerY);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, footerY + 8);
  doc.text('This is a computer-generated document.', 20, footerY + 14);

  return Buffer.from(doc.output('arraybuffer'));
}

// Generate ID card PNG server-side (returns buffer)
function generateIDCard(student) {
  // We generate a simple JPEG using the photo and text data
  // For a real ID card image, we'd need node-canvas
  // For now, return the photo as the ID card placeholder
  const photoPath = path.join(__dirname, 'uploads', student.photoPath);
  if (fs.existsSync(photoPath)) {
    return fs.readFileSync(photoPath);
  }
  return null;
}

function present(student) {
  return {
    ...student,
    photoUrl: `/uploads/${student.photoPath}`
  };
}

// Submit student data with photo
app.post('/api/students', upload.single('photo'), async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      birthday,
      lrn,
      section,
      address,
      parentName,
      contactNumber
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !birthday || !lrn || !section || !address || !parentName || !contactNumber) {
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

    // Stage the receipt PDF on disk for background upload
    try {
      const receiptBuffer = generateReceipt(student);
      const receiptName = `${student.id}_rct.pdf`;
      fs.writeFileSync(path.join(__dirname, 'uploads', receiptName), receiptBuffer);
      student.receiptPath = path.join('uploads', receiptName);
    } catch (receiptError) {
      console.error('Receipt generation failed:', receiptError.message);
    }

    // Stage the ID card image on disk for background upload
    try {
      const idCardBuffer = generateIDCard(student);
      if (idCardBuffer) {
        const idName = `${student.id}_ID.jpg`;
        fs.writeFileSync(path.join(__dirname, 'uploads', idName), idCardBuffer);
        student.idCardPath = path.join('uploads', idName);
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
