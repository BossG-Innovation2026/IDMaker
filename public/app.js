const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let capturedPhotoData = null;

// Load face-api models on page load
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
        console.error('Error loading face detection models:', error);
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
    document.getElementById('saveBtn').addEventListener('click', saveToDrive);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);
    
    // Auto caps lock for text fields
    setupCapsLock();
    
    // Phone number formatting
    setupPhoneFormat();
    
    // Birthday format display
    setupBirthdayDisplay();
    
    // GPS location
    setupGPSLocation();
}

// Auto caps lock for text fields
function setupCapsLock() {
    const textFields = ['firstName', 'middleName', 'lastName', 'address', 'parentName'];
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
            
            // Limit to 11 digits
            if (value.length > 11) {
                value = value.substring(0, 11);
            }
            
            // Format as 09xx-xxx-xxxx
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

// GPS location
function setupGPSLocation() {
    const addressField = document.getElementById('address');
    if (addressField) {
        // Add a button next to address field
        const locationBtn = document.createElement('button');
        locationBtn.type = 'button';
        locationBtn.className = 'btn-location';
        locationBtn.innerHTML = '📍 Use My Location';
        locationBtn.onclick = getCurrentLocation;
        addressField.parentNode.appendChild(locationBtn);
    }
}

function getCurrentLocation() {
    const addressField = document.getElementById('address');
    const locationBtn = document.querySelector('.btn-location');
    
    if (!navigator.geolocation) {
        showStatus('Geolocation is not supported by your browser', 'info');
        return;
    }
    
    locationBtn.innerHTML = '⏳ Getting location...';
    locationBtn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            try {
                // Use free geocoding API
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
                );
                const data = await response.json();
                
                if (data.display_name) {
                    // Extract address parts
                    const address = data.address;
                    const parts = [
                        address.house_number,
                        address.road,
                        address.village || address.suburb || address.city_district,
                        address.city || address.municipality,
                        address.state || address.province,
                        address.postcode
                    ].filter(Boolean);
                    
                    addressField.value = parts.join(', ').toUpperCase();
                    showStatus('✓ Location acquired', 'valid');
                }
            } catch (error) {
                // Fallback to coordinates
                addressField.value = `LAT: ${latitude.toFixed(6)}, LONG: ${longitude.toFixed(6)}`;
                showStatus('📍 Coordinates added (address lookup failed)', 'warning');
            }
            
            locationBtn.innerHTML = '📍 Use My Location';
            locationBtn.disabled = false;
        },
        (error) => {
            let message = 'Unable to get location';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    message = 'Location permission denied';
                    break;
                case error.POSITION_UNAVAILABLE:
                    message = 'Location unavailable';
                    break;
                case error.TIMEOUT:
                    message = 'Location request timed out';
                    break;
            }
            showStatus(message, 'info');
            locationBtn.innerHTML = '📍 Use My Location';
            locationBtn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Camera Modal Functions
async function openCameraModal() {
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('hidden');
    
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
        
        if (modelsLoaded) {
            startFaceDetection();
        } else {
            updateFaceStatus('Camera ready (face detection unavailable)', 'warning');
            document.getElementById('captureBtn').disabled = false;
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
            updateFaceStatus('No face detected', 'error');
            document.getElementById('captureBtn').disabled = true;
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
            document.getElementById('captureBtn').disabled = false;
        } else if (isCentered && isGoodSize) {
            guideOval.classList.add('warning');
            updateFaceStatus('Adjust lighting', 'warning');
            document.getElementById('captureBtn').disabled = false;
        } else {
            updateFaceStatus('Position your face in the oval', 'warning');
            document.getElementById('captureBtn').disabled = true;
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
    document.getElementById('captureBtn').disabled = true;
}

function updateFaceStatus(text, type) {
    const status = document.getElementById('faceStatus');
    status.querySelector('.status-text').textContent = text;
    status.className = `face-status ${type}`;
}

function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.createElement('canvas');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    // Store captured photo
    capturedPhotoData = canvas.toDataURL('image/jpeg', 0.9);
    
    // Close camera modal
    closeCameraModal();
    
    // Show preview modal
    showPreviewModal();
}

function showPreviewModal() {
    const modal = document.getElementById('previewModal');
    modal.classList.remove('hidden');
    document.getElementById('capturedPhoto').src = capturedPhotoData;
}

function approvePhoto() {
    // Convert data URL to file
    selectedFile = dataURLtoFile(capturedPhotoData, 'photo.jpg');
    
    // Update preview
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${capturedPhotoData}" alt="Student Photo">`;
    
    // Show validation
    showPhotoValidation('✓ Photo approved', 'valid');
    
    // Close preview modal
    document.getElementById('previewModal').classList.add('hidden');
}

function rejectPhoto() {
    // Reset
    capturedPhotoData = null;
    
    // Close preview modal
    document.getElementById('previewModal').classList.add('hidden');
    
    // Open camera again
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
            showStatus('ID generated successfully!', 'success');
            updateIDPreview(result.student);
            document.getElementById('idPreview').classList.remove('hidden');
            document.getElementById('saveBtn').classList.remove('hidden');
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
