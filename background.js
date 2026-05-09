let isRunning = false;
let currentStatus = 'disconnected';
let currentError = null;
let currentConfig = null;
let transcriptLog = [];
let sessionStartTime = null;

// Recover session log from storage if background worker restarted
chrome.storage.local.get(['transcriptLog', 'sessionStartTime'], (res) => {
    if (res.transcriptLog) transcriptLog = res.transcriptLog;
    if (res.sessionStartTime) sessionStartTime = res.sessionStartTime;
});

let autoStopTimer = null;

function resetAutoStopTimer() {
    if (autoStopTimer) clearTimeout(autoStopTimer);
    if (!isRunning) return;
    
    const stopMins = (currentConfig && currentConfig.autoStopTimer !== undefined) ? currentConfig.autoStopTimer : 5;
    if (stopMins > 0) {
        const delay = stopMins * 60 * 1000;
        autoStopTimer = setTimeout(() => {
            console.log(`[Background] Auto-stopping due to inactivity (${stopMins} mins).`);
            stopRecording().catch(console.error);
        }, delay);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        startRecording(message.config).catch(err => {
            console.error(err);
            updateStatus(false, 'error', err.toString());
        });
        resetAutoStopTimer();
        sendResponse({ success: true });
        return true;
    } 
    
    if (message.type === 'STOP_RECORDING') {
        stopRecording().catch(console.error);
        if (autoStopTimer) clearTimeout(autoStopTimer);
        sendResponse({ success: true });
        return true;
    }

    if (message.type === 'GET_STATUS') {
        sendResponse({ isRunning, status: currentStatus, error: currentError });
        return true;
    }

    if (message.type === 'GET_TRANSCRIPT') {
        sendResponse({ log: transcriptLog, startTime: sessionStartTime });
        return true;
    }

    if (message.type === 'CLEAR_TRANSCRIPT') {
        transcriptLog = [];
        chrome.storage.local.set({ transcriptLog: [] });
        sendResponse({ success: true });
        return true;
    }

    if (message.type === 'GET_SESSIONS') {
        chrome.storage.local.get(['sessionHistory'], (res) => {
            sendResponse({ sessions: res.sessionHistory || [] });
        });
        return true;
    }

    if (message.type === 'DELETE_SESSION') {
        chrome.storage.local.get(['sessionHistory'], (res) => {
            let sessions = res.sessionHistory || [];
            sessions = sessions.filter(s => s.startTime !== message.startTime);
            chrome.storage.local.set({ sessionHistory: sessions });
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'SONIOX_STATUS') {
        updateStatus(isRunning, message.status, message.error);
    }

    if (message.type === 'TRANSCRIPT') {
        resetAutoStopTimer();
        
        if (message.isFinal && message.text && message.text.trim()) {
            const text = message.text.trim();
            const speaker = message.speaker !== undefined ? message.speaker : 0;

            if (!message.isTranslation) {
                transcriptLog.push({ original: text, translation: '', speaker });
                chrome.storage.local.set({ transcriptLog });
            } else {
                let found = false;
                for (let i = transcriptLog.length - 1; i >= 0; i--) {
                    if (typeof transcriptLog[i] === 'object' && transcriptLog[i].translation === '') {
                        transcriptLog[i].translation = text;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    transcriptLog.push({ original: '', translation: text, speaker });
                }
                chrome.storage.local.set({ transcriptLog });
            }
        }

        // Relay transcript tokens to the active tab's content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
            }
        });

        // TTS Reading
        if (message.isTranslation && message.isFinal && currentConfig?.ttsEngine && currentConfig.ttsEngine !== 'none') {
            chrome.runtime.sendMessage({
                type: 'PLAY_TTS',
                text: message.text,
                lang: currentConfig.targetLanguage,
                config: currentConfig,
                speaker: message.speaker
            });
        }
    }
});

async function startRecording(config) {
    currentConfig = config;

    // Archive previous session before starting new one
    if (transcriptLog.length > 0 && sessionStartTime) {
        archiveCurrentSession();
    }

    transcriptLog = [];  // Reset log for new session
    sessionStartTime = new Date().toISOString();
    chrome.storage.local.set({ transcriptLog, sessionStartTime });
    updateStatus(true, 'connecting', null);
    await setupOffscreenDocument();

    let streamId = null;

    if (config.audioSource === 'system') {
        // Tab capture
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error('No active tab found to capture.');
        }

        // Get stream ID for the active tab to pass to offscreen
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }

    // Tell offscreen to start processing
    chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START',
        streamId: streamId, // if null, offscreen should use regular mic
        config: config
    });
}

async function stopRecording() {
    // Archive session when stopping
    if (transcriptLog.length > 0 && sessionStartTime) {
        archiveCurrentSession();
    }

    updateStatus(false, 'disconnected', null);
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
    await closeOffscreenDocument();
}

function archiveCurrentSession() {
    chrome.storage.local.get(['sessionHistory'], (res) => {
        let sessions = res.sessionHistory || [];
        sessions.unshift({
            startTime: sessionStartTime,
            log: [...transcriptLog]
        });
        // Keep at most 20 sessions
        if (sessions.length > 20) sessions = sessions.slice(0, 20);
        chrome.storage.local.set({ sessionHistory: sessions });
    });
}

function updateStatus(running, status, error) {
    isRunning = running;
    currentStatus = status;
    currentError = error;
    chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        isRunning,
        status,
        error
    });
}

// --- Offscreen Document Management ---
const OFFSCREEN_PATH = 'offscreen/offscreen.html';

async function setupOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Recording audio & translating with playback'
    });
}

async function closeOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
    }
}
