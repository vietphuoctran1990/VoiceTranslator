// OpenAI-compatible TTS client (POST {baseUrl}/audio/speech).
// Works with OpenAI itself and self-hosted gateways (e.g. Universal AI Gateway
// rotating Gemini keys). Shared by offscreen.js (playback) and popup.js (test).

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

    const body = { model: model || 'tts-1', input: text, voice: voice || 'alloy', response_format: format };
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

window.openaiCompatSpeech = openaiCompatSpeech;
window.openaiCompatListModels = openaiCompatListModels;
window.normalizeOpenAIBaseUrl = normalizeOpenAIBaseUrl;
