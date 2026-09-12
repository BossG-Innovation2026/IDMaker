const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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

// In-memory data store (replace with JSON file or SQLite if needed)
let students = [];

// Predefined classes list
const classes = [
  'Grade 7 - Emerald',
  'Grade 7 - Sapphire',
  'Grade 7 - Ruby',
  'Grade 7 - Diamond',
  'Grade 8 - Emerald',
  'Grade 8 - Sapphire',
  'Grade 8 - Ruby',
  'Grade 8 - Diamond',
  'Grade 9 - Emerald',
  'Grade 9 - Sapphire',
  'Grade 9 - Ruby',
  'Grade 9 - Diamond',
  'Grade 10 - Emerald',
  'Grade 10 - Sapphire',
  'Grade 10 - Ruby',
  'Grade 10 - Diamond',
  'Grade 11 - STEM',
  'Grade 11 - ABM',
  'Grade 11 - HUMSS',
  'Grade 11 - GAS',
  'Grade 12 - STEM',
  'Grade 12 - ABM',
  'Grade 12 - HUMSS',
  'Grade 12 - GAS'
];

// Routes

// Get list of classes
app.get('/api/classes', (req, res) => {
  res.json(classes);
});

// Submit student data with photo
app.post('/api/students', upload.single('photo'), (req, res) => {
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

    res.json({
      success: true,
      message: 'Student data saved successfully',
      student: {
        ...student,
        photoUrl: `/uploads/${student.photoPath}`
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

// Save to Google Drive (placeholder - implement with actual credentials)
app.post('/api/save-to-drive', async (req, res) => {
  try {
    const { studentId } = req.body;
    const student = students.find(s => s.id === studentId);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // TODO: Implement Google Drive upload
    // 1. Load credentials from .env
    // 2. Authenticate with Google Drive API
    // 3. Upload photo and ID card to Drive folder
    // 4. Return success

    res.json({
      success: true,
      message: 'Google Drive integration pending - add credentials to .env',
      student: student.firstName + ' ' + student.lastName
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
});
