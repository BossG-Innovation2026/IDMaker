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
                    console.log('📥 Loading credentials from credentials.json');
                    credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                } else {
                    throw new Error('No Google Drive credentials found. Set OAuth or service-account env vars, or place credentials.json in server/');
                }
            }

            this.auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/drive']
            });

            this.drive = google.drive({ version: 'v3', auth: this.auth });
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
}

module.exports = new GoogleDriveService();
