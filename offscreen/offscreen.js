let audioCtx = null;
let playbackCtx = null;
let mediaStream = null;
let scriptProcessor = null;
let audioSource = null;

let ttsQueue = [];
let isPlayingTts = false;
let currentAudio = null;
let currentTtsItem = null;

// Non-fatal problems (one failed translation or TTS request) are shown in the
// popup without flipping the session status to "error"
function sendWarning(error) {
    chrome.runtime.sendMessage({ type: 'RUNTIME_WARNING', error }).catch(() => {});
}

// Play an audio URL for a queue item, unless that item was superseded
// (queue flushed / session stopped) while its audio was being fetched
function playTtsAudio(item, url, rate, revoke) {
    if (item !== currentTtsItem) {
        if (revoke) URL.revokeObjectURL(url);
        return;
    }
    const audio = new Audio(url);
    currentAudio = audio;
    audio.playbackRate = rate;
    const done = () => {
        if (revoke) URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (item === currentTtsItem) playNextTts();
    };
    audio.onended = done;
    audio.onerror = (e) => { console.error("TTS Audio error", e); done(); };
    audio.play().catch(e => {
        console.error("TTS Audio play blocked or failed", e);
        done();
    });
}

function ttsFailed(item, message) {
    console.error(message);
    if (item !== currentTtsItem) return;
    sendWarning(message);
    playNextTts();
}

function playNextTts() {
    if (ttsQueue.length === 0) {
        isPlayingTts = false;
        currentTtsItem = null;
        return;
    }
    isPlayingTts = true;
    const item = ttsQueue.shift();
    currentTtsItem = item;
    const { text, lang, ttsEngine, googleTtsKey, googleTtsVoice, elevenlabsApiKey, elevenlabsVoiceId } = item;
    // Comma-separated voices map to speakers (S1 -> first voice, S2 -> second...)
    const pickVoice = (list) => {
        const voices = (list || '').split(',').map(v => v.trim()).filter(v => v);
        return voices.length ? voices[(item.speaker || 0) % voices.length] : undefined;
    };

    if (ttsEngine === 'openai_compat' && item.openaiTtsBaseUrl) {
        window.openaiCompatSpeech({
            baseUrl: item.openaiTtsBaseUrl,
            apiKey: item.openaiTtsApiKey,
            model: item.openaiTtsModel,
            voice: pickVoice(item.openaiTtsVoice),
            text: text
        }).then(blob => {
            playTtsAudio(item, URL.createObjectURL(blob), parseFloat(item.openaiTtsSpeed) || 1.2, true);
        }).catch(e => ttsFailed(item, e.message));
    } else if (ttsEngine === 'elevenlabs' && elevenlabsApiKey && elevenlabsVoiceId) {
        fetch(`https://api.elevenlabs.io/v1/text-to-speech/${pickVoice(elevenlabsVoiceId)}?output_format=mp3_44100_128`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsApiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_multilingual_v2"
            })
        }).then(res => {
            if (!res.ok) throw new Error("ElevenLabs API Error: " + res.status + " " + res.statusText);
            return res.blob();
        }).then(blob => {
            playTtsAudio(item, URL.createObjectURL(blob), 1.2, true); // Speed up ElevenLabs slightly
        }).catch(e => ttsFailed(item, e.message));
    } else if (ttsEngine === 'google_cloud' && googleTtsKey) {
        // Use Google Cloud TTS REST API for Premium Voices
        fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleTtsKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: {
                    languageCode: googleTtsVoice ? googleTtsVoice.substring(0, 5) : 'vi-VN',
                    name: googleTtsVoice || 'vi-VN-Standard-A',
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.5,
                },
            }),
        }).then(res => res.json()).then(data => {
            if (!data.audioContent) throw new Error("Google TTS API Error: " + (data.error ? data.error.message : 'no audio'));
            playTtsAudio(item, `data:audio/mp3;base64,${data.audioContent}`, 1.1, false);
        }).catch(e => ttsFailed(item, e.message));
    } else if (ttsEngine === 'google_free' || ttsEngine === 'true') {
        // Free Google Translate's unofficial API (limited to ~200 chars per request)
        const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${lang}&client=gtx&q=${encodeURIComponent(text.slice(0, 200))}`;
        playTtsAudio(item, url, 1.5, false);
    } else {
        // Disabled or invalid
        playNextTts();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OFFSCREEN_START') {
        startProcessing(message.config, message.streamId).catch(err => {
            // e.g. microphone permission denied: tear down and let background stop the session
            stopProcessing();
            chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: err.toString(), fatal: true });
        });
    } else if (message.type === 'OFFSCREEN_STOP') {
        stopProcessing();
    } else if (message.type === 'PLAY_TTS') {
        // Clean text to avoid TTS engine explicitly reading punctuation marks (like "dấu gạch ngang")
        let cleanText = message.text || '';
        // Replace question marks/exclamations with periods to keep the speech pause but remove inflection reading
        cleanText = cleanText.replace(/[?!;:]/g, '.');
        // Strip dashes, brackets, quotes, and symbols completely
        cleanText = cleanText.replace(/[-—–_*/\\(){}\[\]<>+$#@~`^|""'“”‘’=]/g, ' ');
        // Deduplicate spaces and periods
        cleanText = cleanText.replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim();

        if (!cleanText) return;

        // Giới hạn hàng đợi: Nếu đang có quá nhiều câu chưa đọc, xóa bớt câu cũ để bắt kịp realtime
        // Hoặc nếu TTS đang tụt hậu quá xa, ngắt luôn câu hiện tại
        if (ttsQueue.length >= 1) {
            ttsQueue = []; // Chỉ giữ lại câu mới nhất
            // Drop the sentence being played or fetched; a pending fetch is ignored when it resolves
            if (currentAudio) currentAudio.pause();
            currentAudio = null;
            isPlayingTts = false;
            currentTtsItem = null;
        }

        ttsQueue.push({ 
            text: cleanText, 
            lang: message.lang, 
            ttsEngine: message.config.ttsEngine,
            googleTtsKey: message.config.googleTtsKey, 
            googleTtsVoice: message.config.googleTtsVoice,
            elevenlabsApiKey: message.config.elevenlabsApiKey,
            elevenlabsVoiceId: message.config.elevenlabsVoiceId,
            openaiTtsBaseUrl: message.config.openaiTtsBaseUrl,
            openaiTtsApiKey: message.config.openaiTtsApiKey,
            openaiTtsModel: message.config.openaiTtsModel,
            openaiTtsVoice: message.config.openaiTtsVoice,
            openaiTtsSpeed: message.config.openaiTtsSpeed,
            speaker: message.speaker
        });
        if (!isPlayingTts) {
            playNextTts();
        }
    }
});

const LLM_HISTORY_SIZE = 4;
let llmHistory = [];
let llmChain = Promise.resolve();
let llmSession = 0;

async function startProcessing(config, streamId) {
    if (audioCtx) stopProcessing();
    llmHistory = [];
    llmChain = Promise.resolve();
    llmSession++;

    // Prepare Custom Vocabulary Rules
    const customVocabularyRules = [];
    if (config.customVocabulary) {
        const lines = config.customVocabulary.split('\n');
        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length === 2) {
                const targetWord = parts[0].trim();
                const replacement = parts[1].trim();
                if (targetWord && replacement) {
                    // Case-insensitive literal match on whole words; the boundaries are
                    // Unicode-aware so Vietnamese letters with diacritics count as word chars
                    try {
                        const escaped = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        customVocabularyRules.push({
                            regex: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
                            replacement: replacement
                        });
                    } catch (e) { console.error("Invalid vocabulary regex", e); }
                }
            }
        }
    }

    // Helper function to apply custom vocabulary
    function applyCustomVocabulary(text) {
        let finalStr = text;
        for (const rule of customVocabularyRules) {
            finalStr = finalStr.replace(rule.regex, rule.replacement);
        }
        return finalStr;
    }

    // Setup Soniox Callbacks
    window.sonioxClient.onOriginal = async (text, speaker) => {
        chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text, isTranslation: false, isFinal: true, speaker });
        
        // If Google Translation is enabled, do translation here
        if (config.translationEngine === 'google' && config.googleTranslationKey && text.trim().length > 0) {
            try {
                // Determine source language if not auto
                const source = (config.sourceLanguage && config.sourceLanguage !== 'auto') ? config.sourceLanguage : '';
                
                // Use robust URLSearchParams for POST body to avoid JSON parsing strictness from old v2 API endpoints
                const params = new URLSearchParams();
                params.append('q', text);
                params.append('target', config.targetLanguage);
                params.append('format', 'text');
                if (source) params.append('source', source);

                const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${config.googleTranslationKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                
                const data = await response.json();
                
                if (data.data && data.data.translations && data.data.translations.length > 0) {
                    const translatedText = data.data.translations[0].translatedText;
                    
                    // Decode HTML entities that Google Translate returns
                    let decodedText = translatedText.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                                                     .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

                    decodedText = applyCustomVocabulary(decodedText);

                    chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: decodedText, isTranslation: true, isFinal: true, speaker });
                } else if (data.error) {
                    console.error("Google Translation API Error:", data.error.message);
                    sendWarning("Google Translate Error: " + data.error.message);
                } else {
                    sendWarning("Unknown Google API Error");
                }
            } catch (err) {
                console.error("Google Translation fetch error:", err);
                sendWarning("Google API Fetch failed (CORS/Network): " + err.message);
            }
        }

        // If DeepL API Translation is enabled, do translation here
        if (config.translationEngine === 'deepl' && config.deeplApiKey && text.trim().length > 0) {
            try {
                // Determine the correct DeepL endpoint based on the key type
                const isFree = config.deeplApiKey.endsWith(':fx');
                const baseUrl = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
                
                const params = new URLSearchParams();
                params.append('text', text);
                
                // DeepL target_lang must be uppercase
                let targetLang = config.targetLanguage.toUpperCase();
                // DeepL differentiates EN-US/EN-GB. If mapping EN, default to EN-US
                if (targetLang === 'EN') targetLang = 'EN-US';
                params.append('target_lang', targetLang);
                
                if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
                    params.append('source_lang', config.sourceLanguage.toUpperCase());
                }

                const response = await fetch(`${baseUrl}/v2/translate`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `DeepL-Auth-Key ${config.deeplApiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded' 
                    },
                    body: params.toString()
                });
                
                const data = await response.json();
                
                if (data.translations && data.translations.length > 0) {
                    let translatedText = data.translations[0].text;
                    translatedText = applyCustomVocabulary(translatedText);
                    chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: translatedText, isTranslation: true, isFinal: true, speaker });
                } else if (data.message) {
                    console.error("DeepL API Error:", data.message);
                    sendWarning("DeepL API Error: " + data.message);
                } else {
                    sendWarning("Unknown DeepL API Error");
                }
            } catch (err) {
                console.error("DeepL fetch error:", err);
                sendWarning("DeepL API Fetch failed: " + err.message);
            }
        }

        // If Microsoft Translator API is enabled, do translation here
        if (config.translationEngine === 'microsoft' && config.microsoftApiKey && text.trim().length > 0) {
            try {
                const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
                url.searchParams.append('api-version', '3.0');
                url.searchParams.append('to', config.targetLanguage);
                if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
                    url.searchParams.append('from', config.sourceLanguage);
                }

                const headers = {
                    'Ocp-Apim-Subscription-Key': config.microsoftApiKey,
                    'Content-Type': 'application/json'
                };
                if (config.microsoftRegion) {
                    headers['Ocp-Apim-Subscription-Region'] = config.microsoftRegion;
                }

                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify([{ "Text": text }])
                });
                
                const data = await response.json();
                
                if (Array.isArray(data) && data.length > 0 && data[0].translations && data[0].translations.length > 0) {
                    let translatedText = data[0].translations[0].text;
                    translatedText = applyCustomVocabulary(translatedText);
                    chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: translatedText, isTranslation: true, isFinal: true, speaker });
                } else if (data.error) {
                    console.error("Microsoft Translator API Error:", data.error.message);
                    sendWarning("Microsoft API Error: " + data.error.message);
                } else {
                    sendWarning("Unknown Microsoft API Error");
                }
            } catch (err) {
                console.error("Microsoft fetch error:", err);
                sendWarning("Microsoft API Fetch failed: " + err.message);
            }
        }

        // If an OpenAI-compatible gateway (LLM) is the translation engine.
        // Requests are chained so translations arrive in speech order.
        if (config.translationEngine === 'openai_compat' && config.openaiChatBaseUrl && text.trim().length > 0) {
            const session = llmSession;
            llmChain = llmChain.then(async () => {
                if (session !== llmSession) return; // stopped/restarted meanwhile
                try {
                    let translatedText = await window.openaiCompatTranslate({
                        baseUrl: config.openaiChatBaseUrl,
                        apiKey: config.openaiChatApiKey,
                        model: config.openaiChatModel,
                        text,
                        sourceLanguage: config.sourceLanguage,
                        targetLanguage: config.targetLanguage,
                        history: llmHistory,
                        glossary: config.customVocabulary || ''
                    });
                    if (!translatedText || session !== llmSession) return;
                    translatedText = applyCustomVocabulary(translatedText);
                    llmHistory.push({ original: text, translation: translatedText });
                    if (llmHistory.length > LLM_HISTORY_SIZE) llmHistory.shift();
                    chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: translatedText, isTranslation: true, isFinal: true, speaker });
                } catch (err) {
                    console.error("Gateway translation error:", err);
                    sendWarning(err.message);
                }
            });
        }
    };
    window.sonioxClient.onTranslation = (text, speaker) => chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: applyCustomVocabulary(text), isTranslation: true, isFinal: true, speaker });
    // Provisional text is the source language, so the (source = target) vocabulary does not apply to it
    window.sonioxClient.onProvisional = (text, speaker) => chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text, isTranslation: false, isFinal: false, speaker });
    window.sonioxClient.onError = (err) => sendWarning(err);

    // Connect Soniox WebSocket
    window.sonioxClient.connect(config);

    // Get Media Stream
    let constraints;
    if (streamId) {
        // Tab capture using ID from background
        constraints = {
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        };
    } else {
        // Microphone capture
        constraints = { audio: true };
    }

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Setup Web Audio API at 16kHz for Soniox
    audioCtx = new AudioContext({ sampleRate: 16000 });
    audioSource = audioCtx.createMediaStreamSource(mediaStream);

    // Tab capture mutes the tab, so play it back for the user. Use a separate
    // context at the device's native rate: the 16kHz one would sound muffled
    if (streamId) {
        playbackCtx = new AudioContext();
        playbackCtx.createMediaStreamSource(mediaStream).connect(playbackCtx.destination);
    }

    // Process audio data (convert to Int16 PCM) using AudioWorklet for better performance
    try {
        await audioCtx.audioWorklet.addModule('audio-processor.js');
        scriptProcessor = new AudioWorkletNode(audioCtx, 'audio-processor');
        
        scriptProcessor.port.onmessage = (e) => {
            if (!window.sonioxClient || !window.sonioxClient.isConnected) return;
            // Send the received Int16 buffer directly to Soniox
            window.sonioxClient.sendAudio(e.data);
        };
        
        audioSource.connect(scriptProcessor);
        // Connect processor to destination to make sure it keeps running
        scriptProcessor.connect(audioCtx.destination);
    } catch (e) {
        console.error("AudioWorklet not supported or failed to load, falling back to ScriptProcessor", e);
        // Fallback to ScriptProcessorNode
        scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
            if (!window.sonioxClient || !window.sonioxClient.isConnected) return;
            
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                let s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            window.sonioxClient.sendAudio(int16.buffer);
        };
        audioSource.connect(scriptProcessor);
        scriptProcessor.connect(audioCtx.destination);
    }
}

function stopProcessing() {
    llmSession++;
    if (window.sonioxClient) {
        window.sonioxClient.disconnect();
    }
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (audioSource) {
        audioSource.disconnect();
        audioSource = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    if (playbackCtx) {
        playbackCtx.close();
        playbackCtx = null;
    }
    // Clean up TTS
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    ttsQueue = [];
    isPlayingTts = false;
    currentTtsItem = null;
}
