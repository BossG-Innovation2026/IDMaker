const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1A9rgjX1F0bOIMLdLk2jCnIQL4nhdHA6m';

class GoogleDriveService {
    constructor() {
        this.auth = null;
        this.drive = null;
        this.folderCache = {};
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            const credentials = {
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

            this.auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/drive']
            });

            this.drive = google.drive({ version: 'v3', auth: this.auth });
            this.initialized = true;
            console.log('✓ Google Drive service initialized');
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
                spaces: 'drive'
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
                fields: 'id'
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
            const fileMetadata = {
                name: fileName,
                parents: [folderId]
            };

            const media = {
                mimeType: mimeType,
                body: fileBuffer
            };

            const file = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink'
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
            console.error('Error uploading student photo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new GoogleDriveService();
