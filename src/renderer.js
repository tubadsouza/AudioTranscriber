const { ipcRenderer } = require('electron');
const { marked } = require('marked');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let keyInterval;

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

ipcRenderer.on('stop-recording', async () => {
    if (isRecording) {
        await stopRecording();
    }
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Got media stream:', stream.getAudioTracks()[0].label);
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm',
            audioBitsPerSecond: 128000
        });
        
        mediaRecorder.ondataavailable = (event) => {
            console.log('Data available event:', event.data.size, 'bytes');
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
                document.getElementById('transcription').innerHTML = marked.parse(transcription);
                // Show the copy button when we have text
                document.getElementById('copyText').classList.remove('hidden');
            } catch (error) {
                console.error('Transcription error:', error);
                document.getElementById('transcription').textContent = 'Error: ' + error.message;
            }
            
            audioChunks = [];
        };
        
        mediaRecorder.start();
        console.log('Started recording');
    } catch (error) {
        console.error('Error starting recording:', error);
    }
}

async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        console.log('Stopping recording...');
        mediaRecorder.stop();
        // Stop all tracks in the stream
        mediaRecorder.stream.getTracks().forEach(track => {
            track.stop();
        });
        
        const button = document.getElementById('startRecording');
        button.textContent = 'Start Recording';
        button.classList.remove('recording');
        isRecording = false;
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

// Key handling
document.addEventListener('keydown', async (event) => {
    // Only start if not already recording and all required keys are pressed
    if (!isRecording && event.key === ' ' && event.shiftKey && event.metaKey) {
        console.log('Starting recording from key press');
        await startRecording();
        document.getElementById('startRecording').textContent = 'Stop Recording';
        document.getElementById('startRecording').classList.add('recording');
        isRecording = true;
        
        // Start checking for key release
        keyInterval = setInterval(() => {
            // If any of the required keys are released, stop recording
            if (!event.shiftKey || !event.metaKey) {
                stopRecording();
                clearInterval(keyInterval);
            }
        }, 100);
    }
});

// When any key is released
document.addEventListener('keyup', async (event) => {
    // If we're recording and any of our keys were released, stop recording
    if (isRecording && (event.key === ' ' || event.key === 'Shift' || event.key === 'Meta')) {
        console.log('Stopping recording from key release');
        clearInterval(keyInterval);
        await stopRecording();
    }
});
