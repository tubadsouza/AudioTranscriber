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
            }, 50);
        }
    });
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

ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
    try {
        console.log('\n--- Starting Transcription Process ---');
        console.log('Audio buffer size:', audioBuffer.byteLength);
        
        const openaiClient = initializeOpenAI();
        const tempPath = path.join(app.getPath('userData'), `audio-${Date.now()}.wav`);
        
        const buffer = Buffer.from(audioBuffer);
        fs.writeFileSync(tempPath, buffer);
        
        // First, get the transcription
        const transcription = await openaiClient.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-1",
            response_format: "text"
        });
        
        // Then, format it using ChatGPT
        const formattedResponse = await openaiClient.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that formats text into clean markdown. Keep the original meaning but improve formatting, add headers where appropriate, and fix any obvious transcription errors."
                },
                {
                    role: "user",
                    content: transcription
                }
            ],
            temperature: 0.7
        });

        // Clean up the temp file
        fs.unlinkSync(tempPath);
        
        // Return the formatted text
        const formattedText = formattedResponse.choices[0].message.content;
        console.log('Transcription formatted successfully');
        
        // Get the active window right when transcription is ready
        const activeWindow = await getActiveWindow();
        console.log('Ready to inject text into:', activeWindow);
        
        // Prepare the text injection
        if (activeWindow) {
            console.log('Text to inject:', formattedText);
            // We'll add the actual injection code in the next step
        }
        
        return formattedText;

    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
});

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

app.on('before-quit', () => {
    forceQuit = true;
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
    }
});

// Add this IPC handler if it's not already there
ipcMain.on('request-accessibility-status', (event) => {
    const isAccessibilityEnabled = checkAccessibilityPermissions();
    event.sender.send('accessibility-status', isAccessibilityEnabled);
}); 