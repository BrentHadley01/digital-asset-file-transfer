let uploadedFiles = [];

let draggedIndex = null;

function updateSelectedFilesText() {
    const input = document.getElementById('imageInput');
    const text = document.querySelector('.file-selected-text');
    if (input.files.length > 0) {
        text.textContent = `${input.files.length} file(s) selected`;
        text.style.display = 'block';
    } else {
        text.style.display = 'none';
    }
}

function createImagePreview(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

// New variables for smooth dragging
let ghostEl = null, currentDraggedIndex = null, dragTarget = null;
let offsetX = 0, offsetY = 0, newDropIndex = null;

// Add a variable for the placeholder element
let placeholderEl = null;

// Update displayImages() to attach "mousedown" instead of drag events
async function displayImages() {
    const container = document.getElementById('imageList');
    container.innerHTML = '';
    
    console.log('Files to display:', uploadedFiles);
    
    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const div = document.createElement('div');
        div.className = 'image-item';
        div.dataset.index = i;  // assign index
        
        // Add file number indicator
        const numberDiv = document.createElement('div');
        numberDiv.className = 'file-number';
        numberDiv.textContent = i + 1;
        div.appendChild(numberDiv);

        // Create image preview if it's an image file
        if (file.file && file.file.type.startsWith('image/')) {
            const imgPreview = await createImagePreview(file.file);
            div.innerHTML += `<img src="${imgPreview}" alt="${file.originalName}">`;
        }
        
        const displayName = file.originalName || file.name || `File ${i + 1}`;
        div.innerHTML += `<span>${displayName}</span>`;
        
        // Attach mousedown handler for smooth drag
        div.addEventListener('mousedown', handleMouseDown);
        
        container.appendChild(div);
    }
}

function handleMouseDown(e) {
    if (e.button !== 0) return;
    dragTarget = e.currentTarget;
    currentDraggedIndex = Number(dragTarget.dataset.index);
    const rect = dragTarget.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    // Create ghost element from the clicked element
    ghostEl = dragTarget.cloneNode(true);
    ghostEl.classList.add('dragging');
    ghostEl.style.width = `${rect.width}px`;
    ghostEl.style.height = `${rect.height}px`;
    ghostEl.style.position = 'fixed';
    ghostEl.style.left = `${rect.left}px`;
    ghostEl.style.top = `${rect.top}px`;
    ghostEl.style.margin = '0';
    ghostEl.style.zIndex = '9999';
    ghostEl.style.pointerEvents = 'none';
    // Instead of inserting a placeholder or removing the element,
    // simply set its opacity to 0 so its space remains intact.
    dragTarget.style.opacity = '0';
    document.body.appendChild(ghostEl);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
}

function handleMouseMove(e) {
    if (!ghostEl) return;
    // Update ghost position based on mouse
    const newX = e.clientX - offsetX;
    const newY = e.clientY - offsetY;
    ghostEl.style.left = newX + 'px';
    ghostEl.style.top = newY + 'px';
    
    // Compute ghost's center
    const ghostRect = ghostEl.getBoundingClientRect();
    const ghostCenter = { 
        x: ghostRect.left + ghostRect.width / 2, 
        y: ghostRect.top + ghostRect.height / 2 
    };
    
    const container = document.getElementById('imageList');
    // Filter out the dragged element from candidate selection.
    const items = Array.from(container.children).filter(item => item !== dragTarget);
    if (items.length === 0) {
        newDropIndex = 0;
        return;
    }
    // Find the candidate with the smallest distance to the ghost center
    let minDistance = Infinity;
    let candidateIndex = 0;
    items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const dist = Math.hypot(ghostCenter.x - center.x, ghostCenter.y - center.y);
        if (dist < minDistance) {
            minDistance = dist;
            candidateIndex = Number(item.dataset.index);
        }
    });
    newDropIndex = candidateIndex;
}

function handleMouseUp(e) {
    if (!ghostEl || !dragTarget) return;
    const container = document.getElementById('imageList');
    // Reinsert dragged element at computed index
    // Remove dragTarget from its current position
    container.removeChild(dragTarget);
    const items = Array.from(container.children);
    const refNode = items[newDropIndex] || null;
    container.insertBefore(dragTarget, refNode);
    
    // Update the uploadedFiles array to reflect new ordering
    const [movedItem] = uploadedFiles.splice(currentDraggedIndex, 1);
    uploadedFiles.splice(newDropIndex, 0, movedItem);
    
    // Update dataset indices for all items
    const allItems = container.querySelectorAll('.image-item');
    allItems.forEach((item, index) => {
        item.dataset.index = index;
        const numberDiv = item.querySelector('.file-number');
        if (numberDiv) {
            numberDiv.textContent = index + 1;
        }
    });
    
    // Clean up: remove ghost and restore dragged element opacity
    ghostEl.remove();
    ghostEl = null;
    dragTarget.style.opacity = '1';
    dragTarget = null;
    currentDraggedIndex = null;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
}

async function uploadFiles() {
    const input = document.getElementById('imageInput');
    const formData = new FormData();
    
    // Store file references for previews
    const fileObjects = Array.from(input.files).map(file => ({
        file,
        originalName: file.name
    }));
    
    for (const file of input.files) {
        formData.append('images', file);
    }

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (data.files && data.files.length > 0) {
            uploadedFiles = data.files.map((file, index) => ({
                ...file,
                file: fileObjects[index].file
            }));
            displayImages();
            updateSelectedFilesText();
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Error uploading files');
    }
}

async function renameFiles() {
    const prefix = document.getElementById('prefixInput').value;
    if (!prefix) {
        alert('Please enter a prefix for renaming');
        return;
    }

    const response = await fetch('/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: uploadedFiles, prefix })
    });
    const data = await response.json();
    if (data.success) {
        uploadedFiles = data.files;
        alert('Files renamed successfully');
    }
}

async function ftpTransfer() {
    try {
        const response = await fetch('/ftp-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: uploadedFiles })
        });
        const data = await response.json();
        if (data.success) {
            alert('Files transferred to FTP server successfully');
        } else {
            alert('Error transferring files: ' + data.error);
        }
    } catch (error) {
        console.error('FTP transfer error:', error);
        alert('Error during FTP transfer');
    }
}
