const { ipcRenderer } = require('electron');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function startRecording() {
    if (!isRecording) {
        try {
            console.log('Renderer: Starting recording...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000
                }
            });
            
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                console.log('Renderer: Audio data available:', event.data.size, 'bytes');
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                console.log('Renderer: Processing recording...');
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const buffer = await audioBlob.arrayBuffer();
                
                try {
                    const result = await ipcRenderer.invoke('transcribe-audio', buffer);
                    console.log('Renderer: Transcription received:', result);
                    
                    const transcriptionEl = document.getElementById('transcription');
                    if (transcriptionEl) {
                        transcriptionEl.textContent = result;
                    }
                } catch (error) {
                    console.error('Renderer: Transcription error:', error);
                }
            };

            mediaRecorder.start();
            isRecording = true;
            updateUI();
            console.log('Renderer: Recording started');
        } catch (error) {
            console.error('Renderer: Error starting recording:', error);
        }
    }
}

function stopRecording() {
    if (isRecording && mediaRecorder) {
        console.log('Renderer: Stopping recording...');
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        updateUI();
    }
}

// Listen for shortcut-triggered start recording
ipcRenderer.on('start-recording', () => {
    console.log('Renderer: Received start-recording command');
    startRecording();
});

// Listen for shortcut-triggered stop recording
ipcRenderer.on('stop-recording', () => {
    console.log('Renderer: Received stop-recording command');
    stopRecording();
});

// Update UI based on recording state
function updateUI() {
    const recordButton = document.getElementById('recordButton');
    if (recordButton) {
        recordButton.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
        recordButton.style.backgroundColor = isRecording ? '#ff4444' : '#4CAF50';
    }
}

// Initialize UI and button handlers
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    const recordButton = document.getElementById('recordButton');
    if (recordButton) {
        recordButton.addEventListener('click', () => {
            console.log('Button clicked!');
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }
    updateUI();

    // Add close button handler
    const closeButton = document.getElementById('closeButton');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            console.log('Close button clicked');
            ipcRenderer.send('close-app');
        });
    }
});

console.log('Renderer process setup complete');

ipcRenderer.on('accessibility-status', (event, isEnabled) => {
    const statusEl = document.getElementById('accessibilityStatus');
    if (statusEl) {
        statusEl.textContent = `Accessibility: ${isEnabled ? 'Enabled ✅' : 'Disabled ❌'}`;
        statusEl.style.color = isEnabled ? '#4CAF50' : '#ff4444';
    }
});
