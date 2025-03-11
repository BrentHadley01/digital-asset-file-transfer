const express = require('express');
const multer = require('multer');
const ftp = require('basic-ftp');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
require('dotenv').config();

const app = express();

// Initialize Redis client with retry strategy
let redisClient;
let sessionStore;

async function initializeRedis() {
    try {
        redisClient = createClient({
            url: 'redis://redis:6379',  // Use Docker service name
            socket: {
                host: 'redis',  // Docker service name
                port: 6379,
                reconnectStrategy: (retries) => {
                    if (retries > 20) {
                        console.warn('Max retries reached, falling back to memory store');
                        return false;
                    }
                    return Math.min(retries * 100, 3000);
                }
            },
            legacyMode: false
        });

        redisClient.on('error', (err) => {
            console.warn('Redis error:', err);
        });

        // Add ready event handler
        redisClient.on('ready', () => {
            console.log('Redis client ready and connected');
        });

        await redisClient.connect();
        sessionStore = new RedisStore({ client: redisClient });
    } catch (err) {
        console.warn('Failed to connect to Redis, using memory store:', err);
        // Use memory store as fallback
        sessionStore = new session.MemoryStore();
    }

    // Configure sessions with the appropriate store
    app.use(session({
        store: sessionStore,
        secret: process.env.SESSION_SECRET || 'replace_with_a_strong_secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));
}

// Initialize Redis and start server
async function startServer() {
    await initializeRedis();

    // Set up multer storage
    const storage = multer.memoryStorage();
    const upload = multer({ storage: storage });

    app.use(express.static('public'));
    app.use(express.json());

    // /upload route now stores the files in req.session.uploadedFiles
    app.post('/upload', upload.array('images'), (req, res) => {
        try {
            console.log('Files received:', req.files.map(f => f.originalname));
            
            req.session.uploadedFiles = req.files.map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                originalName: file.originalname,
                buffer: file.buffer,
                mimetype: file.mimetype
            }));
            
            const response = {
                files: req.session.uploadedFiles.map(file => ({
                    id: file.id,
                    originalName: file.originalName
                }))
            };
            
            console.log('Sending response:', response);
            res.json(response);
        } catch (err) {
            console.error('Error in /upload:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/rename', async (req, res) => {
        try {
            const { files, prefix } = req.body;
            const sessionFiles = req.session.uploadedFiles || [];
            // Reorder sessionFiles based on client ordering using the unique id.
            const orderedFiles = [];
            files.forEach(f => {
                const found = sessionFiles.find(file => file.id === f.id);
                if (found) orderedFiles.push(found);
            });
            // Update originalName using the new prefix and ordered index.
            req.session.uploadedFiles = orderedFiles.map((file, index) => ({
                ...file,
                originalName: `${prefix}__${index + 1}${getFileExtension(file.originalName)}`
            }));
            
            res.json({ 
                success: true, 
                files: req.session.uploadedFiles.map(file => ({
                    id: file.id,
                    originalName: file.originalName
                }))
            });
        } catch (err) {
            console.error('Error in /rename:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/ftp-upload', async (req, res) => {
        const client = new ftp.Client(30000);
        try {
            client.ftp.verbose = true;
            console.log('Attempting FTP connection to remote server');
            
            await client.access({
                host: process.env.FTP_HOST,
                port: parseInt(process.env.FTP_PORT) || 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASSWORD,
                secure: process.env.FTP_SECURE === 'true',
                secureOptions: { 
                    rejectUnauthorized: false 
                }
            });

            console.log('FTP Connection successful');

            // Create remote directory with timestamp if needed
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const uploadDir = `uploads_${timestamp}`;
            
            try {
                await client.ensureDir(uploadDir);
                await client.cd(uploadDir);
            } catch (err) {
                console.log('Directory creation failed, using root directory');
            }

            const sessionFiles = req.session.uploadedFiles || [];
            for (const file of sessionFiles) {
                console.log(`Starting upload of: ${file.originalName}`);
                const fileBuffer = Buffer.from(file.buffer.data);
                const { Readable } = require('stream');
                const stream = new Readable({
                    read() {
                        this.push(fileBuffer);
                        this.push(null);
                    }
                });
                
                await client.uploadFrom(stream, file.originalName);
                console.log(`Completed upload of: ${file.originalName}`);
            }

            res.json({ 
                success: true,
                message: `Files uploaded to ${uploadDir || 'root directory'}`
            });
        } catch (err) {
            console.error('FTP Error:', err);
            res.status(500).json({ 
                error: err.message,
                details: {
                    code: err.code,
                    name: err.name
                }
            });
        } finally {
            client.close();
            console.log('FTP Connection closed');
        }
    });

    function getFileExtension(filename) {
        return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 1);
    }

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Session store type: ${sessionStore.constructor.name}`);
    });
}

// Start the server
startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
