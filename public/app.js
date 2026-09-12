const API_URL = '';
let selectedFile = null;

// Load classes on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadClasses();
    setupEventListeners();
});

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
    // Photo capture
    document.getElementById('cameraInput').addEventListener('change', handlePhotoCapture);
    
    // Form submit
    document.getElementById('studentForm').addEventListener('submit', handleSubmit);
    
    // Save to Drive
    document.getElementById('saveBtn').addEventListener('click', saveToDrive);
}

function openCamera() {
    document.getElementById('cameraInput').click();
}

function handlePhotoCapture(e) {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        validatePhoto(file);
    }
}

function validatePhoto(file) {
    const validation = document.getElementById('photoValidation');
    validation.classList.remove('hidden', 'valid', 'invalid', 'warning');
    
    // Check file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        validation.textContent = '❌ Invalid file type. Use JPEG, PNG, or WebP.';
        validation.classList.add('invalid');
        return;
    }
    
    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        validation.textContent = '❌ File too large. Maximum size is 5MB.';
        validation.classList.add('invalid');
        return;
    }
    
    // Read and validate image dimensions
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const photoPreview = document.getElementById('photoPreview');
            
            // Check minimum dimensions
            if (img.width < 200 || img.height < 200) {
                validation.textContent = '⚠️ Photo too small. Minimum 200x200 pixels.';
                validation.classList.add('warning');
            } else {
                validation.textContent = '✓ Photo valid (' + img.width + 'x' + img.height + 'px)';
                validation.classList.add('valid');
            }
            
            // Display photo
            photoPreview.innerHTML = `<img src="${event.target.result}" alt="Student Photo">`;
            photoPreview.classList.add('has-photo');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleSubmit(e) {
    e.preventDefault();
    
    // Validate photo
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
    
    // TODO: Implement actual Google Drive save
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
