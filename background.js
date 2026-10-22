let isRunning = false;
let currentStatus = 'disconnected';
let currentError = null;
let currentConfig = null;
let targetTabId = null; // tab that gets the overlay (the captured tab in tab-audio mode)
let transcriptLog = [];
let sessionStartTime = null;

const AUTO_STOP_ALARM = 'auto-stop';

// MV3 service workers are killed after ~30s without events (e.g. a silent video),
// wiping module state. Session state lives in chrome.storage.session and is
// restored on every wake-up; handlers wait for `stateReady` before using it.
const stateReady = (async () => {
    const [local, session] = await Promise.all([
        chrome.storage.local.get(['transcriptLog', 'sessionStartTime']),
        chrome.storage.session.get(['isRunning', 'currentStatus', 'currentError', 'currentConfig', 'targetTabId'])
    ]);
    if (local.transcriptLog) transcriptLog = local.transcriptLog;
    if (local.sessionStartTime) sessionStartTime = local.sessionStartTime;
    if (session.isRunning) {
        // Only trust it if the offscreen document (which does the capture) is still alive
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (contexts.length > 0) {
            isRunning = true;
            currentStatus = session.currentStatus || 'connected';
            currentError = session.currentError || null;
            currentConfig = session.currentConfig || null;
            targetTabId = session.targetTabId ?? null;
        } else {
            chrome.storage.session.set({ isRunning: false, currentStatus: 'disconnected' });
        }
    }
})();

function persistState() {
    chrome.storage.session.set({ isRunning, currentStatus, currentError, currentConfig, targetTabId });
}

// Fire-and-forget message; nobody listening (popup closed) is not an error
function broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
}

function sendToTargetTab(message) {
    if (targetTabId === null) return;
    chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
}

// Auto-stop uses an alarm because setTimeout dies with the service worker.
// Re-arming on every transcript message is throttled.
let lastAlarmArm = 0;
function resetAutoStopTimer(force = false) {
    if (!isRunning) return;
    const now = Date.now();
    if (!force && now - lastAlarmArm < 10000) return;
    lastAlarmArm = now;

    const stopMins = (currentConfig && currentConfig.autoStopTimer !== undefined) ? currentConfig.autoStopTimer : 5;
    if (stopMins > 0) {
        chrome.alarms.create(AUTO_STOP_ALARM, { delayInMinutes: stopMins });
    } else {
        chrome.alarms.clear(AUTO_STOP_ALARM);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== AUTO_STOP_ALARM) return;
    await stateReady;
    if (!isRunning) return;
    console.log('[Background] Auto-stopping due to inactivity.');
    stopRecording().catch(console.error);
});

// Stop when the captured tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await stateReady;
    if (isRunning && tabId === targetTabId && currentConfig?.audioSource === 'system') {
        stopRecording().catch(console.error);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    stateReady.then(() => handleMessage(message, sendResponse));
    // Keep the channel open for the types that answer
    return ['START_RECORDING', 'STOP_RECORDING', 'GET_STATUS', 'GET_TRANSCRIPT', 'CLEAR_TRANSCRIPT',
        'GET_SESSIONS', 'DELETE_SESSION'].includes(message.type);
});

function handleMessage(message, sendResponse) {
    if (message.type === 'START_RECORDING') {
        startRecording(message.config).catch(err => {
            console.error(err);
            stopRecording(false).finally(() => updateStatus(false, 'error', err.message || err.toString()));
        });
        sendResponse({ success: true });
        return;
    }

    if (message.type === 'STOP_RECORDING') {
        stopRecording().catch(console.error);
        sendResponse({ success: true });
        return;
    }

    if (message.type === 'GET_STATUS') {
        sendResponse({ isRunning, status: currentStatus, error: currentError });
        return;
    }

    if (message.type === 'GET_TRANSCRIPT') {
        sendResponse({ log: transcriptLog, startTime: sessionStartTime });
        return;
    }

    if (message.type === 'CLEAR_TRANSCRIPT') {
        transcriptLog = [];
        chrome.storage.local.set({ transcriptLog: [] });
        sendResponse({ success: true });
        return;
    }

    if (message.type === 'GET_SESSIONS') {
        chrome.storage.local.get(['sessionHistory'], (res) => {
            sendResponse({ sessions: res.sessionHistory || [] });
        });
        return;
    }

    if (message.type === 'DELETE_SESSION') {
        chrome.storage.local.get(['sessionHistory'], (res) => {
            let sessions = res.sessionHistory || [];
            sessions = sessions.filter(s => s.startTime !== message.startTime);
            chrome.storage.local.set({ sessionHistory: sessions });
            sendResponse({ success: true });
        });
        return;
    }

    if (message.type === 'SONIOX_STATUS') {
        if (!isRunning) return; // late status from a session that was already stopped
        if (message.fatal) {
            // The offscreen pipeline could not start (e.g. microphone denied)
            stopRecording(false).finally(() => updateStatus(false, 'error', message.error));
            return;
        }
        // A fresh connection clears an old warning
        const error = message.error || (message.status === 'connected' ? null : currentError);
        updateStatus(isRunning, message.status, error);
        return;
    }

    if (message.type === 'RUNTIME_WARNING') {
        // Non-fatal (one translation/TTS request failed): show it, keep the status
        if (isRunning) updateStatus(isRunning, currentStatus, message.error);
        return;
    }

    if (message.type === 'TRANSCRIPT') {
        if (!isRunning) return;
        resetAutoStopTimer();

        if (message.isFinal && message.text && message.text.trim()) {
            const text = message.text.trim();
            const speaker = message.speaker !== undefined ? message.speaker : 0;

            if (!message.isTranslation) {
                transcriptLog.push({ original: text, translation: '', speaker });
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
            }
            chrome.storage.local.set({ transcriptLog }).catch(e => console.error('Saving transcript failed', e));
        }

        // Relay transcript tokens to the overlay in the target tab
        sendToTargetTab(message);

        // TTS Reading
        if (message.isTranslation && message.isFinal && currentConfig?.ttsEngine && currentConfig.ttsEngine !== 'none') {
            broadcast({
                type: 'PLAY_TTS',
                text: message.text,
                lang: currentConfig.targetLanguage,
                config: currentConfig,
                speaker: message.speaker
            });
        }
    }
}

// Inject the overlay script into tabs opened before the extension was
// installed/reloaded (declarative content scripts only reach new page loads)
async function ensureOverlayScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        return;
    } catch (e) {
        // No content script yet
    }
    try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/overlay.css'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content/wrapper.js'] });
    } catch (e) {
        // Pages like chrome:// or the Web Store can't be scripted
        console.warn('[Background] Could not inject overlay:', e.message);
    }
}

async function startRecording(config) {
    // Archive previous session before starting new one
    archiveCurrentSession();

    currentConfig = config;
    transcriptLog = [];  // Reset log for new session
    sessionStartTime = new Date().toISOString();
    chrome.storage.local.set({ transcriptLog, sessionStartTime });

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    targetTabId = tab ? tab.id : null;
    updateStatus(true, 'connecting', null);
    resetAutoStopTimer(true);

    let streamId = null;
    if (config.audioSource === 'system') {
        if (!tab) {
            throw new Error('No active tab found to capture.');
        }
        // Get stream ID for the active tab to pass to offscreen
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }

    if (targetTabId !== null) await ensureOverlayScript(targetTabId);
    await setupOffscreenDocument();

    // Tell offscreen to start processing
    broadcast({
        type: 'OFFSCREEN_START',
        streamId: streamId, // if null, offscreen should use regular mic
        config: config
    });
}

async function stopRecording(archive = true) {
    if (archive) archiveCurrentSession();
    chrome.alarms.clear(AUTO_STOP_ALARM);

    // Tell the overlay before updateStatus() forgets the target tab
    if (isRunning) sendToTargetTab({ type: 'STATUS_UPDATE', isRunning: false, status: 'disconnected' });
    updateStatus(false, 'disconnected', null);
    broadcast({ type: 'OFFSCREEN_STOP' });
    await closeOffscreenDocument();
}

// Saves the current log under its start time. Takes the snapshot synchronously
// (the caller may reset the log right after) and replaces an existing entry with
// the same start time, so stopping twice or stop-then-start never duplicates.
function archiveCurrentSession() {
    if (!transcriptLog.length || !sessionStartTime) return;
    const snapshot = { startTime: sessionStartTime, log: [...transcriptLog] };
    chrome.storage.local.get(['sessionHistory'], (res) => {
        let sessions = (res.sessionHistory || []).filter(s => s.startTime !== snapshot.startTime);
        sessions.unshift(snapshot);
        // Keep at most 20 sessions
        if (sessions.length > 20) sessions = sessions.slice(0, 20);
        chrome.storage.local.set({ sessionHistory: sessions }).catch(e => console.error('Saving session failed', e));
    });
}

function updateStatus(running, status, error) {
    isRunning = running;
    currentStatus = status;
    currentError = error;
    if (!running) {
        currentConfig = null;
        targetTabId = null;
    }
    persistState();
    broadcast({
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
