// OpenAI-compatible API client: TTS (POST {baseUrl}/audio/speech), chat
// translation (POST {baseUrl}/chat/completions) and model listing.
// Works with OpenAI itself and self-hosted gateways (e.g. Universal AI Gateway
// rotating Gemini keys). Shared by offscreen.js and popup.js.

function normalizeOpenAIBaseUrl(baseUrl) {
    let url = (baseUrl || '').trim().replace(/\/+$/, '');
    // Accept a full endpoint pasted by mistake
    url = url.replace(/\/audio\/speech$/, '').replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    return url;
}

function openaiAuthHeaders(apiKey) {
    const headers = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
}

// Wrap raw 16-bit little-endian PCM (Gemini TTS native output) in a WAV header
function pcmToWavBlob(pcmBuffer, sampleRate = 24000, numChannels = 1) {
    const dataLen = pcmBuffer.byteLength;
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, numChannels, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * numChannels * 2, true);
    v.setUint16(32, numChannels * 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, dataLen, true);
    return new Blob([header, pcmBuffer], { type: 'audio/wav' });
}

function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

function parseSampleRate(mime) {
    const m = /rate=(\d+)/i.exec(mime || '');
    return m ? parseInt(m[1], 10) : 24000;
}

// Returns a playable audio Blob
async function openaiCompatSpeech({ baseUrl, apiKey, model, voice, text, format = 'mp3' }) {
    const url = normalizeOpenAIBaseUrl(baseUrl);
    if (!url) throw new Error('Gateway Base URL is required');

    // Default voice is a Gemini one, since the target gateway serves Gemini TTS
    const body = { model: model || 'tts-1', input: text, voice: voice || 'Kore', response_format: format };
    const res = await fetch(`${url}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...openaiAuthHeaders(apiKey) },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        let detail = res.statusText;
        try {
            const errText = await res.text();
            try { detail = JSON.parse(errText).error?.message || errText; } catch (e) { detail = errText || detail; }
        } catch (e) {}
        throw new Error(`Gateway TTS Error ${res.status}: ${String(detail).slice(0, 300)}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // Some gateways answer with JSON carrying base64 audio
    if (contentType.includes('application/json')) {
        const data = await res.json();
        const b64 = data.audio || data.audioContent || data.data?.[0]?.b64_json || data.b64_json;
        if (!b64) throw new Error('Gateway TTS returned JSON without audio');
        const mime = (data.mime_type || data.mimeType || '').toLowerCase();
        const buf = base64ToArrayBuffer(b64);
        if (mime.includes('pcm') || mime.includes('l16')) return pcmToWavBlob(buf, parseSampleRate(mime));
        return new Blob([buf], { type: mime || `audio/${format}` });
    }

    const buf = await res.arrayBuffer();
    if (contentType.includes('pcm') || contentType.includes('l16')) {
        return pcmToWavBlob(buf, parseSampleRate(contentType));
    }
    return new Blob([buf], { type: contentType.startsWith('audio/') ? contentType : `audio/${format}` });
}

// Returns an array of model ids from GET {baseUrl}/models
async function openaiCompatListModels({ baseUrl, apiKey }) {
    const url = normalizeOpenAIBaseUrl(baseUrl);
    if (!url) throw new Error('Gateway Base URL is required');
    const res = await fetch(`${url}/models`, { headers: openaiAuthHeaders(apiKey) });
    if (!res.ok) throw new Error(`Gateway /models Error ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || data.models || []);
    return list.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
}

// Translate one utterance with a chat model. `history` is a list of recent
// {original, translation} pairs used as context; `glossary` is custom vocab lines.
async function openaiCompatTranslate({ baseUrl, apiKey, model, text, sourceLanguage, targetLanguage, history = [], glossary = '' }) {
    const url = normalizeOpenAIBaseUrl(baseUrl);
    if (!url) throw new Error('Gateway Base URL is required');

    const source = sourceLanguage && sourceLanguage !== 'auto' ? `from language "${sourceLanguage}"` : 'from the detected source language';
    let system = `You are a real-time speech interpreter. Translate the user's transcribed speech ${source} into language "${targetLanguage}" (ISO 639-1 code). ` +
        'The input comes from speech recognition and may be fragmentary or contain recognition errors; translate the intended meaning naturally and concisely, as it would be spoken. ' +
        'Output ONLY the translation, with no quotes, notes, explanations or alternatives. If the input is already in the target language, return it unchanged.';
    if (glossary.trim()) system += `\nAlways use this glossary (source = target):\n${glossary.trim()}`;
    if (history.length) {
        system += '\nRecent conversation for context (do not translate it again):\n' +
            history.map(h => `- ${h.original} => ${h.translation}`).join('\n');
    }

    const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...openaiAuthHeaders(apiKey) },
        body: JSON.stringify({
            model: model || 'gemini-2.5-flash',
            messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
            temperature: 0.2,
            stream: false
        })
    });

    if (!res.ok) {
        let detail = res.statusText;
        try {
            const errText = await res.text();
            try { detail = JSON.parse(errText).error?.message || errText; } catch (e) { detail = errText || detail; }
        } catch (e) {}
        throw new Error(`Gateway Chat Error ${res.status}: ${String(detail).slice(0, 300)}`);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content;
    if (Array.isArray(content)) content = content.map(c => c.text || '').join('');
    if (typeof content !== 'string') throw new Error('Gateway Chat returned no content');
    // Strip reasoning blocks some models emit, plus wrapping quotes
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^["“](.*)["”]$/s, '$1').trim();
}

window.openaiCompatSpeech = openaiCompatSpeech;
window.openaiCompatTranslate = openaiCompatTranslate;
window.openaiCompatListModels = openaiCompatListModels;
window.normalizeOpenAIBaseUrl = normalizeOpenAIBaseUrl;
