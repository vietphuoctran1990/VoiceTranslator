// Adapted from my-translator for Chrome Extension (no export, attached to window)

const SONIOX_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;
const SESSION_DURATION_MS = 3 * 60 * 1000;
const CONTEXT_HISTORY_CHARS = 500;
const KEEPALIVE_INTERVAL_MS = 15000;
// Final tokens arrive a few words at a time; buffer them into whole utterances.
// Originals flush on Soniox's <end> token, translations shortly after their last token.
const ORIGINAL_IDLE_FLUSH_MS = 2500;
const TRANSLATION_IDLE_FLUSH_MS = 800;
const MAX_BUFFER_CHARS = 300;
const OLD_SOCKET_DRAIN_MS = 5000;

class SonioxClient {
    constructor() {
        this.ws = null;
        this.apiKey = '';
        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._config = null;
        this._intentionalDisconnect = false;
        this._sessionTimer = null;
        this._keepaliveTimer = null;
        this._recentTranslations = []; 
        this._buffers = { orig: { text: '', speaker: 0 }, trans: { text: '', speaker: 0 } };
        this._flushTimers = { orig: null, trans: null };
        this._lastProvisional = '';

        this.onOriginal = null;       
        this.onTranslation = null;    
        this.onProvisional = null;    
        this.onStatusChange = null;   
        this.onError = null;          
        this.onConfidence = null;     
    }

    connect(config) {
        const { apiKey } = config;
        this.apiKey = apiKey;
        this._config = config;
        this._intentionalDisconnect = false;
        this._fatalError = false;
        this._reconnectAttempts = 0;
        this._recentTranslations = [];
        this._clearBuffers();

        if (!apiKey) {
            this._setStatus('error');
            this.onError?.('API key is required.');
            return;
        }

        this._doConnect(config);
    }

    _doConnect(config, carryoverContext = null) {
        const { apiKey, sourceLanguage, targetLanguage } = config;

        this._setStatus('connecting');
        console.log('[Soniox] Connecting to', SONIOX_ENDPOINT);

        let newWs;
        try {
            newWs = new WebSocket(SONIOX_ENDPOINT);
        } catch (err) {
            this._setStatus('error');
            this.onError?.(`Failed to create WebSocket: ${err.message}`);
            return;
        }

        newWs.onopen = () => {
            const configMsg = {
                api_key: apiKey,
                model: 'stt-rt-v4',
                audio_format: 'pcm_s16le',
                sample_rate: 16000,
                num_channels: 1,
                enable_endpoint_detection: true,
                max_endpoint_delay_ms: 1000, // Reduced from 3000 to 1000 to force faster translation results
                enable_speaker_diarization: true,
                enable_language_identification: true,
            };

            if (sourceLanguage && sourceLanguage !== 'auto') {
                configMsg.language_hints = [sourceLanguage];
            }

            if (targetLanguage && config.translationEngine === 'soniox') {
                configMsg.translation = {
                    type: 'one_way',
                    target_language: targetLanguage,
                };
            }

            if (carryoverContext) {
                configMsg.context = { text: `Recent conversation: ${carryoverContext}` };
            }

            newWs.send(JSON.stringify(configMsg));

            const oldWs = this.ws;
            if (oldWs && oldWs !== newWs) {
                // Signal end-of-audio and let the old socket deliver its remaining
                // final tokens (the sentence in progress) before closing it
                oldWs._isOld = true;
                try {
                    if (oldWs.readyState === WebSocket.OPEN) {
                        oldWs.send(new ArrayBuffer(0));
                    }
                } catch (e) {}
                setTimeout(() => { try { oldWs.close(1000, 'Session reset'); } catch (e) {} }, OLD_SOCKET_DRAIN_MS);
            }

            this.ws = newWs;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            
            this._startSessionTimer();
            this._startKeepalive();
        };

        newWs.onmessage = (event) => {
            if (this._intentionalDisconnect) return;

            try {
                const data = JSON.parse(event.data);
                if (data.error_code) {
                    if (newWs._isOld) return;
                    this._handleApiError(data);
                    return;
                }
                this._handleResponse(data);
            } catch (err) {
                console.error('Failed to parse Soniox response:', err);
            }
        };

        newWs.onerror = (event) => {
            if (newWs._isOld) return;
            this.onError?.('WebSocket error occurred');
        };

        newWs.onclose = (event) => {
            if (newWs._isOld) return;
            this.isConnected = false;
            
            if (this.ws === newWs) this.ws = null;
            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }
            // The server already reported an API error (bad key, quota...); retrying won't help
            if (this._fatalError) return;

            if (event.code === 4001 || event.code === 4003) {
                this._setStatus('error');
                this.onError?.('Invalid API key.');
            } else {
                // Includes a normal (1000) close initiated by the server: we still
                // want to be listening, so reconnect
                this._tryReconnect(`Connection closed (code: ${event.code})`);
            }
        };
    }

    sendAudio(pcmData) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData);
        }
    }

    disconnect() {
        this._intentionalDisconnect = true;
        this._stopSessionTimer();
        this._stopKeepalive();

        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(new ArrayBuffer(0));
                }
                this.ws.close(1000, 'User disconnected');
            } catch (err) {}
            this.ws = null;
        }
        this.isConnected = false;
        this._clearBuffers();
        this._setStatus('disconnected');
    }

    _handleResponse(data) {
        if (!data.tokens || data.tokens.length === 0) return;

        let provisionalText = '';
        let provisionalSpeaker = null;
        let hasEnd = false;

        for (const token of data.tokens) {
            if (token.text === '<end>') {
                hasEnd = true;
                continue;
            }
            const speaker = this._normalizeSpeaker(token.speaker);

            if (token.translation_status === 'translation') {
                if (token.is_final) this._appendFinal('trans', token.text, speaker);
            } else if (token.is_final) {
                this._appendFinal('orig', token.text, speaker);
            } else {
                provisionalText += token.text;
                provisionalSpeaker = speaker;
            }
        }

        if (hasEnd) this._flush('orig');
        this._emitProvisional((this._buffers.orig.text + provisionalText).trim(), provisionalSpeaker ?? this._buffers.orig.speaker);
    }

    // Soniox numbers speakers from 1 (as strings in recent APIs); the UI uses 0-based indexes
    _normalizeSpeaker(raw) {
        if (raw === undefined || raw === null) return this._buffers.orig.speaker;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n - 1);
    }

    _appendFinal(kind, text, speaker) {
        const buf = this._buffers[kind];
        // A new speaker starts a new utterance
        if (buf.text.trim() && buf.speaker !== speaker && text.trim()) this._flush(kind);
        if (!buf.text) buf.speaker = speaker;
        buf.text += text;

        const trimmed = buf.text.trim();
        if (trimmed.length >= MAX_BUFFER_CHARS && /[.?!。！？]$/.test(trimmed)) {
            this._flush(kind);
            return;
        }
        clearTimeout(this._flushTimers[kind]);
        this._flushTimers[kind] = setTimeout(() => {
            this._flush(kind);
            if (kind === 'orig') this._emitProvisional('', buf.speaker);
        }, kind === 'orig' ? ORIGINAL_IDLE_FLUSH_MS : TRANSLATION_IDLE_FLUSH_MS);
    }

    _flush(kind) {
        clearTimeout(this._flushTimers[kind]);
        this._flushTimers[kind] = null;
        const buf = this._buffers[kind];
        const text = buf.text.trim();
        buf.text = '';
        if (!text) return;
        if (kind === 'orig') {
            this.onOriginal?.(text, buf.speaker);
        } else {
            this.onTranslation?.(text, buf.speaker);
            this._addToHistory(text);
        }
    }

    _emitProvisional(text, speaker) {
        if (text === this._lastProvisional) return;
        this._lastProvisional = text;
        this.onProvisional?.(text, speaker);
    }

    _clearBuffers() {
        for (const kind of ['orig', 'trans']) {
            clearTimeout(this._flushTimers[kind]);
            this._flushTimers[kind] = null;
            this._buffers[kind].text = '';
        }
        this._lastProvisional = '';
    }

    _startSessionTimer() {
        this._stopSessionTimer();
        this._sessionTimer = setTimeout(() => this._seamlessReset(), SESSION_DURATION_MS);
    }

    _stopSessionTimer() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer);
            this._sessionTimer = null;
        }
    }

    _seamlessReset() {
        if (!this._config || this._intentionalDisconnect) return;
        const carryover = this._recentTranslations.join(' ').trim();
        this._doConnect(this._config, carryover);
    }

    _startKeepalive() {
        this._stopKeepalive();
        this._keepaliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'keepalive' }));
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    _stopKeepalive() {
        if (this._keepaliveTimer) {
            clearInterval(this._keepaliveTimer);
            this._keepaliveTimer = null;
        }
    }

    _addToHistory(text) {
        this._recentTranslations.push(text);
        let total = this._recentTranslations.reduce((sum, t) => sum + t.length, 0);
        while (total > CONTEXT_HISTORY_CHARS && this._recentTranslations.length > 1) {
            const removed = this._recentTranslations.shift();
            total -= removed.length;
        }
    }

    _handleApiError(data) {
        this._fatalError = true;
        this._setStatus('error');
        this.onError?.(data.error_message || 'Unknown API error');
    }

    _tryReconnect(reason) {
        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`${reason}. Reconnect failed.`);
            return;
        }
        this._reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * this._reconnectAttempts;
        this._setStatus('connecting');
        setTimeout(() => {
            if (!this._intentionalDisconnect && this._config) {
                const carryover = this._recentTranslations.join(' ').trim();
                this._doConnect(this._config, carryover);
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
        chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: status });
    }
}

window.sonioxClient = new SonioxClient();
