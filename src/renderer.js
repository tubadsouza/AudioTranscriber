const { ipcRenderer } = require('electron');
const { marked } = require('marked');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

document.getElementById('closeButton').addEventListener('click', () => {
    ipcRenderer.send('close-app');
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('Requesting accessibility status...');
    ipcRenderer.send('request-accessibility-status');
});

// Update the accessibility status handler
ipcRenderer.on('accessibility-status', (event, isEnabled) => {
    console.log('Received accessibility status:', isEnabled);
    const statusEl = document.getElementById('accessibilityStatus');
    // Use HTML entity for checkmark
    const checkmark = isEnabled ? '&#x2713;' : '&#x2717;';
    statusEl.innerHTML = `Accessibility: ${isEnabled ? 'Enabled ' + checkmark : 'Disabled ' + checkmark}`;
    statusEl.style.color = isEnabled ? '#4CAF50' : '#ff4444';
});

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
                console.log('MediaRecorder stopped, chunks:', audioChunks.length);
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log('Audio blob size:', audioBlob.size);
                
                const arrayBuffer = await audioBlob.arrayBuffer();
                console.log('Array buffer size:', arrayBuffer.byteLength);
                
                try {
                    const transcription = await ipcRenderer.invoke('transcribe-audio', arrayBuffer);
                    // Convert markdown to HTML before displaying
                    document.getElementById('transcription').innerHTML = marked.parse(transcription);
                } catch (error) {
                    console.error('Transcription error:', error);
                    document.getElementById('transcription').textContent = 'Error: ' + error.message;
                }
                
                audioChunks = [];
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
