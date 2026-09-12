const API_URL = '';
let selectedFile = null;
let videoStream = null;
let faceDetectionInterval = null;
let modelsLoaded = false;
let originalPhotoData = null;
let processedPhotoData = null;

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

async function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.createElement('canvas');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    // Close camera modal
    closeCameraModal();
    
    // Store original photo
    originalPhotoData = canvas.toDataURL('image/jpeg', 0.9);
    
    // Show processing modal
    showProcessingModal('Processing photo...');
    
    // Convert to blob for processing
    canvas.toBlob(async (blob) => {
        updateProcessingStatus('Removing background...', 30);
        
        try {
            // Try to remove background using canvas-based approach
            const processedBlob = await removeBackgroundSimple(blob);
            
            updateProcessingStatus('Processing complete!', 100);
            
            // Store processed photo
            processedPhotoData = await blobToDataURL(processedBlob);
            
            // Show preview modal
            showPreviewModal();
            
        } catch (error) {
            console.error('Background removal failed:', error);
            
            // Fallback - use original photo
            processedPhotoData = originalPhotoData;
            
            // Show preview modal with original only
            showPreviewModal();
        }
    }, 'image/jpeg', 0.9);
}

// Simple background removal using canvas
async function removeBackgroundSimple(imageBlob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // Draw original image
            ctx.drawImage(img, 0, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Simple background removal based on color similarity to corners
            const cornerColors = [
                getPixelColor(data, 0, 0, canvas.width),
                getPixelColor(data, canvas.width - 1, 0, canvas.width),
                getPixelColor(data, 0, canvas.height - 1, canvas.width),
                getPixelColor(data, canvas.width - 1, canvas.height - 1, canvas.width)
            ];
            
            const avgCorner = {
                r: cornerColors.reduce((s, c) => s + c.r, 0) / 4,
                g: cornerColors.reduce((s, c) => s + c.g, 0) / 4,
                b: cornerColors.reduce((s, c) => s + c.b, 0) / 4
            };
            
            // Process each pixel
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Calculate color distance from corner average
                const distance = Math.sqrt(
                    Math.pow(r - avgCorner.r, 2) +
                    Math.pow(g - avgCorner.g, 2) +
                    Math.pow(b - avgCorner.b, 2)
                );
                
                // If pixel is similar to background, make it transparent
                if (distance < 80) {
                    data[i + 3] = 0; // Set alpha to 0
                }
            }
            
            // Put modified image data back
            ctx.putImageData(imageData, 0, 0);
            
            // Convert to blob
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        };
        
        img.onerror = reject;
        img.src = URL.createObjectURL(imageBlob);
    });
}

function getPixelColor(data, x, y, width) {
    const i = (y * width + x) * 4;
    return {
        r: data[i],
        g: data[i + 1],
        b: data[i + 2]
    };
}

function blobToDataURL(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

function showProcessingModal(message) {
    const modal = document.getElementById('processingModal');
    modal.classList.remove('hidden');
    document.getElementById('processingStatus').textContent = message;
    document.getElementById('progressFill').style.width = '0%';
}

function updateProcessingStatus(message, percent) {
    document.getElementById('processingStatus').textContent = message;
    document.getElementById('progressFill').style.width = `${percent}%`;
}

function hideProcessingModal() {
    document.getElementById('processingModal').classList.add('hidden');
}

function showPreviewModal() {
    hideProcessingModal();
    
    const modal = document.getElementById('previewModal');
    modal.classList.remove('hidden');
    
    document.getElementById('originalPhoto').src = originalPhotoData;
    document.getElementById('processedPhoto').src = processedPhotoData;
}

function approvePhoto() {
    // Use the processed photo
    selectedFile = dataURLtoFile(processedPhotoData, 'photo.png');
    
    // Update preview
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${processedPhotoData}" alt="Student Photo">`;
    
    // Show validation
    showPhotoValidation('✓ Photo approved', 'valid');
    
    // Close preview modal
    document.getElementById('previewModal').classList.add('hidden');
}

function rejectPhoto() {
    // Reset
    originalPhotoData = null;
    processedPhotoData = null;
    
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
