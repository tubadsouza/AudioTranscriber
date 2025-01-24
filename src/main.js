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

// Add this IPC handler near the top with other IPC handlers
ipcMain.on('audio-data', async (event, audioBuffer) => {
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

// Add new IPC handler for audio chunks
ipcMain.on('audio-chunk', async (event, chunk) => {
    console.log('Received audio chunk:', chunk.length, 'bytes');
    audioChunks.push(chunk);
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
        throw error;
    }
}

async function formatTranscription(text) {
    console.log('Starting formatTranscription...');
    
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    const activeWindow = await getActiveWindow();
    let formattingInstructions = "";
    
    if (activeWindow.toLowerCase().includes('slack')) {
        formattingInstructions = `
            Convert this transcription into a natural Slack message. Follow these rules:

            1. Minimal Formatting:
               • Only use formatting when it adds real value
               • Don't add quote arrows (>) unless it's an actual quote
               • Only use *bold* for:
                 - Names of people
                 - Product names
                 - Company names
               • Only use \`code\` for:
                 - Technical terms
                 - File names
                 - Commands
               • Never format common words or phrases

            2. Message Structure:
               • Keep it conversational and natural
               • Use proper punctuation
               • Break long messages into shorter paragraphs
               • Format questions with proper question marks
               • Remove filler words (um, uh, like, you know)

            3. Critical Rules:
               • Never interpret or answer questions - only format what was said
               • Use first-person perspective always
               • Never add content that wasn't in the original
               • Never add quote arrows (>) unless quoting someone else
               • Keep the exact meaning and intent

            Example:
            Input: "um yeah so I was wondering if we did the engineering work for acme corp like was it more professional services?"
            Output: "Did we do the engineering work for *Acme Corp*? Was it more professional services?"

            Respond with only the formatted text, no explanations.
        `;
    } else {
        formattingInstructions = "Format this transcription: fix punctuation, remove filler words, maintain original meaning.";
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: formattingInstructions
                },
                {
                    role: "user",
                    content: text
                }
            ],
            temperature: 0.3,
        });

        return completion;
    } catch (error) {
        console.error('Error in ChatGPT formatting:', error);
        return { choices: [{ message: { content: text } }] };
    }
}

app.on('will-quit', () => {
    if (recordingTimeout) {
        clearInterval(recordingTimeout);
    }
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', (e) => {
    if (!forceQuit) {
        e.preventDefault();
    }
});

ipcMain.on('close-app', () => {
    console.log('Force quitting app...');
    forceQuit = true;
    
    // Clean up in the correct order
    try {
        // First unregister shortcuts
        globalShortcut.unregisterAll();
        
        // Then hide the window
        if (mainWindow) {
            mainWindow.hide();
        }
        
        // Destroy the tray icon
        if (tray) {
            tray.destroy();
            tray = null;
        }
        
        // Finally destroy the window and quit
        if (mainWindow) {
            mainWindow.destroy();
            mainWindow = null;
        }
        
        // Use process.nextTick to ensure clean quit
        process.nextTick(() => {
            app.quit();
        });
        
    } catch (error) {
        console.error('Error during cleanup:', error);
        // Force quit if there's an error
        process.exit(0);
    }
});

// Add IPC handlers first
ipcMain.on('request-accessibility-status', (event) => {
    const isAccessibilityEnabled = checkAccessibilityPermissions();
    event.sender.send('accessibility-status', isAccessibilityEnabled);
});

ipcMain.on('update-status-from-renderer', (event, data) => {
    if (statusBarWindow && !statusBarWindow.isDestroyed()) {
        statusBarWindow.webContents.send('update-status', data);
    }
}); 

// Then app event handlers
app.on('before-quit', () => {
    forceQuit = true;
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
    }
}); 