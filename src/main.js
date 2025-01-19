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

async function formatTranscription(audioBuffer) {
    console.log('Starting formatTranscription...');
    
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    const activeWindow = await getActiveWindow();
    let formattingInstructions = "";

    if (activeWindow.toLowerCase().includes('slack')) {
        formattingInstructions = `
            Convert this transcription into a natural Slack message. Follow these rules:
            1. Use first-person perspective always - never third person
            2. Keep the conversational tone but remove filler words
            3. Use Slack's formatting:
               - *bold* for emphasis
               - _italic_ for subtle emphasis
               - \`code\` for technical terms
               - \`\`\`code blocks\`\`\` for multiple lines of code
               - > for quotes
            4. For lists:
               - Use numbers (1., 2., 3.) for sequential steps
               - Use bullets (•) for non-sequential items
            5. Never summarize or interpret - keep it as direct speech
            6. Never add phrases like "it seems" or "you're suggesting"
            7. Maintain the original speaker's intent and meaning
            
            Respond with only the formatted text, no explanations.
        `;
    } else {
        formattingInstructions = `
            Convert this transcription into natural written text. Follow these rules:
            1. Use first-person perspective always - never third person
            2. Keep the conversational tone but remove filler words
            3. Use basic markdown only when necessary
            4. Never summarize or interpret - keep it as direct speech
            5. Never add phrases like "it seems" or "you're suggesting"
            6. Maintain the original speaker's intent and meaning
            
            Respond with only the formatted text, no explanations.
        `;
    }

    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            {
                role: "system",
                content: formattingInstructions
            },
            {
                role: "user",
                content: audioBuffer
            }
        ],
        temperature: 0.3,
    });

    return response;
}

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
        const formattedResponse = await formatTranscription(transcription);

        // Clean up the temp file
        fs.unlinkSync(tempPath);
        
        // Return the formatted text
        const formattedText = formattedResponse.choices[0].message.content;
        console.log('Transcription formatted successfully');
        
        const activeWindow = await getActiveWindow();
        console.log('Ready to inject text into:', activeWindow);
        
        if (activeWindow) {  // If we have any active window
            // Copy to clipboard
            console.log('Copying to clipboard:', formattedText);
            const clipboard = require('electron').clipboard;
            clipboard.writeText(formattedText);
            
            // Verify clipboard content
            const clipboardText = clipboard.readText();
            console.log('Clipboard content:', clipboardText);
            
            // Small delay to ensure clipboard is ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Simulate CMD+V using applescript
            exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, (error) => {
                if (error) {
                    console.error('Failed to paste:', error);
                } else {
                    console.log('Text pasted successfully into:', activeWindow);
                }
            });
        } else {
            console.log('No active window detected');
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