/* bulk.js — Bulk Entry: passcode, Excel parse, upload orchestration */
(function() {
    'use strict';

    var PASSCODE = 'cshs305872';
    var REQUIRED_COLS = ['firstName','lastName','lrn','section','photoLink'];
    var ALL_COLS = ['firstName','middleName','lastName','sex','birthday','lrn','section','address','parentName','contactNumber','photoLink'];
    var bulkRows = [];
    var bulkRunning = false;

    // ── Passcode ──────────────────────────────────────────────────
    window.closePasscodeModal = function() {
        document.getElementById('passcodeModal').classList.add('hidden');
    };

    window.submitPasscode = function() {
        var val = document.getElementById('passcodeInput').value;
        if (val === PASSCODE) {
            closePasscodeModal();
            showBulkPage();
        } else {
            document.getElementById('passcodeError').classList.remove('hidden');
            document.getElementById('passcodeInput').value = '';
            document.getElementById('passcodeInput').focus();
        }
    };

    document.getElementById('passcodeInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.submitPasscode();
    });

    function showBulkPage() {
        window.showPage('bulkPage');
        resetBulk();
    }

    // ── File handling ─────────────────────────────────────────────
    var dropzone = document.getElementById('bulkDropzone');
    var fileInput = document.getElementById('bulkFileInput');

    dropzone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', function() {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        var file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
    fileInput.addEventListener('change', function(e) {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx','xls','csv'].includes(ext)) {
            alert('Please upload an Excel (.xlsx, .xls) or CSV file.');
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: 'array' });
                var sheetName = workbook.SheetNames[0];
                var sheet = workbook.Sheets[sheetName];
                var json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (json.length === 0) {
                    alert('The Excel file is empty.');
                    return;
                }

                // Normalize column names (trim, lowercase)
                bulkRows = json.map(function(row) {
                    var normalized = {};
                    Object.keys(row).forEach(function(k) {
                        var key = k.trim();
                        // Try to match case-insensitively
                        var match = ALL_COLS.find(function(c) {
                            return c.toLowerCase() === key.toLowerCase();
                        });
                        normalized[match || key] = String(row[k]).trim();
                    });
                    return normalized;
                });

                // Validate required columns
                var headers = Object.keys(bulkRows[0]);
                var missing = REQUIRED_COLS.filter(function(c) {
                    return !headers.some(function(h) { return h.toLowerCase() === c.toLowerCase(); });
                });
                if (missing.length > 0) {
                    alert('Missing required columns: ' + missing.join(', '));
                    bulkRows = [];
                    return;
                }

                // Show file info and preview
                document.getElementById('bulkFileInfo').classList.remove('hidden');
                document.getElementById('bulkFileInfo').innerHTML =
                    '<span class="file-name">' + file.name + '</span> — ' +
                    '<span class="file-count">' + bulkRows.length + ' students</span> detected';

                showPreview();
            } catch (err) {
                alert('Error reading Excel file: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function showPreview() {
        var preview = document.getElementById('bulkPreview');
        preview.classList.remove('hidden');
        document.getElementById('bulkRowCount').textContent = bulkRows.length;

        var head = document.getElementById('bulkPreviewHead');
        var body = document.getElementById('bulkPreviewBody');
        head.innerHTML = '';
        body.innerHTML = '';

        var cols = ['firstName','lastName','section','lrn','photoLink'];
        cols.forEach(function(c) {
            var th = document.createElement('th');
            th.textContent = c;
            head.appendChild(th);
        });

        var showRows = bulkRows.slice(0, 10);
        showRows.forEach(function(row, i) {
            var tr = document.createElement('tr');
            cols.forEach(function(c) {
                var td = document.createElement('td');
                var val = row[c] || '';
                if (c === 'photoLink' && val.length > 30) val = val.substring(0, 30) + '...';
                td.textContent = val;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });

        if (bulkRows.length > 10) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = cols.length;
            td.style.textAlign = 'center';
            td.style.color = 'var(--text-light)';
            td.textContent = '... and ' + (bulkRows.length - 10) + ' more rows';
            tr.appendChild(td);
            body.appendChild(tr);
        }
    }

    // ── Reset ─────────────────────────────────────────────────────
    window.resetBulk = function() {
        bulkRows = [];
        bulkRunning = false;
        document.getElementById('bulkFileInfo').classList.add('hidden');
        document.getElementById('bulkPreview').classList.add('hidden');
        document.getElementById('bulkProgress').classList.add('hidden');
        document.getElementById('bulkResults').classList.add('hidden');
        document.getElementById('bulkDropzone').classList.remove('hidden');
        fileInput.value = '';
    };

    // ── Bulk upload ───────────────────────────────────────────────
    window.startBulkUpload = async function() {
        if (bulkRunning || bulkRows.length === 0) return;
        bulkRunning = true;

        document.getElementById('bulkPreview').classList.add('hidden');
        document.getElementById('bulkDropzone').classList.add('hidden');
        document.getElementById('bulkFileInfo').classList.add('hidden');
        document.getElementById('bulkProgress').classList.remove('hidden');
        document.getElementById('bulkResults').classList.add('hidden');

        var total = bulkRows.length;
        var success = 0;
        var failed = 0;
        var results = [];

        for (var i = 0; i < total; i++) {
            var row = bulkRows[i];
            var name = (row.lastName || '') + ', ' + (row.firstName || '');
            var status = 'pending';
            var error = '';

            try {
                // Validate required fields
                if (!row.firstName || !row.lastName || !row.lrn || !row.section || !row.photoLink) {
                    throw new Error('Missing required field');
                }

                var payload = {
                    firstName: row.firstName.toUpperCase(),
                    middleName: (row.middleName || '').toUpperCase(),
                    lastName: row.lastName.toUpperCase(),
                    sex: row.sex || '',
                    birthday: row.birthday || '',
                    lrn: row.lrn,
                    section: row.section,
                    address: row.address || '',
                    parentName: row.parentName || '',
                    contactNumber: row.contactNumber || '',
                    photoLink: row.photoLink
                };

                var res = await fetch('/api/bulk-students', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                var data = await res.json();

                if (res.ok && data.success) {
                    status = 'done';
                    success++;
                } else if (res.status === 409 && data.duplicate) {
                    status = 'duplicate';
                    error = 'Duplicate LRN';
                    failed++;
                } else {
                    throw new Error(data.error || 'Unknown error');
                }
            } catch (err) {
                status = 'failed';
                error = err.message || 'Error';
                failed++;
            }

            results.push({ index: i + 1, name: name, section: row.section || '', status: status, error: error });

            // Update progress
            var pct = Math.round(((i + 1) / total) * 100);
            document.getElementById('bulkProgressBar').style.width = pct + '%';
            document.getElementById('bulkProgressText').textContent = (i + 1) + ' / ' + total;
            document.getElementById('bulkProgressPercent').textContent = pct + '%';
            document.getElementById('bulkSuccessCount').textContent = success;
            document.getElementById('bulkFailCount').textContent = failed;
        }

        // Show results
        document.getElementById('bulkProgress').classList.add('hidden');
        document.getElementById('bulkResults').classList.remove('hidden');

        var tbody = document.getElementById('bulkResultsBody');
        tbody.innerHTML = '';
        results.forEach(function(r) {
            var tr = document.createElement('tr');
            var statusClass = r.status === 'done' ? 'status-ok' : (r.status === 'duplicate' ? 'status-fail' : 'status-fail');
            var statusText = r.status === 'done' ? '✓ Done' : (r.status === 'duplicate' ? '⚠ Duplicate' : '✕ Failed');
            tr.innerHTML =
                '<td>' + r.index + '</td>' +
                '<td>' + r.name + '</td>' +
                '<td>' + r.section + '</td>' +
                '<td class="' + statusClass + '">' + statusText + '</td>' +
                '<td style="color:#e53e3e;font-size:0.75rem">' + r.error + '</td>';
            tbody.appendChild(tr);
        });

        bulkRunning = false;
    };
})();
