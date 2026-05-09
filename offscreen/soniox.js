// Adapted from my-translator for Chrome Extension (no export, attached to window)

const SONIOX_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;
const SESSION_DURATION_MS = 3 * 60 * 1000;
const CONTEXT_HISTORY_CHARS = 500;
const KEEPALIVE_INTERVAL_MS = 15000;

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
        this._reconnectAttempts = 0;
        this._recentTranslations = [];

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
                try {
                    if (oldWs.readyState === WebSocket.OPEN) {
                        oldWs.send(new ArrayBuffer(0)); 
                    }
                    oldWs._isOld = true; 
                    oldWs.close(1000, 'Session reset');
                } catch (e) {}
            }

            this.ws = newWs;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            
            this._startSessionTimer();
            this._startKeepalive();
        };

        newWs.onmessage = (event) => {
            if (newWs._isOld) return;

            try {
                const data = JSON.parse(event.data);
                if (data.error_code) {
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

            if (event.code === 1000) {
                this._setStatus('disconnected');
            } else if (event.code === 4001 || event.code === 4003) {
                this._setStatus('error');
                this.onError?.('Invalid API key.');
            } else {
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
        this._setStatus('disconnected');
    }

    _handleResponse(data) {
        if (!data.tokens || data.tokens.length === 0) return;

        let originalText = '';
        let translationText = '';
        let provisionalText = '';
        let hasEnd = false;
        let mainSpeaker = 0;

        for (const token of data.tokens) {
            if (token.speaker !== undefined) {
                mainSpeaker = token.speaker;
            }

            if (token.text === '<end>') {
                hasEnd = true;
                continue;
            }

            if (!token.translation_status || token.translation_status === 'original' || token.translation_status === 'none') {
                if (token.is_final) {
                    originalText += token.text;
                } else {
                    provisionalText += token.text;
                }
            } else if (token.translation_status === 'translation') {
                if (token.is_final) {
                    translationText += token.text;
                }
            }
        }

        if (originalText.trim()) {
            this.onOriginal?.(originalText, mainSpeaker);
        }
        if (translationText.trim()) {
            this.onTranslation?.(translationText, mainSpeaker);
            this._addToHistory(translationText);
        }
        if (provisionalText.trim()) {
            this.onProvisional?.(provisionalText, mainSpeaker);
        } else if (originalText.trim() || translationText.trim() || hasEnd) {
            this.onProvisional?.('', mainSpeaker);
        }
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
