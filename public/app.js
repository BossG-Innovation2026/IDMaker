const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let capturedPhotoData = null;

// Barangay data for each town
const barangays = {
    'Cabiao': [
        'Bagong Buhay', 'Bagong Sikat', 'Bagong Silang', 'Concepcion',
        'Entablado', 'Maligaya', 'Natividad North', 'Natividad South',
        'Palasinan', 'San Antonio', 'San Fernando Norte', 'San Fernando Sur',
        'San Gregorio', 'San Juan North', 'San Juan South', 'San Roque',
        'San Vicente', 'Santa Rita', 'Sinipit', 'Polilio',
        'San Carlos', 'Santa Isabel', 'Santa Ines'
    ],
    'San Isidro': [
        'Alua', 'Calaba', 'Malapit', 'Mangga', 'Poblacion',
        'Pulo', 'San Roque', 'Sto. Cristo', 'Tabon'
    ],
    'San Antonio': [
        'Buliran', 'Cama Juan', 'Julo', 'Lawang Kupang', 'Luyos',
        'Maugat', 'Panabingan', 'Papaya', 'Poblacion', 'San Francisco',
        'San Jose', 'San Mariano', 'Santa Cruz', 'Santo Cristo',
        'Santa Barbara', 'Tikiw'
    ],
    'Arayat': [
        'Arenas', 'Baliti', 'Batasan', 'Buensuceso', 'Candating',
        'Gatiawin', 'Guemasan', 'La Paz', 'Lacmit', 'Lacquios',
        'Mangga-Cacutud', 'Mapalad', 'Panlinlang', 'Paralaya',
        'Plazang Luma', 'Poblacion', 'San Agustin Norte', 'San Agustin Sur',
        'San Antonio', 'San Jose Mesulo', 'San Juan Bano', 'San Mateo',
        'San Nicolas', 'San Roque Bitas', 'Cupang', 'Matamo',
        'Santo Niño Tabuan', 'Suclayin', 'Telapayong', 'Kaledian'
    ]
};

// Province and zipcode mapping
const locationData = {
    'Cabiao': { province: 'Nueva Ecija', zipcode: '3107' },
    'San Isidro': { province: 'Nueva Ecija', zipcode: '3106' },
    'San Antonio': { province: 'Nueva Ecija', zipcode: '3108' },
    'Arayat': { province: 'Pampanga', zipcode: '2012' }
};

// Load on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadModels();
    await loadClasses();
    setupEventListeners();
});

async function loadModels() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        modelsLoaded = true;
        console.log('Face detection models loaded');
    } catch (error) {
        console.warn('Face detection models failed to load:', error);
        modelsLoaded = false;
    }
}

async function loadClasses() {
    try {
        const response = await fetch(`${API_URL}/api/classes`);
        const classes = await response.json();
        const select = document.getElementById('classSelect');
        
        classes.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls;
            option.textContent = cls;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

function setupEventListeners() {
    document.getElementById('studentForm').addEventListener('submit', handleSubmit);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);
    
    // Setup form features
    setupCapsLock();
    setupPhoneFormat();
    setupLRNValidation();
    setupBirthdayDisplay();
    setupAddressDropdowns();
}

// Address dropdowns
function setupAddressDropdowns() {
    const townSelect = document.getElementById('town');
    const barangaySelect = document.getElementById('barangay');
    const specificLocation = document.getElementById('specificLocation');
    
    // Town change handler
    townSelect.addEventListener('change', () => {
        const town = townSelect.value;
        
        // Clear barangay dropdown
        barangaySelect.innerHTML = '<option value="">Select Barangay</option>';
        
        if (town && barangays[town]) {
            barangaySelect.disabled = false;
            barangays[town].forEach(brgy => {
                const option = document.createElement('option');
                option.value = brgy;
                option.textContent = brgy;
                barangaySelect.appendChild(option);
            });
        } else {
            barangaySelect.disabled = true;
        }
        
        updateAddress();
    });
    
    // Barangay change handler
    barangaySelect.addEventListener('change', () => {
        updateAddress();
    });
    
    // Specific location input handler
    specificLocation.addEventListener('input', (e) => {
        e.target.value = toProperCase(e.target.value);
        updateAddress();
    });
}

function toProperCase(str) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
}

function updateAddress() {
    const town = document.getElementById('town').value;
    const barangay = document.getElementById('barangay').value;
    const specificLocation = document.getElementById('specificLocation').value;
    const addressField = document.getElementById('address');
    
    if (town && barangay && specificLocation) {
        const { province, zipcode } = locationData[town] || {};
        // Format as proper case (capitalize each word)
        const address = `${specificLocation}, ${barangay}, ${town}, ${province || ''} ${zipcode || ''}`.trim();
        addressField.value = toProperCase(address);
    } else {
        addressField.value = '';
    }
}

// Auto caps lock for text fields
function setupCapsLock() {
    const textFields = ['firstName', 'middleName', 'lastName', 'parentName'];
    textFields.forEach(id => {
        const field = document.getElementById(id);
        if (field) {
            field.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
            });
        }
    });
}

// Phone number formatting (09xx-xxx-xxxx)
function setupPhoneFormat() {
    const phoneField = document.getElementById('contactNumber');
    if (phoneField) {
        phoneField.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            
            if (value.length > 11) {
                value = value.substring(0, 11);
            }
            
            if (value.length > 4) {
                value = value.substring(0, 4) + '-' + value.substring(4);
            }
            if (value.length > 8) {
                value = value.substring(0, 8) + '-' + value.substring(8);
            }
            
            e.target.value = value;
        });
    }
}

// LRN validation (12 digits only)
function setupLRNValidation() {
    const lrnField = document.getElementById('lrn');
    const lrnValidation = document.getElementById('lrnValidation');
    
    if (lrnField && lrnValidation) {
        lrnField.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
            
            const value = e.target.value;
            
            if (value.length === 0) {
                lrnValidation.classList.add('hidden');
            } else if (value.length < 12) {
                lrnValidation.textContent = `${value.length}/12 digits`;
                lrnValidation.className = 'field-validation invalid';
                lrnValidation.classList.remove('hidden');
            } else if (value.length === 12) {
                lrnValidation.textContent = '✓ Valid LRN';
                lrnValidation.className = 'field-validation valid';
                lrnValidation.classList.remove('hidden');
            }
        });
        
        lrnField.addEventListener('blur', (e) => {
            if (e.target.value.length > 0 && e.target.value.length < 12) {
                lrnValidation.textContent = 'LRN must be 12 digits';
                lrnValidation.className = 'field-validation invalid';
                lrnValidation.classList.remove('hidden');
            }
        });
    }
}

// Birthday format display
function setupBirthdayDisplay() {
    const birthdayField = document.getElementById('birthday');
    const display = document.getElementById('birthdayDisplay');
    
    if (birthdayField && display) {
        birthdayField.addEventListener('change', (e) => {
            const date = new Date(e.target.value);
            if (!isNaN(date.getTime())) {
                const options = { year: 'numeric', month: 'long', day: 'numeric' };
                display.textContent = date.toLocaleDateString('en-US', options);
            }
        });
    }
}

// Camera Modal Functions
async function openCameraModal() {
    console.log('Opening camera modal');
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('hidden');
    
    const captureBtn = document.getElementById('captureBtn');
    console.log('Capture button found:', captureBtn);
    captureBtn.removeAttribute('disabled');
    console.log('Capture button disabled after remove:', captureBtn.disabled);
    
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        });
        
        const video = document.getElementById('cameraPreview');
        video.srcObject = videoStream;
        
        // Wait for video to be fully ready
        await new Promise((resolve) => {
            if (video.readyState >= 2) {
                resolve();
            } else {
                video.onloadeddata = resolve;
            }
        });
        console.log('Camera stream ready, dimensions:', video.videoWidth, 'x', video.videoHeight);
        
        // Start face detection if available (optional enhancement)
        if (modelsLoaded) {
            startFaceDetection();
        } else {
            updateFaceStatus('Camera ready - position face in center', 'warning');
        }
    } catch (error) {
        console.error('Error accessing camera:', error);
        closeCameraModal();
        showStatus('Camera access denied. Please allow camera permissions.', 'info');
    }
}

function closeCameraModal() {
    const modal = document.getElementById('cameraModal');
    modal.classList.add('hidden');
    
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    
    resetFaceChecks();
}

function startFaceDetection() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.getElementById('faceCanvas');
    
    faceDetectionInterval = setInterval(async () => {
        if (!video.videoWidth) return;
        
        const detections = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ 
                inputSize: 320,
                scoreThreshold: 0.5
            }))
            .withFaceLandmarks(true);
        
        const ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (detections.length === 0) {
            updateFaceChecks(false, false, false, false);
            updateFaceStatus('No face detected - position face in frame', 'warning');
            return;
        }
        
        const detection = detections.reduce((prev, current) => 
            (prev.detection.box.area > current.detection.box.area) ? prev : current
        );
        
        const box = detection.detection.box;
        const videoWidth = video.videoWidth;
        
        const faceCenterX = box.x + box.width / 2;
        const isCentered = Math.abs(faceCenterX - videoWidth / 2) < videoWidth * 0.15;
        const isGoodSize = box.width > videoWidth * 0.15 && box.width < videoWidth * 0.6;
        
        const brightness = await checkBrightness(video, box);
        const isGoodBrightness = brightness > 40 && brightness < 220;
        
        ctx.strokeStyle = isCentered && isGoodSize ? '#48bb78' : '#dd6b20';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        const landmarks = detection.landmarks;
        ctx.fillStyle = '#667eea';
        landmarks.positions.forEach(pos => {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        const allPassed = isCentered && isGoodSize && isGoodBrightness;
        updateFaceChecks(true, isCentered, isGoodSize, isGoodBrightness);
        
        const guideOval = document.getElementById('guideOval');
        guideOval.className = 'guide-oval';
        if (allPassed) {
            guideOval.classList.add('detected', 'centered');
            updateFaceStatus('Perfect! Ready to capture', 'success');
        } else if (isCentered && isGoodSize) {
            guideOval.classList.add('warning');
            updateFaceStatus('Good - tap Capture when ready', 'warning');
        } else {
            updateFaceStatus('Position your face in the oval', 'warning');
        }
    }, 200);
}

async function checkBrightness(video, box) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = box.width;
    canvas.height = box.height;
    
    ctx.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    
    const imageData = ctx.getImageData(0, 0, box.width, box.height);
    const data = imageData.data;
    let sum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    
    return sum / (data.length / 4);
}

function updateFaceChecks(faceDetected, centered, goodSize, goodLighting) {
    const checks = {
        checkFace: faceDetected,
        checkCenter: centered,
        checkSize: goodSize,
        checkLight: goodLighting
    };
    
    Object.entries(checks).forEach(([id, passed]) => {
        const el = document.getElementById(id);
        el.className = `check-item ${passed ? 'passed' : ''}`;
    });
}

function resetFaceChecks() {
    ['checkFace', 'checkCenter', 'checkSize', 'checkLight'].forEach(id => {
        document.getElementById(id).className = 'check-item';
    });
}

function updateFaceStatus(text, type) {
    const status = document.getElementById('faceStatus');
    status.querySelector('.status-text').textContent = text;
    status.className = `face-status ${type}`;
}

function capturePhoto() {
    console.log('capturePhoto called');
    const video = document.getElementById('cameraPreview');
    
    if (!video || !video.srcObject) {
        console.error('No video stream found');
        showStatus('Camera not ready', 'info');
        return;
    }
    
    // Wait for video to be ready
    if (!video.videoWidth || !video.videoHeight) {
        console.log('Video not ready yet, retrying...');
        video.onloadedmetadata = () => capturePhoto();
        return;
    }
    
    // Use ImageCapture API if available (more reliable on mobile)
    if (window.ImageCapture) {
        const track = video.srcObject.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
        imageCapture.takePhoto()
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    capturedPhotoData = reader.result;
                    console.log('Photo captured via ImageCapture API');
                    closeCameraModal();
                    showPreviewModal();
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                console.error('ImageCapture failed, falling back to canvas:', err);
                captureWithCanvas(video);
            });
    } else {
        captureWithCanvas(video);
    }
}

function captureWithCanvas(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    // Draw without mirror - just flip horizontally after
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Check if frame is black (all pixels near 0)
    const imageData = ctx.getImageData(0, 0, 10, 10).data;
    let sum = 0;
    for (let i = 0; i < imageData.length; i += 4) {
        sum += imageData[i] + imageData[i+1] + imageData[i+2];
    }
    console.log('Canvas pixel sample sum:', sum);
    
    if (sum < 10) {
        console.log('Frame is black, retrying in 200ms...');
        setTimeout(() => captureWithCanvas(video), 200);
        return;
    }
    
    capturedPhotoData = canvas.toDataURL('image/jpeg', 0.9);
    console.log('Photo captured via canvas');
    closeCameraModal();
    showPreviewModal();
}

function showPreviewModal() {
    const modal = document.getElementById('previewModal');
    modal.classList.remove('hidden');
    document.getElementById('capturedPhoto').src = capturedPhotoData;
}

function approvePhoto() {
    selectedFile = dataURLtoFile(capturedPhotoData, 'photo.jpg');
    
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${capturedPhotoData}" alt="Student Photo">`;
    
    showPhotoValidation('✓ Photo approved', 'valid');
    document.getElementById('previewModal').classList.add('hidden');
}

function rejectPhoto() {
    capturedPhotoData = null;
    document.getElementById('previewModal').classList.add('hidden');
    openCameraModal();
}

function dataURLtoFile(dataURL, filename) {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new File([u8arr], filename, { type: mime });
}

function showPhotoValidation(message, type) {
    const validation = document.getElementById('photoValidation');
    validation.textContent = message;
    validation.className = `photo-validation ${type}`;
    validation.classList.remove('hidden');
}

// Form Submit
let currentStudentData = null;

async function handleSubmit(e) {
    e.preventDefault();
    
    if (!selectedFile) {
        showStatus('Please capture a photo first', 'info');
        return;
    }
    
    const formData = new FormData();
    formData.append('firstName', document.getElementById('firstName').value);
    formData.append('middleName', document.getElementById('middleName').value);
    formData.append('lastName', document.getElementById('lastName').value);
    formData.append('birthday', document.getElementById('birthday').value);
    formData.append('lrn', document.getElementById('lrn').value);
    formData.append('section', document.getElementById('classSelect').value);
    formData.append('address', document.getElementById('address').value);
    formData.append('parentName', document.getElementById('parentName').value);
    formData.append('contactNumber', document.getElementById('contactNumber').value);
    formData.append('photo', selectedFile);
    
    try {
        const response = await fetch(`${API_URL}/api/students`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentStudentData = result.student;
            showStatus('ID generated successfully!', 'success');
            updateIDPreview(result.student);
            document.getElementById('idPreview').classList.remove('hidden');
            document.getElementById('downloadSection').classList.remove('hidden');
        } else {
            showStatus(result.error || 'Error saving data', 'info');
        }
    } catch (error) {
        showStatus('Error connecting to server', 'info');
    }
}

function updateIDPreview(student) {
    const fullName = student.middleName 
        ? `${student.firstName} ${student.middleName} ${student.lastName}`
        : `${student.firstName} ${student.lastName}`;
    
    const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    document.getElementById('idName').textContent = fullName;
    document.getElementById('idClass').textContent = student.section;
    document.getElementById('idLRN').textContent = student.lrn;
    document.getElementById('idBirthday').textContent = formattedDate;
    document.getElementById('idAddress').textContent = student.address;
    document.getElementById('idParent').textContent = student.parentName;
    document.getElementById('idContact').textContent = student.contactNumber;
    
    if (student.photoUrl) {
        document.getElementById('idPhoto').innerHTML = 
            `<img src="${student.photoUrl}" alt="Student Photo">`;
    }
}

async function saveToDrive() {
    showStatus('Saving to Google Drive...', 'info');
    
    setTimeout(() => {
        showStatus('Google Drive integration pending - add credentials to .env', 'info');
    }, 1000);
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
}

function getFileBaseName() {
    if (!currentStudentData) return '';
    return `${currentStudentData.lastName}_${currentStudentData.firstName}`;
}

function downloadAll() {
    downloadReceipt();
    setTimeout(() => downloadIDCard(), 500);
    setTimeout(() => downloadPhoto(), 1000);
    showStatus('Downloading all files...', 'valid');
}

function downloadPhoto() {
    if (!capturedPhotoData) {
        showStatus('No photo available', 'info');
        return;
    }
    const link = document.createElement('a');
    link.download = `${getFileBaseName()}_PIC.jpg`;
    link.href = capturedPhotoData;
    link.click();
    showStatus('✓ Photo downloaded', 'valid');
}

function downloadReceipt() {
    if (!currentStudentData) {
        showStatus('No student data to generate receipt', 'info');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const student = currentStudentData;
    const fullName = student.middleName 
        ? `${student.firstName} ${student.middleName} ${student.lastName}`
        : `${student.firstName} ${student.lastName}`;
    
    const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('STUDENT ID REGISTRATION RECEIPT', 105, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('This document serves as proof of registration', 105, 28, { align: 'center' });
    
    // Line
    doc.setDrawColor(102, 126, 234);
    doc.setLineWidth(0.5);
    doc.line(20, 32, 190, 32);
    
    // Student Info
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
    
    // Add photo if available
    if (capturedPhotoData) {
        doc.addImage(capturedPhotoData, 'JPEG', 150, 40, 30, 40);
    }
    
    // Line
    const footerY = startY + (fields.length * lineHeight) + 10;
    doc.setDrawColor(102, 126, 234);
    doc.line(20, footerY, 190, footerY);
    
    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, footerY + 8);
    doc.text('This is a computer-generated document.', 20, footerY + 14);
    
    // Save PDF
    doc.save(`${getFileBaseName()}_rct.pdf`);
    showStatus('✓ Receipt downloaded', 'valid');
}

function downloadIDCard() {
    if (!currentStudentData || !capturedPhotoData) {
        showStatus('No data available for ID card', 'info');
        return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#f0f0f3';
    ctx.fillRect(0, 0, 400, 600);
    
    // Header
    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 400, 80);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCHOOL NAME', 200, 35);
    
    ctx.font = '12px Arial';
    ctx.fillText('Student Identification Card', 200, 55);
    
    // Photo
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(140, 100, 120, 150);
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.strokeRect(140, 100, 120, 150);
    
    // Draw photo
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 145, 105, 110, 140);
        
        // Name
        const fullName = currentStudentData.middleName 
            ? `${currentStudentData.firstName} ${currentStudentData.middleName} ${currentStudentData.lastName}`
            : `${currentStudentData.firstName} ${currentStudentData.lastName}`;
        
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(fullName, 200, 280);
        
        // Info
        ctx.font = '12px Arial';
        ctx.fillStyle = '#555555';
        ctx.fillText(`Section: ${currentStudentData.section}`, 200, 310);
        ctx.fillText(`LRN: ${currentStudentData.lrn}`, 200, 335);
        
        const formattedDate = new Date(currentStudentData.birthday).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        ctx.fillText(`Birthday: ${formattedDate}`, 200, 360);
        ctx.fillText(`Address: ${currentStudentData.address}`, 200, 385);
        ctx.fillText(`Parent: ${currentStudentData.parentName}`, 200, 410);
        ctx.fillText(`Contact: ${currentStudentData.contactNumber}`, 200, 435);
        
        // Footer
        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 520, 400, 80);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.fillText(`Generated on: ${new Date().toLocaleDateString()}`, 200, 550);
        ctx.fillText('This is a computer-generated ID', 200, 570);
        
        // Download
        const link = document.createElement('a');
        link.download = `${getFileBaseName()}_ID.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showStatus('✓ ID card downloaded', 'valid');
    };
    img.src = capturedPhotoData;
}
