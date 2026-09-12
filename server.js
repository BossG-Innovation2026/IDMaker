const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { jsPDF } = require('jspdf');
const googleDrive = require('./googleDrive');

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

// In-memory data store
let students = [];

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
      createdAt: new Date().toISOString()
    };

    students.push(student);

    // Upload all 3 files to Google Drive
    const fileBase = `${lastName}_${firstName}`;
    let driveResults = { photo: null, receipt: null, idCard: null };

    try {
      // 1. Upload Photo
      const photoBuffer = fs.readFileSync(req.file.path);
      const photoFileName = `${fileBase}_PIC${path.extname(req.file.originalname)}`;
      driveResults.photo = await googleDrive.uploadStudentPhoto(
        photoBuffer, photoFileName, req.file.mimetype, section
      );
      console.log(`✓ Photo uploaded: ${photoFileName} → ${section}/`);

      // 2. Upload Receipt PDF
      const receiptBuffer = generateReceipt(student);
      const receiptFileName = `${fileBase}_rct.pdf`;
      driveResults.receipt = await googleDrive.uploadStudentPhoto(
        receiptBuffer, receiptFileName, 'application/pdf', section
      );
      console.log(`✓ Receipt uploaded: ${receiptFileName} → ${section}/`);

      // 3. Upload ID Card
      const idCardBuffer = generateIDCard(student);
      if (idCardBuffer) {
        const idFileName = `${fileBase}_ID.jpg`;
        driveResults.idCard = await googleDrive.uploadStudentPhoto(
          idCardBuffer, idFileName, 'image/jpeg', section
        );
        console.log(`✓ ID Card uploaded: ${idFileName} → ${section}/`);
      }
    } catch (driveError) {
      console.error('Drive upload error:', driveError.message);
    }

    res.json({
      success: true,
      message: 'Student data saved successfully',
      student: {
        ...student,
        photoUrl: `/uploads/${student.photoPath}`,
        driveUploaded: driveResults.photo?.success || false,
        driveLink: driveResults.photo?.fileLink || null
      }
    });
  } catch (error) {
    console.error('Error saving student:', error);
    res.status(500).json({ error: 'Failed to save student data' });
  }
});

// Get all students
app.get('/api/students', (req, res) => {
  const studentsWithUrl = students.map(s => ({
    ...s,
    photoUrl: `/uploads/${s.photoPath}`
  }));
  res.json(studentsWithUrl);
});

// Manual save to Google Drive
app.post('/api/save-to-drive', async (req, res) => {
  try {
    const { studentId } = req.body;
    const student = students.find(s => s.id === studentId);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const filePath = path.join(__dirname, 'uploads', student.photoPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Photo file not found' });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = `${student.lastName}_${student.firstName}_${student.lrn}${path.extname(student.photoPath)}`;
    
    const result = await googleDrive.uploadStudentPhoto(
      fileBuffer,
      fileName,
      'image/jpeg',
      student.section
    );

    res.json({
      success: true,
      message: 'Photo uploaded to Google Drive',
      fileLink: result.fileLink
    });
  } catch (error) {
    console.error('Error saving to Drive:', error);
    res.status(500).json({ error: 'Failed to save to Google Drive' });
  }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Classes available: ${classes.length} predefined`);
  console.log('Google Drive integration: Enabled');
});
