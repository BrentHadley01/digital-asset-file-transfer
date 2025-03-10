const express = require('express');
const multer = require('multer');
const ftp = require('basic-ftp');
require('dotenv').config();

const app = express();
// Store files in memory instead of disk
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use(express.json());

// Keep track of uploaded files in memory
let uploadedFiles = [];

app.post('/upload', upload.array('images'), (req, res) => {
    console.log('Files received:', req.files.map(f => f.originalname));
    
    uploadedFiles = req.files.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        originalName: file.originalname,
        buffer: file.buffer,
        mimetype: file.mimetype
    }));
    
    const response = {
        files: uploadedFiles.map(file => ({
            id: file.id,
            originalName: file.originalName
        }))
    };
    
    console.log('Sending response:', response);
    res.json(response);
});

app.post('/rename', async (req, res) => {
    const { files, prefix } = req.body;
    // Reorder uploadedFiles based on client ordering using the unique id.
    const orderedFiles = [];
    files.forEach(f => {
        const found = uploadedFiles.find(file => file.id === f.id);
        if (found) orderedFiles.push(found);
    });
    // Update originalName using the new prefix and ordered index.
    uploadedFiles = orderedFiles.map((file, index) => ({
        ...file,
        originalName: `${prefix}__${index + 1}${getFileExtension(file.originalName)}`
    }));
    
    res.json({ 
        success: true, 
        files: uploadedFiles.map(file => ({
            id: file.id,
            originalName: file.originalName
        }))
    });
});

app.post('/ftp-upload', async (req, res) => {
    const client = new ftp.Client(30000);
    try {
        client.ftp.verbose = true;
        console.log('Attempting FTP connection');
        
        await client.access({
            host: process.env.FTP_HOST,
            port: 21,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: true,
            secureOptions: { rejectUnauthorized: false }
        });

        console.log('FTP Connection successful');

        for (const file of uploadedFiles) {
            console.log(`Starting upload of: ${file.originalName}`);
            // Create a readable stream from buffer
            const { Readable } = require('stream');
            const stream = new Readable();
            stream.push(file.buffer);
            stream.push(null);
            
            await client.uploadFrom(stream, file.originalName);
            console.log(`Completed upload of: ${file.originalName}`);
        }

        res.json({ success: true });
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
});
