# Voice Transcription App

An Electron application that records voice, transcribes it using OpenAI's Whisper, formats it with ChatGPT, and pastes it into the active window.

## Key Components

### Status Bar Implementation
The status bar shows the current state of the application through a two-way IPC (Inter-Process Communication) system:

1. **Status Bar Window** (`statusbar.html`):
   - Floating window at bottom of screen
   - Shows current status message
   - Displays animation during processing

2. **IPC Communication Flow**:
   - Renderer process sends status updates to main process
   - Main process sends status updates to renderer process
   - Renderer process updates the status bar UI based on received updates


3. **Status Update Chain**:
   - Recording start: "Recording in progress..."
   - Recording stop: "Recording stopped"
   - Processing: "Processing recording..."
   - AI Processing: "Processing with AI..."
   - Pasting: "Pasting into [window]..."
   - Completion: "Text pasted successfully!" → "Ready"

### Text Formatting
The app uses two different formatting prompts based on the active window:

1. **Standard Format**:
   - Basic markdown formatting
   - Preserves natural speech
   - Removes filler words
   - Uses first-person perspective
   - Never adds interpretative phrases

2. **Slack Format**:
   - Uses Slack-specific markdown
   - Handles code blocks and quotes
   - Maintains conversational tone
   - Uses first-person perspective
   - Never adds interpretative phrases

### Key Implementation Notes

1. **Status Updates**: 
   - Status updates must be managed in both renderer.js (for recording) and main.js (for processing)
   - Two-way IPC communication ensures complete status chain
   - Status bar updates reflect actual process state

2. **Recording Process**:
   - 10-second auto-stop
   - Proper cleanup of media streams
   - Error handling with status updates

3. **Formatting Process**:
   - Two-step process: Whisper transcription → ChatGPT formatting
   - Context-aware formatting based on active window
   - Maintains first-person perspective

## Development Notes

### Making Changes to Status Bar
When modifying status updates:
1. Ensure both renderer and main processes can update status
2. Maintain the complete status chain
3. Handle errors with appropriate status updates
4. Reset to "Ready" state after completion

### Modifying Formatting
When updating text formatting:
1. Modify formatting instructions in main.js
2. Keep separate instructions for Slack vs standard format
3. Maintain first-person perspective rules
4. Avoid third-person or interpretative phrases

## Common Issues
1. Status updates stopping mid-chain: Check IPC communication
2. Missing status updates: Verify event listeners in both processes
3. Incomplete status flow: Ensure proper chaining of status updates
