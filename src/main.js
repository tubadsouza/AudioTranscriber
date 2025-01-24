require('dotenv').config();
const { app, ipcMain, Tray, BrowserWindow, nativeImage, globalShortcut, systemPreferences, Notification, shell, Menu, powerMonitor } = require('electron');
const path = require('path');
const OpenAI = require('openai');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

// Initialize OpenAI client
let openai = null;

function initializeOpenAI() {
    if (!openai) {
        console.log('Initializing OpenAI client...');
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return openai;
}

let tray = null;
let mainWindow = null;
let forceQuit = false;
let isRecording = false;
let shiftPressed = false;
let zPressed = false;
let recordingTimeout = null;
let statusBarWindow = null;
let audioChunks = [];
const CHUNK_BUFFER_SIZE = 3; // Process every 6 seconds (3 chunks of 2 seconds each)

function createTemplateImage() {
    const image = nativeImage.createEmpty();
    const size = { width: 16, height: 16 };
    const buffer = Buffer.alloc(size.width * size.height * 4);
    for (let i = 0; i < buffer.length; i += 4) {
        buffer[i] = 0;
        buffer[i + 1] = 0;
        buffer[i + 2] = 0;
        buffer[i + 3] = 255;
    }
    image.addRepresentation({
        width: size.width,
        height: size.height,
        buffer: buffer,
        scaleFactor: 1.0
    });
    image.setTemplateImage(true);
    return image;
}

function checkAccessibilityPermissions() {
    try {
        const isAccessibilityEnabled = systemPreferences.isTrustedAccessibilityClient(true);
        console.log('Checking accessibility permissions:', isAccessibilityEnabled);
        
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('accessibility-status', isAccessibilityEnabled);
        }

        if (!isAccessibilityEnabled) {
            new Notification({ 
                title: 'Accessibility Permission Required',
                body: 'Please enable accessibility in System Settings > Privacy & Security > Accessibility'
            }).show();
            
            // Open System Settings directly to accessibility
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        }
        
        return isAccessibilityEnabled;
    } catch (error) {
        console.error('Error checking accessibility permissions:', error);
        return false;
    }
}

function createWindow() {
    if (!mainWindow) {
        mainWindow = new BrowserWindow({
            width: 320,
            height: 450,
            show: false,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                devTools: true
            }
        });

        mainWindow.loadFile(path.join(__dirname, 'index.html'));

        // Enable right-click menu
        mainWindow.webContents.on('context-menu', (e, params) => {
            Menu.buildFromTemplate([
                { label: 'Inspect Element', click: () => mainWindow.webContents.inspectElement(params.x, params.y) },
                { type: 'separator' },
                { label: 'Toggle Developer Tools', click: () => mainWindow.webContents.toggleDevTools() }
            ]).popup();
        });

        mainWindow.webContents.on('did-finish-load', () => {
            const isAccessibilityEnabled = checkAccessibilityPermissions();
            mainWindow.webContents.send('accessibility-status', isAccessibilityEnabled);
        });

        mainWindow.on('close', (event) => {
            if (!forceQuit) {
                event.preventDefault();
                mainWindow.hide();
            }
        });
    }
    return mainWindow;
}

function createTray() {
    const image = createTemplateImage();
    tray = new Tray(image);
    tray.setToolTip('Audio Transcriber');
}

function getActiveWindow() {
    return new Promise((resolve) => {
        if (process.platform === 'darwin') {  // macOS
            exec('osascript -e "tell application \\"System Events\\" to get name of first application process whose frontmost is true"', (error, stdout) => {
                if (error) {
                    console.error('Error getting active window:', error);
                    resolve(null);
                } else {
                    console.log('Active application:', stdout.trim());
                    resolve(stdout.trim());
                }
            });
        }
    });
}

function registerShortcuts() {
    globalShortcut.register('Shift+Z', () => {
        if (!isRecording) {
            isRecording = true;
            console.log('Starting recording');
            if (!mainWindow) {
                createWindow();
            }
            mainWindow.webContents.send('start-recording');
            
            recordingTimeout = setInterval(async () => {
                const idleTime = powerMonitor.getSystemIdleTime();
                
                if (idleTime > 0 && isRecording) {
                    clearInterval(recordingTimeout);
                    isRecording = false;
                    console.log('Keys released - stopping recording');
                    
                    const activeApp = await getActiveWindow();
                    console.log('Recording stopped in application:', activeApp);
                    
                    if (mainWindow) {
                        mainWindow.webContents.send('stop-recording', { activeApp });
                    }
                }
            }, 200);
        }
    });
}

function createStatusBar() {
    if (statusBarWindow && !statusBarWindow.isDestroyed()) {
        return statusBarWindow;
    }

    statusBarWindow = new BrowserWindow({
        width: 200,
        height: 40,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false,
        type: 'panel',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    statusBarWindow.setPosition(Math.floor(width/2 - 100), primaryDisplay.workAreaSize.height - 60);

    statusBarWindow.loadFile(path.join(__dirname, 'statusbar.html'));
}

app.whenReady().then(() => {
    console.log('Testing key-sender...');
    try {
        // Just a simple test
        ks.setOption('startDelayMillis', 0);
        console.log('Key sender initialized');
    } catch (error) {
        console.error('Key sender error:', error);
    }
    console.log('Testing robotjs...');
    try {
        const mousePos = robot.getMousePos();
        console.log('Mouse position:', mousePos);
    } catch (error) {
        console.error('Robotjs error:', error);
    }
    try {
        // Initial check
        let hasAccessibility = checkAccessibilityPermissions();
        console.log('Initial accessibility check:', hasAccessibility);

        // Recheck permissions when app is activated
        app.on('activate', () => {
            hasAccessibility = checkAccessibilityPermissions();
            console.log('Rechecked accessibility:', hasAccessibility);
        });

        createTray();
        createWindow();
        createStatusBar();
        registerShortcuts();

        tray.on('click', (event, bounds) => {
            const { x, y } = bounds;
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.setPosition(x - 160, y);
                mainWindow.show();
            }
        });

    } catch (error) {
        console.error('Error during setup:', error);
    }
});

// Add function to process chunk buffer
async function processChunkBuffer() {
    try {
        console.log('Processing chunk buffer...');
        
        // Create temp file for combined chunks
        const tempFilePath = path.join(os.tmpdir(), `chunk-${Date.now()}.webm`);
        
        // Combine chunks and write directly as Buffer
        const combinedBuffer = Buffer.concat(audioChunks);
        await fs.promises.writeFile(tempFilePath, combinedBuffer);
        
        console.log(`Combined buffer size: ${combinedBuffer.length} bytes`);
        
        // Process with OpenAI
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        console.log('Transcribing chunk buffer...');
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: 'whisper-1',
            language: 'en',
            temperature: 0,
            response_format: 'json'
        });

        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        console.log('Chunk buffer transcription:', transcriptionResponse.text);
        
        // Clear processed chunks
        audioChunks = [];
        
        return transcriptionResponse.text;
    } catch (error) {
        console.error('Error processing chunk buffer:', error);
        // Don't clear chunks on error, so we can process them with the full recording
        return null;
    }
}

// Update the audio chunk handler
ipcMain.on('audio-chunk', async (event, chunk) => {
    try {
        console.log(`Received chunk: ${chunk.length} bytes`);
        audioChunks.push(chunk);
        
        // Log buffer status
        console.log(`Chunk buffer status: ${audioChunks.length}/${CHUNK_BUFFER_SIZE}`);
        
        // Process when buffer is full
        if (audioChunks.length >= CHUNK_BUFFER_SIZE) {
            console.log('Buffer full, processing chunks...');
            const transcribedText = await processChunkBuffer();
            
            if (transcribedText) {
                console.log('Chunk processing successful:', transcribedText);
                // For now, just log the result
                // Later we can implement progressive updates
            }
        }
    } catch (error) {
        console.error('Error handling audio chunk:', error);
    }
});

// Keep existing audio-data handler as fallback
ipcMain.on('audio-data', async (event, audioBuffer) => {
    // Clear any collected chunks when full recording is processed
    audioChunks = [];
    console.log('Received audio data in main process, size:', audioBuffer.length);
    try {
        await handleRecording(audioBuffer);
    } catch (error) {
        console.error('Error handling recording:', error);
        mainWindow.webContents.send('transcription-status', {
            message: 'Error processing audio',
            processing: false
        });
        
        setTimeout(() => {
            mainWindow.webContents.send('transcription-status', {
                message: 'Ready',
                processing: false
            });
        }, 2000);
    }
});

async function handleRecording(audioBuffer) {
    console.log('--- Starting Transcription Process ---');
    const startTime = Date.now();
    
    try {
        // Log the buffer size we're processing
        console.log('Processing audio buffer:', audioBuffer.length, 'bytes');
        
        // Initialize OpenAI and create temp file in parallel
        const [openai, tempFilePath] = await Promise.all([
            (async () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))(),
            (async () => {
                const filePath = path.join(os.tmpdir(), 'audio.wav');
                await fs.promises.writeFile(filePath, Buffer.from(audioBuffer));
                return filePath;
            })()
        ]);

        // Start transcription and get active window in parallel
        const transcriptionStartTime = Date.now();
        const [transcriptionResponse, activeWindow] = await Promise.all([
            openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: 'whisper-1'
            }),
            getActiveWindow()
        ]);

        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        const transcriptionTime = Date.now() - transcriptionStartTime;
        console.log(`Transcription completed in ${transcriptionTime}ms`);
        console.log('Got transcription:', transcriptionResponse.text);

        // Format text and prepare clipboard in parallel
        const formattingStartTime = Date.now();
        const [formattedResponse, _] = await Promise.all([
            formatTranscription(transcriptionResponse.text),
            (async () => {
                const clipboard = require('electron').clipboard;
                clipboard.writeText(transcriptionResponse.text); // Pre-load clipboard while formatting
            })()
        ]);

        const formattedText = formattedResponse.choices[0].message.content;
        const formattingTime = Date.now() - formattingStartTime;
        console.log(`Text formatting completed in ${formattingTime}ms`);

        // Paste operation
        const pasteStartTime = Date.now();
        if (activeWindow) {
            const clipboard = require('electron').clipboard;
            clipboard.writeText(formattedText);
            
            await new Promise((resolve) => {
                exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, () => {
                    console.log('Paste command completed');
                    resolve();
                });
            });
        }
        
        const pasteTime = Date.now() - pasteStartTime;
        console.log(`Paste operation completed in ${pasteTime}ms`);

        // Show success message
        if (statusBarWindow && !statusBarWindow.isDestroyed()) {
            statusBarWindow.webContents.send('update-status', {
                message: 'Text pasted successfully!',
                processing: false
            });
            
            setTimeout(() => {
                if (statusBarWindow && !statusBarWindow.isDestroyed()) {
                    statusBarWindow.webContents.send('update-status', {
                        message: 'Ready',
                        processing: false
                    });
                }
            }, 2000);
        }

        // Log timing summary
        const totalTime = Date.now() - startTime;
        console.log(`\nTotal processing times:
        Transcription: ${transcriptionTime}ms
        Formatting: ${formattingTime}ms
        Paste: ${pasteTime}ms
        Total: ${totalTime}ms`);

        return formattedText;
    } catch (error) {
        console.error('Error in handleRecording:', error);
        if (statusBarWindow && !statusBarWindow.isDestroyed()) {
            statusBarWindow.webContents.send('update-status', {
                message: 'Error occurred',
                processing: false
           