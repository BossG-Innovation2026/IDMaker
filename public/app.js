const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let capturedPhotoData = null;
let allChecksPassed = false;

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
    
    // File upload fallback
    document.getElementById('cameraInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                capturedPhotoData = e.target.result;
                showPreviewModal();
                showStatus('✓ Photo uploaded from gallery', 'valid');
            };
            reader.readAsDataURL(file);
        }
    });
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
        const pos = e.target.selectionStart;
        e.target.value = toProperCase(e.target.value);
        e.target.setSelectionRange(pos, pos);
        updateAddress();
    });
}

function toProperCase(str) {
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
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
                updateFullName();
            });
        }
    });
}

function updateFullName() {
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    
    let fullName = '';
    if (lastName) fullName += lastName;
    if (firstName) fullName += (fullName ? ', ' : '') + firstName;
    if (middleName) fullName += ' ' + middleName.charAt(0) + '.';
    
    document.getElementById('fullName').value = fullName;
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
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('hidden');
    
    const captureBtn = document.getElementById('captureBtn');
    captureBtn.setAttribute('disabled', 'disabled');
    allChecksPassed = false;
    
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
            allChecksPassed = true;
            updateCaptureButton();
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
            allChecksPassed = false;
            updateCaptureButton();
            updateFaceChecks(false, false, false, false, false);
            updateFaceStatus('No face detected - position face in frame', 'warning');
            return;
        }
        
        const detection = detections.reduce((prev, current) => 
            (prev.detection.box.area > current.detection.box.area) ? prev : current
        );
        
        const box = detection.detection.box;
        const landmarks = detection.landmarks;
        const videoWidth = video.videoWidth;
        
        // Check if face is centered
        const faceCenterX = box.x + box.width / 2;
        const isCentered = Math.abs(faceCenterX - videoWidth / 2) < videoWidth * 0.15;
        
        // Check if face size is appropriate (face should be 30-50% of frame for 70% fill in crop)
        const isGoodSize = box.width > videoWidth * 0.18 && box.width < videoWidth * 0.55;
        
        // Check face rotation/tilt using landmarks
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        const leftEyeCenter = leftEye.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
        leftEyeCenter.x /= leftEye.length;
        leftEyeCenter.y /= leftEye.length;
        const rightEyeCenter = rightEye.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
        rightEyeCenter.x /= rightEye.length;
        rightEyeCenter.y /= rightEye.length;
        
        // Calculate angle between eyes (should be close to horizontal)
        const eyeAngle = Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x);
        const eyeAngleDegrees = Math.abs(eyeAngle * 180 / Math.PI);
        const isStraight = eyeAngleDegrees < 8; // Max 8 degrees tilt allowed
        
        const brightness = await checkBrightness(video, box);
        const isGoodBrightness = brightness > 40 && brightness < 220;
        
        // STRICTER white background check
        const bgWhiteness = await checkBackgroundWhiteness(video, box);
        const isWhiteBg = bgWhiteness > 200; // Increased from 170 to 200 (much stricter)
        
        ctx.strokeStyle = isCentered && isGoodSize && isWhiteBg && isStraight ? '#48bb78' : '#dd6b20';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        ctx.fillStyle = '#667eea';
        landmarks.positions.forEach(pos => {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        const allPassed = isCentered && isGoodSize && isGoodBrightness && isWhiteBg && isStraight;
        allChecksPassed = allPassed;
        updateCaptureButton();
        updateFaceChecks(true, isCentered, isGoodSize, isGoodBrightness, isWhiteBg, isStraight);
        
        const guideOval = document.getElementById('guideOval');
        guideOval.className = 'guide-oval';
        if (allPassed) {
            guideOval.classList.add('detected', 'centered');
            updateFaceStatus('Perfect! Ready to capture', 'success');
        } else if (!isWhiteBg) {
            guideOval.classList.add('warning');
            updateFaceStatus('Use a plain white background', 'warning');
        } else if (!isStraight) {
            guideOval.classList.add('warning');
            updateFaceStatus('Face forward — do not tilt your head', 'warning');
        } else if (!isCentered) {
            guideOval.classList.add('warning');
            updateFaceStatus('Move face to center of frame', 'warning');
        } else if (!isGoodSize) {
            guideOval.classList.add('warning');
            updateFaceStatus('Move closer or further from camera', 'warning');
        } else {
            updateFaceStatus('Almost there...', 'warning');
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

async function checkBackgroundWhiteness(video, faceBox) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    
    ctx.drawImage(video, 0, 0, w, h);
    
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    
    let bgSum = 0;
    let bgCount = 0;
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            const inFace = x >= faceBox.x && x <= faceBox.x + faceBox.width &&
                           y >= faceBox.y && y <= faceBox.y + faceBox.height;
            
            if (!inFace) {
                bgSum += (r + g + b) / 3;
                bgCount++;
            }
        }
    }
    
    return bgCount > 0 ? bgSum / bgCount : 128;
}

function updateFaceChecks(faceDetected, centered, goodSize, goodLighting, whiteBg, straight) {
    const checks = {
        checkFace:   faceDetected,
        checkCenter: centered,
        checkSize:   goodSize,
        checkBg:     whiteBg
    };
    Object.entries(checks).forEach(([id, passed]) => {
        const el = document.getElementById(id);
        if (el) el.className = `check-item ${passed ? 'passed' : ''}`;
    });
}

function resetFaceChecks() {
    ['checkFace', 'checkCenter', 'checkSize', 'checkBg'].forEach(id => {
        document.getElementById(id).className = 'check-item';
    });
    allChecksPassed = false;
    updateCaptureButton();
}

function updateCaptureButton() {
    const captureBtn = document.getElementById('captureBtn');
    if (allChecksPassed) {
        captureBtn.removeAttribute('disabled');
    } else {
        captureBtn.setAttribute('disabled', 'disabled');
    }
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
    
    if (!video.videoWidth || !video.videoHeight) {
        console.log('Video not ready yet, retrying...');
        video.onloadedmetadata = () => capturePhoto();
        return;
    }
    
    if (window.ImageCapture) {
        const track = video.srcObject.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
        imageCapture.takePhoto()
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    capturedPhotoData = reader.result;
                    const img = new Image();
                    img.onload = () => {
                        detectAndCrop(img);
                    };
                    img.src = capturedPhotoData;
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
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const imageData = ctx.getImageData(0, 0, 10, 10).data;
    let sum = 0;
    for (let i = 0; i < imageData.length; i += 4) {
        sum += imageData[i] + imageData[i+1] + imageData[i+2];
    }
    
    if (sum < 10) {
        setTimeout(() => captureWithCanvas(video), 200);
        return;
    }
    
    capturedPhotoData = canvas.toDataURL('image/jpeg', 0.92);
    detectAndCrop(canvas);
}

async function detectAndCrop(source) {
    let faceBox = null;
    if (modelsLoaded) {
        try {
            const detections = await faceapi
                .detectAllFaces(source, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
            if (detections.length > 0) {
                const detection = detections.reduce((prev, current) =>
                    (prev.detection.box.area > current.detection.box.area) ? prev : current
                );
                faceBox = detection.detection.box;
            }
        } catch (err) {
            console.warn('Face detection on captured image failed:', err);
        }
    }
    capturedPhotoData = cropToSquare(source, faceBox);
    closeCameraModal();
    showPreviewModal();
}

function cropToSquare(source, faceBox) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;

    let cx, cy, cropSize;

    if (faceBox) {
        const faceCX = faceBox.x + faceBox.width / 2;
        const faceCY = faceBox.y + faceBox.height / 2;
        const faceDim = Math.max(faceBox.width, faceBox.height);
        cropSize = faceDim / 0.7;
        cx = faceCX;
        cy = faceCY;
    } else {
        cropSize = Math.min(w, h);
        cx = w / 2;
        cy = h / 2;
    }

    let sx = Math.round(cx - cropSize / 2);
    let sy = Math.round(cy - cropSize / 2);

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropSize > w) sx = w - cropSize;
    if (sy + cropSize > h) sy = h - cropSize;
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;

    const out = document.createElement('canvas');
    const size = 600;
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.92);
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
let pendingDuplicateOverride = false;

async function handleSubmit(e) {
    e.preventDefault();
    
    if (!selectedFile) {
        showStatus('Please capture a photo first', 'info');
        return;
    }
    
    openConfirmModal();
}

function openConfirmModal() {
    const photoSrc = capturedPhotoData || (selectedFile ? URL.createObjectURL(selectedFile) : '');
    document.getElementById('confirmPhoto').src = photoSrc;

    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const mi       = document.getElementById('mi') ? document.getElementById('mi').value.trim() : '';
    const fullName  = [firstName, middleName, lastName].filter(Boolean).join(' ');

    document.getElementById('confirmName').textContent     = fullName;
    document.getElementById('confirmSection').textContent   = document.getElementById('classSelect').value;
    document.getElementById('confirmLRN').textContent       = document.getElementById('lrn').value || '—';
    document.getElementById('confirmBirthday').textContent  = document.getElementById('birthday').value || '—';
    document.getElementById('confirmSex').textContent       = document.getElementById('sex').value || '—';

    const town = document.getElementById('town').value || '';
    const brgy = document.getElementById('barangay').value || '';
    const loc  = document.getElementById('specificLocation').value || '';
    document.getElementById('confirmAddress').textContent = [loc, brgy, town].filter(Boolean).join(', ') || '—';

    document.getElementById('confirmParent').textContent  = document.getElementById('parentName').value || '—';
    document.getElementById('confirmContact').textContent = document.getElementById('contactNumber').value || '—';

    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
}

async function confirmAndGenerate() {
    closeConfirmModal();
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const section   = document.getElementById('classSelect').value;
    
    showLoading('Checking for duplicates...');
    
    try {
        const checkRes = await fetch(`${API_URL}/api/students/check-duplicate?firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&section=${encodeURIComponent(section)}`);
        const checkData = await checkRes.json();
        
        if (checkData.duplicate) {
            hideLoading();
            const confirmed = confirm(
                `DUPLICATE WARNING!\n\n` +
                `A student with name "${checkData.existing.lastName}, ${checkData.existing.firstName}" ` +
                `already exists in ${checkData.existing.section}.\n` +
                `Created: ${new Date(checkData.existing.createdAt).toLocaleString()}\n\n` +
                `Do you want to OVERRIDE the existing entry?\n` +
                `(The old entry will be deleted and replaced)`
            );
            
            if (!confirmed) {
                showStatus('Entry cancelled by user', 'info');
                return;
            }
            
            showLoading('Deleting old entry...');
            await fetch(`${API_URL}/api/students/${checkData.existing.id}`, { method: 'DELETE' });
        }
    } catch (err) {
        console.warn('Duplicate check failed, proceeding:', err);
    }
    
    showLoading('Generating ID card...');
    
    const formData = new FormData();
    formData.append('firstName', document.getElementById('firstName').value);
    formData.append('middleName', document.getElementById('middleName').value);
    formData.append('lastName', document.getElementById('lastName').value);
    formData.append('sex', document.getElementById('sex').value);
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
            showLoading('Uploading to Google Drive...');
            showStatus('ID generated successfully!', 'success');
            updateIDPreview(result.student);
            document.getElementById('idPreview').classList.remove('hidden');
            document.getElementById('downloadSection').classList.remove('hidden');
            setDriveNote('Uploading to Google Drive…', 'pending');
            pollUploadStatus(result.student.id);
            hideLoading();
        } else {
            hideLoading();
            showStatus(result.error || 'Error saving data', 'info');
        }
    } catch (error) {
        hideLoading();
        showStatus('Error connecting to server', 'info');
    }
}

function setDriveNote(message, state) {
    const note = document.getElementById('driveNote');
    if (!note) return;
    note.textContent = message;
    note.className = `drive-note ${state || ''}`.trim();
}

async function pollUploadStatus(studentId, attempt = 0) {
    const maxAttempts = 60;
    try {
        const res = await fetch(`${API_URL}/api/students/${studentId}/status`);
        const data = await res.json();

        if (data.uploadStatus === 'uploaded') {
            setDriveNote('✓ Saved to Google Drive', 'ok');
            return;
        }
        if (data.uploadStatus === 'failed') {
            setDriveNote('⚠ Drive upload failed. Tap to retry.', 'fail');
            const note = document.getElementById('driveNote');
            note.style.cursor = 'pointer';
            note.onclick = () => resyncUpload(studentId);
            return;
        }
        if (attempt >= maxAttempts) {
            setDriveNote('Still uploading… check back shortly.', 'pending');
            return;
        }
    } catch (error) {
        if (attempt >= maxAttempts) {
            setDriveNote('Could not confirm upload status.', 'fail');
            return;
        }
    }

    setTimeout(() => pollUploadStatus(studentId, attempt + 1), 1500);
}

async function resyncUpload(studentId) {
    setDriveNote('Retrying upload…', 'pending');
    try {
        await fetch(`${API_URL}/api/students/${studentId}/resync`, { method: 'POST' });
    } catch (error) {
        // fall through to polling
    }
    pollUploadStatus(studentId);
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
    document.getElementById('idSex').textContent = student.sex || '-';
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

function showLoading(text, subtext) {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');
    
    if (text) loadingText.textContent = text;
    if (subtext) loadingSubtext.textContent = subtext;
    else loadingSubtext.textContent = 'Please wait';
    
    overlay.classList.remove('hidden');
    
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.setAttribute('disabled', 'disabled');
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
    
    const submitBtn = document.querySelector('#studentForm button[type="submit"]');
    if (submitBtn) submitBtn.removeAttribute('disabled');
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
    if (!currentStudentData || !capturedPhotoData) {
        showStatus('No data available for receipt', 'info');
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f0f0f3';
    ctx.fillRect(0, 0, 400, 700);

    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 400, 80);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 35);

    ctx.font = '12px Arial';
    ctx.fillText('TEMPORARY ID', 200, 55);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(140, 100, 120, 150);
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.strokeRect(140, 100, 120, 150);

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 145, 105, 110, 140);

        const fullName = currentStudentData.middleName
            ? `${currentStudentData.firstName} ${currentStudentData.middleName} ${currentStudentData.lastName}`
            : `${currentStudentData.firstName} ${currentStudentData.lastName}`;

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(fullName, 200, 280);

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

        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 460);
        ctx.lineTo(360, 460);
        ctx.stroke();

        ctx.fillStyle = '#667eea';
        ctx.font = 'bold 11px Arial';
        ctx.fillText('GENERATION DETAILS', 200, 480);

        ctx.fillStyle = '#555555';
        ctx.font = '10px Arial';
        ctx.fillText(`Generated on: ${new Date().toLocaleString()}`, 200, 500);
        ctx.fillText('This is a computer-generated ID.', 200, 515);

        const driveStatus = currentStudentData.driveUploaded ? 'Uploaded to Drive' : 'Pending upload';
        ctx.fillText(`Drive Status: ${driveStatus}`, 200, 530);

        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 620, 400, 80);

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 655);
        ctx.fillText('Cabiao, Nueva Ecija', 200, 670);

        const link = document.createElement('a');
        link.download = `${getFileBaseName()}_receipt.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.click();
        showStatus('✓ Receipt downloaded', 'valid');
    };
    img.src = capturedPhotoData;
}

function downloadIDCard() {
    if (!currentStudentData || !capturedPhotoData) {
        showStatus('No data available for ID card', 'info');
        return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#f0f0f3';
    ctx.fillRect(0, 0, 400, 700);
    
    // Header
    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 400, 80);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 35);
    
    ctx.font = '12px Arial';
    ctx.fillText('TEMPORARY ID', 200, 55);
    
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
        
        // Generation Details divider
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 460);
        ctx.lineTo(360, 460);
        ctx.stroke();
        
        ctx.fillStyle = '#667eea';
        ctx.font = 'bold 11px Arial';
        ctx.fillText('GENERATION DETAILS', 200, 480);
        
        ctx.fillStyle = '#555555';
        ctx.font = '10px Arial';
        ctx.fillText(`Generated on: ${new Date().toLocaleString()}`, 200, 500);
        ctx.fillText('This is a computer-generated ID.', 200, 515);
        
        const driveStatus = currentStudentData.driveUploaded ? 'Uploaded to Drive' : 'Pending upload';
        ctx.fillText(`Drive Status: ${driveStatus}`, 200, 530);
        
        // Footer
        ctx.fillStyle = '#667eea';
        ctx.fillRect(0, 620, 400, 80);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.fillText('CABIAO SENIOR HIGH SCHOOL', 200, 655);
        ctx.fillText('Cabiao, Nueva Ecija', 200, 670);
        
        // Download
        const link = document.createElement('a');
        link.download = `${getFileBaseName()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showStatus('✓ ID card downloaded', 'valid');
    };
    img.src = capturedPhotoData;
}
