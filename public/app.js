const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let capturedPhotoData = null;
let map = null;
let marker = null;
let selectedMapLocation = null;

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
    
    // LRN validation
    setupLRNValidation();
    
    // Birthday format display
    setupBirthdayDisplay();
    
    // GPS and Map location
    setupLocationButtons();
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

// Location buttons (GPS and Map)
function setupLocationButtons() {
    const addressField = document.getElementById('address');
    if (addressField) {
        // Create buttons container
        const btnContainer = document.createElement('div');
        btnContainer.className = 'location-buttons';
        
        // GPS button
        const gpsBtn = document.createElement('button');
        gpsBtn.type = 'button';
        gpsBtn.className = 'btn-location';
        gpsBtn.innerHTML = '📍 Use My Location';
        gpsBtn.onclick = getCurrentLocation;
        
        // Map button
        const mapBtn = document.createElement('button');
        mapBtn.type = 'button';
        mapBtn.className = 'btn-location';
        mapBtn.innerHTML = '🗺️ Select on Map';
        mapBtn.onclick = openMapModal;
        
        btnContainer.appendChild(gpsBtn);
        btnContainer.appendChild(mapBtn);
        addressField.parentNode.appendChild(btnContainer);
    }
}

// GPS Location
function getCurrentLocation() {
    const addressField = document.getElementById('address');
    const locationBtns = document.querySelectorAll('.btn-location');
    
    if (!navigator.geolocation) {
        showStatus('Geolocation is not supported by your browser', 'info');
        return;
    }
    
    locationBtns.forEach(btn => btn.disabled = true);
    locationBtns[0].innerHTML = '⏳ Getting location...';
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            const address = await reverseGeocode(latitude, longitude);
            
            if (address) {
                addressField.value = address;
                showStatus('✓ Location acquired', 'valid');
            } else {
                addressField.value = `LAT: ${latitude.toFixed(6)}, LONG: ${longitude.toFixed(6)}`;
                showStatus('📍 Coordinates added (address lookup failed)', 'warning');
            }
            
            locationBtns.forEach(btn => btn.disabled = false);
            locationBtns[0].innerHTML = '📍 Use My Location';
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
            locationBtns.forEach(btn => btn.disabled = false);
            locationBtns[0].innerHTML = '📍 Use My Location';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Reverse geocode to get detailed address format
async function reverseGeocode(lat, lon) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`
        );
        const data = await response.json();
        
        if (data.address) {
            const addr = data.address;
            
            // Line 1: Purok, Street or Subdivision
            const purok = addr.purok || addr.hamlet || '';
            const street = addr.road || addr.street || '';
            const subdivision = addr.subdivision || addr.neighbourhood || '';
            
            let line1Parts = [purok, street, subdivision].filter(Boolean);
            let line1 = line1Parts.length > 0 ? line1Parts.join(', ') : '';
            
            // Line 2: Barangay, Town, Province, Zipcode
            const barangay = addr.village || addr.quarter || addr.city_district || '';
            const town = addr.town || addr.city || addr.municipality || '';
            const province = addr.state || addr.province || '';
            const zipcode = addr.postcode || '';
            
            let line2Parts = [barangay, town, province, zipcode].filter(Boolean);
            let line2 = line2Parts.join(', ');
            
            // Format: Line1, Line2
            if (line1 && line2) {
                return `${line1.toUpperCase()}, ${line2.toUpperCase()}`;
            } else if (line2) {
                return line2.toUpperCase();
            }
        }
    } catch (error) {
        console.error('Reverse geocode error:', error);
    }
    return null;
}

// Map Modal Functions
function openMapModal() {
    const modal = document.getElementById('mapModal');
    modal.classList.remove('hidden');
    
    // Initialize map if not already done
    if (!map) {
        // Default to Philippines center
        map = L.map('mapContainer').setView([12.8797, 121.7740], 6);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        // Click on map to select location
        map.on('click', async (e) => {
            const { lat, lng } = e.latlng;
            
            // Place or move marker
            if (marker) {
                marker.setLatLng([lat, lng]);
            } else {
                marker = L.marker([lat, lng]).addTo(map);
            }
            
            // Update coords display
            document.getElementById('mapCoords').textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
            
            // Reverse geocode
            const address = await reverseGeocode(lat, lng);
            document.getElementById('mapAddress').textContent = address || 'Address not found';
            
            selectedMapLocation = { lat, lng, address };
            document.getElementById('confirmMapBtn').disabled = !address;
        });
    }
    
    // Invalidate size to fix map rendering
    setTimeout(() => map.invalidateSize(), 100);
}

function closeMapModal() {
    document.getElementById('mapModal').classList.add('hidden');
    selectedMapLocation = null;
    document.getElementById('confirmMapBtn').disabled = true;
}

function confirmMapLocation() {
    if (selectedMapLocation && selectedMapLocation.address) {
        document.getElementById('address').value = selectedMapLocation.address;
        showStatus('✓ Location selected from map', 'valid');
    }
    closeMapModal();
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
    
    capturedPhotoData = canvas.toDataURL('image/jpeg', 0.9);
    
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
