require('dotenv').config();
const { app, ipcMain, Tray, BrowserWindow, nativeImage, globalShortcut, systemPreferences, Notification, shell } = require('electron');
const path = require('path');
const OpenAI = require('openai');
const os = require('os');
const fs = require('fs');

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
        console.log('Accessibility permission status:', isAccessibilityEnabled);

        // Send status to renderer
        if (mainWindow) {
            mainWindow.webContents.send('accessibility-status', isAccessibilityEnabled);
        }

        if (!isAccessibilityEnabled) {
            new Notification({ 
                title: 'Accessibility Permission Required',
                body: 'Please enable accessibility in System Settings > Privacy & Security > Privacy > Accessibility'
            }).show();
            
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        }
        
        return isAccessibilityEnabled;
    } catch (error) {
        console.error('Error checking accessibility permissions:', error);
        if (mainWindow) {
            mainWindow.webContents.send('accessibility-status', false);
        }
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
            }
        });

        mainWindow.loadFile(path.join(__dirname, 'index.html'));

        mainWindow.on('close', (event) => {
            if (!forceQuit) {
                event.preventDefault();
                mainWindow.hide();
            }
        });

        mainWindow.webContents.openDevTools();
    }
    return mainWindow;
}

function registerShortcuts() {
    console.log('Registering shortcuts...');
    globalShortcut.unregisterAll();

    const startSuccess = globalShortcut.register('CommandOrControl+Shift+R', () => {
        console.log('Start shortcut triggered!');
        if (mainWindow) {
            mainWindow.webContents.send('start-recording');
        }
    });

    const stopSuccess = globalShortcut.register('CommandOrControl+Shift+S', () => {
        console.log('Stop shortcut triggered!');
        if (mainWindow) {
            mainWindow.webContents.send('stop-recording');
        }
    });

    console.log('Shortcuts registered:', { start: startSuccess, stop: stopSuccess });
}

app.whenReady().then(() => {
    try {
        // Initial check
        let hasAccessibility = checkAccessibilityPermissions();
        console.log('Initial accessibility check:', hasAccessibility);

        // Recheck permissions when app is activated
        app.on('activate', () => {
            hasAccessibility = checkAccessibilityPermissions();
            console.log('Rechecked accessibility:', hasAccessibility);
        });

        const image = createTemplateImage();
        tray = new Tray(image);
        tray.setToolTip('Audio Transcriber');

        mainWindow = createWindow();
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
        console.log('Main Process: Received audio buffer size:', audioBuffer.byteLength, 'bytes');
        
        const openaiClient = initializeOpenAI();
        
        const buffer = Buffer.from(audioBuffer);
        const tempPath = path.join(os.tmpdir(), `audio-${Date.now()}.wav`);
        fs.writeFileSync(tempPath, buffer);
        
        console.log('Main Process: Temp file created at:', tempPath);
        console.log('Main Process: File size:', fs.statSync(tempPath).size, 'bytes');
        console.log('Main Process: Starting OpenAI transcription...');

        const transcription = await openaiClient.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-1",
            response_format: "text"
        });
        
        fs.unlinkSync(tempPath);
        
        console.log('\n=== Transcription Result ===');
        console.log(transcription);
        console.log('===========================\n');
        
        return transcription;
    } catch (error) {
        console.error('\n!!! Transcription Error !!!');
        console.error('Error details:', error);
        throw error;
    }
});

app.on('will-quit', () => {
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