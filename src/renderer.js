const { ipcRenderer } = require('electron');
const { marked } = require('marked');

let mediaRecorder;
let isRecording = false;
let chunks = [];
let keyUpTimer = null;
const KEY_UP_DELAY = 300; // 300ms delay before stopping

document.getElementById('closeButton').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('Requesting accessibility status...');
    ipcRenderer.send('request-accessibility-status');
});

ipcRenderer.on('accessibility-status', (event, isEnabled) => {
    console.log('Received accessibility status:', isEnabled);
    const statusEl = document.getElementById('accessibilityStatus');
    const checkmark = isEnabled ? '&#x2713;' : '&#x2717;';
    statusEl.innerHTML = `Accessibility: ${isEnabled ? 'Enabled ' + checkmark : 'Disabled ' + checkmark}`;
    statusEl.style.color = isEnabled ? '#4CAF50' : '#ff4444';
});

ipcRenderer.on('start-recording', async () => {
    if (!isRecording) {
        await startRecording();
        document.getElementById('startRecording').textContent = 'Stop Recording';
        document.getElementById('startRecording').classList.add('recording');
        isRecording = true;
    }
});

ipcRenderer.on('stop-recording', (event, data) => {
    if (isRecording) {
        console.log('Stopping recording in app:', data?.activeApp);
        stopRecording(data?.activeApp);
    }
});

function updateStatus(message, processing = false) {
    console.log('Sending status update:', message);
    ipcRenderer.send('update-status-from-renderer', { message, processing });
}

// Add this listener for status updates from main process
ipcRenderer.on('transcription-status', (event, data) => {
    console.log('Received transcription status update:', data);
    updateStatus(data.message, data.processing);
});

function updateRecordButton(isRecording) {
    const recordButton = document.getElementById('recordButton');
    if (recordButton) {
        recordButton.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
        recordButton.classList.toggle('recording', isRecording);
    }
}

async function startRecording() {
    if (isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: true
        });
        
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (e) => {
            console.log('Data available event:', e.data.size, 'bytes');
            chunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            console.log('MediaRecorder stopped, chunks:', chunks.length);
            updateStatus('Processing recording...', true);
            
            const blob = new Blob(chunks, { type: 'audio/webm' });
            console.log('Audio blob size:', blob.size);
            
            const arrayBuffer = await blob.arrayBuffer();
            console.log('Array buffer size:', arrayBuffer.byteLength);
            
            updateStatus('Processing with AI...', true);
            ipcRenderer.send('audio-data', new Uint8Array(arrayBuffer));
            chunks = [];
            isRecording = false;
            updateRecordButton(false);
        };
        
        chunks = [];
        mediaRecorder.start(2000);  // Just adding 2-second chunks
        isRecording = true;
        updateRecordButton(true);
        updateStatus('Recording in progress...', true);
        console.log('Started recording with 2-second chunks');
        
    } catch (error) {
        console.error('Error starting recording:', error);
        updateStatus('Error starting recording', false);
        isRecording = false;
        updateRecordButton(false);
    }
}

function stopRecording() {
    console.log('Stop recording called, isRecording:', isRecording);
    if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
        updateStatus('Recording stopped', false);
        mediaRecorder.stop();
        
        // Clean up the media stream
        const tracks = mediaRecorder.stream.getTracks();
        tracks.forEach(track => track.stop());
        
        console.log('Recording stopped');
    }
}

document.getElementById('startRecording').addEventListener('click', async () => {
    const button = document.getElementById('startRecording');
    if (!isRecording) {
        await startRecording();
        button.textContent = 'Stop Recording';
        button.classList.add('recording');
        isRecording = true;
    } else {
        await stopRecording();
    }
});

// Add copy button functionality
document.getElementById('copyText').addEventListener('click', async () => {
    const text = document.getElementById('transcription').textContent;
    await navigator.clipboard.writeText(text);
    
    // Show success state
    const copyButton = document.getElementById('copyText');
    copyButton.classList.add('success');
    copyButton.textContent = 'Copied!';
    
    // Reset after 2 seconds
    setTimeout(() => {
        copyButton.classList.remove('success');
        copyButton.textContent = 'Copy Text';
    }, 2000);
});

mediaRecorder.addEventListener('stop', async () => {
    console.log('MediaRecorder stopped, processing audio...');
    const audioBlob = new Blob(chunks, { type: 'audio/wav' });
    console.log('Audio blob size:', audioBlob.size);
    
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        try {
            console.log('Converting audio to base64...');
            const base64Audio = reader.result;
            console.log('Sending to transcription service...');
            const response = await fetch('http://localhost:5000/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ audio: base64Audio }),
            });
            const data = await response.json();
            console.log('Received transcription:', data.text);
            
            // Update UI
            const transcriptionDiv = document.getElementById('transcription');
            transcriptionDiv.innerHTML = data.text;
            
            // Add this right after setting the transcription text
            console.log('Sending transcription to main process:', data.text);
            ipcRenderer.send('transcription-ready', {
                text: data.text,
                activeWindow: window.activeWindow || 'unknown'
            });
            console.log('Transcription sent to main process');
            
        } catch (error) {
            console.error('Error processing transcription:', error);
        }
    };
});

// Add listener for active window info from main process
ipcRenderer.on('active-window-update', (event, windowName) => {
    console.log('Active window updated:', windowName);
    window.activeWindow = windowName;
});

// Update the keyboard shortcut handler
ipcRenderer.on('shortcut-pressed', async (event, type) => {
    if (type === 'keydown') {
        if (!isRecording) {
            console.log('Starting recording');
            // Clear any pending stop timer
            if (keyUpTimer) {
                clearTimeout(keyUpTimer);
                keyUpTimer = null;
            }
            await startRecording();
        }
    } else if (type === 'keyup') {
        if (isRecording) {
            console.log('Key released, setting stop timer');
            // Set a timer before stopping
            keyUpTimer = setTimeout(() => {
                console.log('Stop timer expired, stopping recording');
                stopRecording();
            }, KEY_UP_DELAY);
        }
    }
});
