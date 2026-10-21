let audioCtx = null;
let mediaStream = null;
let scriptProcessor = null;
let audioSource = null;

let ttsQueue = [];
let isPlayingTts = false;
let currentAudio = null;
let currentTtsItem = null;

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
    if (ttsEngine === 'openai_compat' && item.openaiTtsBaseUrl) {
        // OpenAI-compatible gateway (/v1/audio/speech). Comma-separated voices map to speakers
        const voices = (item.openaiTtsVoice || '').split(',').map(v => v.trim()).filter(v => v);
        const speakerId = item.speaker || 0;
        const selectedVoice = voices.length ? voices[speakerId % voices.length] : undefined;

        window.openaiCompatSpeech({
            baseUrl: item.openaiTtsBaseUrl,
            apiKey: item.openaiTtsApiKey,
            model: item.openaiTtsModel,
            voice: selectedVoice,
            text: text
        }).then(blob => {
            // A newer sentence may have flushed the queue while we were waiting
            if (item !== currentTtsItem) return;
            const url = URL.createObjectURL(blob);
            currentAudio = new Audio(url);
            currentAudio.playbackRate = parseFloat(item.openaiTtsSpeed) || 1.2;
            currentAudio.onended = () => { URL.revokeObjectURL(url); playNextTts(); };
            currentAudio.onerror = () => { URL.revokeObjectURL(url); playNextTts(); };
            currentAudio.play().catch(e => {
                console.error("Gateway TTS Audio play blocked", e);
                playNextTts();
            });
        }).catch(e => {
            console.error("Gateway TTS Error", e);
            if (item !== currentTtsItem) return;
            chrome.runtime.sendMessage({ type: 'TTS_ERROR', error: e.message });
            playNextTts();
        });
    } else if (ttsEngine === 'elevenlabs' && elevenlabsApiKey && elevenlabsVoiceId) {
        // Split comma-separated voice IDs
        const voiceIds = elevenlabsVoiceId.split(',').map(v => v.trim()).filter(v => v);
        const speakerId = item.speaker || 0;
        const selectedVoiceId = voiceIds[speakerId % voiceIds.length] || voiceIds[0];

        fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?output_format=mp3_44100_128`, {
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
            if (!res.ok) throw new Error("ElevenLabs API Error: " + res.statusText);
            return res.blob();
        }).then(blob => {
            const url = URL.createObjectURL(blob);
            currentAudio = new Audio(url);
            currentAudio.playbackRate = 1.2; // Speed up ElevenLabs slightly
            currentAudio.onended = () => { URL.revokeObjectURL(url); playNextTts(); };
            currentAudio.onerror = () => { URL.revokeObjectURL(url); playNextTts(); };
            currentAudio.play().catch(e => {
                console.error("ElevenLabs Audio play blocked", e);
                playNextTts();
            });
        }).catch(e => {
            console.error("ElevenLabs Fetch Error", e);
            playNextTts();
        });
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
            if (data.audioContent) {
                const url = `data:audio/mp3;base64,${data.audioContent}`;
                currentAudio = new Audio(url);
                currentAudio.playbackRate = 1.1; // Minor speed up
                currentAudio.onended = () => playNextTts();
                currentAudio.onerror = () => playNextTts();
                currentAudio.play().catch(e => {
                    console.error("Audio blocked", e);
                    playNextTts();
                });
            } else {
                if (data.error) console.error("Google TTS API Error:", data.error.message);
                playNextTts();
            }
        }).catch(e => {
            console.error("Google TTS Fetch Error", e);
            playNextTts();
        });
    } else if (ttsEngine === 'google_free' || ttsEngine === 'true') {
        // Fallback to Free Google Translate's unofficial API
        const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${lang}&client=gtx&q=${encodeURIComponent(text)}`;
        currentAudio = new Audio(url);
        currentAudio.playbackRate = 1.5;
        
        currentAudio.onended = () => playNextTts();
        currentAudio.onerror = (e) => {
            console.error("TTS Audio error", e);
            playNextTts();
        };
        currentAudio.play().catch(e => {
            console.error("Audio play blocked or failed", e);
            playNextTts();
        });
    } else {
        // Disabled or invalid
        playNextTts();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OFFSCREEN_START') {
        startProcessing(message.config, message.streamId).catch(err => {
            chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: err.toString() });
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
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
                isPlayingTts = false;
                currentTtsItem = null;
            }
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

async function startProcessing(config, streamId) {
    if (audioCtx) stopProcessing();

    // Prepare Custom Vocabulary Rules
    customVocabularyRules = [];
    if (config.customVocabulary) {
        const lines = config.customVocabulary.split('\n');
        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length === 2) {
                const targetWord = parts[0].trim();
                const replacement = parts[1].trim();
                if (targetWord && replacement) {
                    // Create case-insensitive regex for the target word
                    try {
                        // Use word boundaries \b if it's ascii, otherwise standard global regex
                        const isAscii = /^[A-Za-z0-9]+$/.test(targetWord);
                        const regexStr = isAscii ? `\\b${targetWord}\\b` : targetWord;
                        customVocabularyRules.push({
                            regex: new RegExp(regexStr, 'gi'),
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
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Google Translate Error: " + data.error.message });
                } else {
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Unknown Google API Error" });
                }
            } catch (err) {
                console.error("Google Translation fetch error:", err);
                chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Google API Fetch failed (CORS/Network): " + err.message });
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
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "DeepL API Error: " + data.message });
                } else {
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Unknown DeepL API Error" });
                }
            } catch (err) {
                console.error("DeepL fetch error:", err);
                chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "DeepL API Fetch failed: " + err.message });
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
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Microsoft API Error: " + data.error.message });
                } else {
                    chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Unknown Microsoft API Error" });
                }
            } catch (err) {
                console.error("Microsoft fetch error:", err);
                chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: "Microsoft API Fetch failed: " + err.message });
            }
        }
    };
    window.sonioxClient.onTranslation = (text, speaker) => chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: applyCustomVocabulary(text), isTranslation: true, isFinal: true, speaker });
    window.sonioxClient.onProvisional = (text, speaker) => chrome.runtime.sendMessage({ type: 'TRANSCRIPT', text: applyCustomVocabulary(text), isTranslation: false, isFinal: false, speaker });
    window.sonioxClient.onError = (err) => chrome.runtime.sendMessage({ type: 'SONIOX_STATUS', status: 'error', error: err });

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

    // If tab capture, we must route the audio to destination so user can hear it
    if (streamId) {
        audioSource.connect(audioCtx.destination);
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
    // Clean up TTS
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    ttsQueue = [];
    isPlayingTts = false;
    currentTtsItem = null;
}
