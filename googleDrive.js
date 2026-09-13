const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '0ACktHqI8zSSCUk9PVA';

const SHEET_HEADERS = [
    'Name', 'Section', 'LRN', 'Birthday', 'Address',
    'Parent/Guardian', 'Contact', 'Photo Link', 'ID Card Link', 'Generated'
];

class GoogleDriveService {
    constructor() {
        this.auth = null;
        this.drive = null;
        this.sheets = null;
        this.folderCache = {};
        this.sheetCache = {};
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
            const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
            const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

            // Prefer OAuth2 (a real user account) - required for My Drive uploads,
            // since service accounts have no storage quota.
            if (oauthClientId && oauthClientSecret && refreshToken) {
                const oauth2Client = new google.auth.OAuth2(
                    oauthClientId,
                    oauthClientSecret,
                    process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
                );
                oauth2Client.setCredentials({ refresh_token: refreshToken });

                this.auth = oauth2Client;
                this.authType = 'oauth2';
                this.drive = google.drive({ version: 'v3', auth: this.auth });
                this.sheets = google.sheets({ version: 'v4', auth: this.auth });
                this.initialized = true;
                console.log('✓ Google Drive initialized (OAuth2 user account)');
                return;
            }

            // Fall back to service account (works only with Shared Drives)
            const envCredentials = {
                type: 'service_account',
                project_id: process.env.GOOGLE_PROJECT_ID,
                private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_CLIENT_ID,
                auth_uri: process.env.GOOGLE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
                token_uri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
                auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.GOOGLE_CLIENT_EMAIL)}`
            };

            const hasEnvCreds = Object.values(envCredentials).every(v => v && v !== '');

            let credentials;
            if (hasEnvCreds) {
                credentials = envCredentials;
            } else {
                const keyPath = path.join(__dirname, 'credentials.json');
                if (fs.existsSync(keyPath)) {
                    console.log('Loading credentials from credentials.json');
                    credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                } else if (process.env.GOOGLE_SA_JSON) {
                    console.log('Loading credentials from GOOGLE_SA_JSON env');
                    credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SA_JSON, 'base64').toString('utf8'));
                } else {
                    const b64 = 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6ImlkLW1ha2VyLTUwODQwNiIsInByaXZhdGVfa2V5X2lkIjoiNjdjZTQyZjJmYWEzZTE2ZDViYTI4ZjlkZjk2ZTIwNjQwMmE3ZmE5YyIsInByaXZhdGVfa2V5IjoiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdlFJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLY3dnZ1NqQWdFQUFvSUJBUURUVldVcmpUMlArS0tRXG42bENsU0QrbERVRGlGV3B2RkFuS2djKy9UWXZVRGVKbitUY3NieUdDcllHVVZpZW1OamFJQVBrZmtzZk55Tm4wXG45cGNGcXRqNmJXN3d6cUhXMHhXdWp0MXRPQUMzanpDUXk2ZjNFYy85WVl6QXEzSXZuYWZPTkUwZ0RIM01NMVlyXG5UMi9nclJGSnVUbVpPb3k3dW1OZlhsOHg0cmo3c2FpWlMrdDFSRWtsRzlYR05vcUdxdXNZNVBmN2swUnl0b0tTXG5Sc0Jrd2V1YXk1Wk54TDVQZ2o3VVJlSlhQT1M0bUVXR1MybUhNT2dIQlR0K1pJb2F2a3VkU092UUtZTXNEdnY2XG55SjR0UWRQZjEyWWNZdkFzbTg1eGY1cERENm9nbWUvRnhZWk11bUgyRy9LeVdDUExoL1dXM21pRnUrTnlUK3ZpXG5SY2FIalVFL0FnTUJBQUVDZ2dFQVhNVVMyVkJ5SXQ0eGRzMzFRdWo1VDFvSERuZjZOZktrN2FtWWFkRC92Y0d1XG5qcGZlK1hsN1MyTWhDOTNhSCtPU2dwZHl4TUpwUlZPVElpNlJVeUtSaHpVOHl5Ylo4blROQXNpaU9ReXBlK3EyXG5sZ2xnblZ2TFl0NU1yRk5XbDhKc1pGK2ZMNTlzSlpTdmtlbVlJaGUzREJic1N2QmgwUkxjQm9SbDQzODBWdi96XG44ZWdrQmdCTVlsdmFBQ0lubWx6Mmlxd0hCcXJwK2dOQzgvZWdCVitUNm1nODdsTzlWTG9sb3M4OVkxZ1dyMmx3XG5IS1hhQUZ2R3NMQmlFTnBCZjM5emp4a3NnTEVqL3ZjdkZaQXB3UzhDMjM0b2ZtZUxYZlRWemRER1ZnUE1wNGQ3XG5rTW5zM3dZYXVvdWg0aVJyL2xaMzdzcXZvVCtORGpMQVgyZUxNNFZBV1FLQmdRRC94d2hKOHVLMXNsZzBjTXZBXG5GTmJtRjJQbkllVncrdFdCUjJrK2dWYWFVazNiVHZ5djRVcFhqNEpQb0NBQUtxSDVoVExUYVI5Nmx4a2FEb2dGXG5lM080azN5a1ZYK0FqZlNSbHJEb0xtbnlIQndWRndTUDlYRFB1RURiUmlHanpnT0g5dTdYSllGL2Y1Nkd0VmZHXG5GV1l4MUhNdGx5bklPNkRScDBqVkZiQXBhd0tCZ1FEVGhIYlF4STVpbmRidGczbG5pSmdteWFiK2FCQmNxQmExXG5KVzdrQUx2OUNxQ3I5ZkIzcEZFWndrY25LY2g5bGY4T3BnblJiSUtTTVUvbkJEUnpHQzFzSis0NHRYb3N3b0ZWXG50cFJIR1lYaDFNN0hEZHVDRkIrOWx3WjlGRFQ3NkpIcE1ycDZwTkM5T2ROcjlHY2RqajZ1cXZLMjZqTXhTdjMwXG5vZzBFYkxVWWZRS0JnUUN0UnJyWXpoREVJdFFhZ3FlbHN2aDYzREd6N1lTd2ExMmt2U29SVERITlRpQ3NoL0FyXG5mcWFNZHc1Q3Z5bXVzek1VQlNhUGpsSGpET1hXZnkycStSMUdWN1JDNkNEK2lDeTlUS2NBUkNGR0FjRU1rSkZvXG5yVkFGaUw5M1RTV1JBUW5uWEdRbG9LVUFLUWJPSDZBYzgzWk9INnovbjc2UWhjVEhBMXNWOENGdGpRS0JnRGpXXG5zTUw2L3JRYmJDVVpIbWVtK2hQNlBrakJHQngrQXRRY3dnYTg5OGRRc3NwaTVZS1JBa1lrd2RBUlYxSUFHN0VKXG5CenhpcDFlM3Jwd0tzamwzZHNWSW1haGRnLzVCS2xZcElRRldKM2IvSTYyejJKZkU1cDZnMWRxSXNwQTY5L0t0XG5jaFVBOHlMV1JpME5XU1JGRkMwRnZRRlFQLzl3QW54Wmk1dnp4bHBWQW9HQWRsSFFUTGNkT1JiM2FGYXJJNDEwXG5tQzBtNCtPUS9PK00vZG1LOGZ2cU1hdlBUN3A3VzRqVDlSMTQvWG5PMlBJTzRtMUgxVWNVUGJGdnFPcU9BTE9DXG5ITXRST3B5RVhiTVFON2JaUlNwRWJaY0FVYXUvTjlDdmsxUlppT2NOZzRRd0RUcUJzSnJFaENybDJ0N1FQTnZZXG5nanVpSVNqRGlhUXljdHJvSGxIOVB1dz1cbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsImNsaWVudF9lbWFpbCI6ImlkLW1ha2VyLXNlcnZpY2VAaWQtbWFrZXItNTA4NDA2LmlhbS5nc2VydmljZWFjY291bnQuY29tIiwiY2xpZW50X2lkIjoiMTEyODcxNjUzNDAxMjE0MTEyNDE1IiwiYXV0aF91cmkiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsInRva2VuX3VyaSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwiYXV0aF9wcm92aWRlcl94NTA5X2NlcnRfdXJsIjoiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vb2F1dGgyL3YxL2NlcnRzIiwiY2xpZW50X3g1MDlfY2VydF91cmwiOiJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9yb2JvdC92MS9tZXRhZGF0YS94NTA5L2lkLW1ha2VyLXNlcnZpY2UlNDBpZC1tYWtlci01MDg0MDYuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJ1bml2ZXJzZV9kb21haW4iOiJnb29nbGVhcGlzLmNvbSJ9';
                    console.log('Loading embedded service account credentials');
                    credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
                }
            }

            this.auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
            });

            this.drive = google.drive({ version: 'v3', auth: this.auth });
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            this.authType = 'service_account';
            this.initialized = true;
            console.log('✓ Google Drive initialized (service account)');
        } catch (error) {
            console.error('Failed to initialize Google Drive:', error.message);
            this.initialized = false;
        }
    }

    async getOrCreateFolder(folderName, parentId = PARENT_FOLDER_ID) {
        await this.initialize();
        
        if (!this.initialized) {
            throw new Error('Google Drive not initialized');
        }

        const cacheKey = `${parentId}/${folderName}`;
        
        if (this.folderCache[cacheKey]) {
            return this.folderCache[cacheKey];
        }

        try {
            // Search for existing folder
            const response = await this.drive.files.list({
                q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            if (response.data.files.length > 0) {
                this.folderCache[cacheKey] = response.data.files[0].id;
                return response.data.files[0].id;
            }

            // Create new folder
            const folderMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId]
            };

            const folder = await this.drive.files.create({
                resource: folderMetadata,
                fields: 'id',
                supportsAllDrives: true
            });

            this.folderCache[cacheKey] = folder.data.id;
            console.log(`✓ Created folder: ${folderName}`);
            return folder.data.id;
        } catch (error) {
            console.error('Error creating folder:', error);
            throw error;
        }
    }

    async uploadFile(fileBuffer, fileName, mimeType, folderId) {
        await this.initialize();
        
        if (!this.initialized) {
            throw new Error('Google Drive not initialized');
        }

        try {
            const { Readable } = require('stream');
            const fileMetadata = {
                name: fileName,
                parents: [folderId]
            };

            const media = {
                mimeType: mimeType,
                body: Readable.from([fileBuffer])
            };

            const file = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink',
                supportsAllDrives: true
            });

            return {
                id: file.data.id,
                link: file.data.webViewLink
            };
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    }

    async uploadStudentPhoto(fileBuffer, fileName, mimeType, section) {
        try {
            // Create section folder if not exists
            const sectionFolderId = await this.getOrCreateFolder(section);
            
            // Upload file
            const result = await this.uploadFile(fileBuffer, fileName, mimeType, sectionFolderId);
            
            return {
                success: true,
                fileId: result.id,
                fileLink: result.link,
                folderId: sectionFolderId
            };
        } catch (error) {
            const msg = error.message || String(error);
            if (msg.includes('storage quota')) {
                console.error('Drive upload blocked: service accounts cannot write to My Drive. ' +
                    'Use OAuth2 (GOOGLE_OAUTH_*) or a Shared Drive. See .env.example.');
            } else {
                console.error('Error uploading student photo:', error);
            }
            return {
                success: false,
                error: msg
            };
        }
    }
    async getOrCreateSheet(section, folderId) {
        await this.initialize();
        if (!this.initialized) throw new Error('Google Drive not initialized');

        const cacheKey = `sheet_${section}`;
        if (this.sheetCache[cacheKey]) return this.sheetCache[cacheKey];

        const sheetName = `${section} - Records`;

        try {
            const response = await this.drive.files.list({
                q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and '${folderId}' in parents and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            if (response.data.files.length > 0) {
                this.sheetCache[cacheKey] = response.data.files[0].id;
                return response.data.files[0].id;
            }

            const spreadsheet = await this.sheets.spreadsheets.create({
                resource: {
                    properties: { title: sheetName },
                    sheets: [{ properties: { title: 'Students' } }]
                },
                fields: 'spreadsheetId'
            });

            const spreadsheetId = spreadsheet.data.spreadsheetId;

            await this.drive.files.update({
                fileId: spreadsheetId,
                addParents: folderId,
                fields: 'id, parents',
                supportsAllDrives: true
            });

            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'Students!A1:J1',
                valueInputOption: 'RAW',
                resource: { values: [SHEET_HEADERS] }
            });

            this.sheetCache[cacheKey] = spreadsheetId;
            console.log(`Created spreadsheet: ${sheetName}`);
            return spreadsheetId;
        } catch (error) {
            console.error('Error creating/finding sheet:', error.message);
            throw error;
        }
    }

    async appendStudentRow(student, fileLinks, folderId) {
        await this.initialize();
        if (!this.initialized) throw new Error('Google Drive not initialized');

        try {
            const spreadsheetId = await this.getOrCreateSheet(student.section, folderId);

            const fullName = student.middleName
                ? `${student.firstName} ${student.middleName} ${student.lastName}`
                : `${student.firstName} ${student.lastName}`;

            const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            const row = [
                fullName,
                student.section,
                student.lrn,
                formattedDate,
                student.address,
                student.parentName,
                student.contactNumber,
                fileLinks.photo || '',
                fileLinks.idCard || '',
                new Date().toLocaleString()
            ];

            await this.sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Students!A:J',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [row] }
            });

            console.log(`Appended row to ${student.section} sheet: ${fullName}`);
            return { success: true, spreadsheetId };
        } catch (error) {
            console.error('Error appending to sheet:', error.message);
            return { success: false, error: error.message };
        }
    }

    async generateSectionExcel(section, students, folderId) {
        await this.initialize();
        if (!this.initialized) throw new Error('Google Drive not initialized');

        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Students');

            worksheet.columns = [
                { header: '#', key: 'num', width: 5 },
                { header: 'Student No', key: 'studentNo', width: 12 },
                { header: 'LRN', key: 'lrn', width: 15 },
                { header: 'Last Name', key: 'lastName', width: 18 },
                { header: 'First Name', key: 'firstName', width: 18 },
                { header: 'M.I.', key: 'mi', width: 8 },
                { header: 'Sex', key: 'sex', width: 8 },
                { header: 'Birthday', key: 'birthday', width: 15 },
                { header: 'Address', key: 'address', width: 35 },
                { header: 'Parent/Guardian', key: 'parentName', width: 22 },
                { header: 'Contact', key: 'contactNumber', width: 15 },
                { header: 'Photo Link', key: 'photoLink', width: 25 },
                { header: 'ID Card Link', key: 'idCardLink', width: 25 },
                { header: 'Generated', key: 'createdAt', width: 22 }
            ];

            worksheet.getRow(1).font = { bold: true, size: 11 };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
            worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

            students.forEach((s, i) => {
                const mi = s.middleName ? s.middleName.charAt(0) + '.' : '';
                const photoLink = s.driveFiles?.photo?.fileLink || '';
                const idCardLink = s.driveFiles?.idCard?.fileLink || '';
                
                worksheet.addRow({
                    num: i + 1,
                    studentNo: s.studentNo || '',
                    lrn: s.lrn,
                    lastName: s.lastName,
                    firstName: s.firstName,
                    mi: mi,
                    sex: s.sex || '',
                    birthday: new Date(s.birthday).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                    address: s.address,
                    parentName: s.parentName,
                    contactNumber: s.contactNumber,
                    photoLink: photoLink,
                    idCardLink: idCardLink,
                    createdAt: new Date(s.createdAt).toLocaleString()
                });
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const fileName = `${section} - Records.xlsx`;
            
            const existingExcel = await this.drive.files.list({
                q: `name='${fileName}' and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and '${folderId}' in parents and trashed=false`,
                fields: 'files(id)',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            if (existingExcel.data.files.length > 0) {
                const { Readable } = require('stream');
                await this.drive.files.update({
                    fileId: existingExcel.data.files[0].id,
                    media: {
                        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        body: Readable.from([buffer])
                    },
                    supportsAllDrives: true
                });
                console.log(`Updated Excel: ${fileName}`);
                return { success: true, fileId: existingExcel.data.files[0].id };
            } else {
                const result = await this.uploadFile(buffer, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', folderId);
                console.log(`Created Excel: ${fileName}`);
                return { success: true, fileId: result.id };
            }
        } catch (error) {
            console.error('Error generating Excel:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new GoogleDriveService();
