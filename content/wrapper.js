// Wrapped in a function scope: background.js may inject this file again into
// tabs that already ran an older copy (e.g. after the extension was reloaded)
(() => {
// An overlay left by an orphaned older copy can't be driven by this one; replace it
document.getElementById('my-translator-overlay')?.remove();
let overlayContainer = null;
let originalTextEl, translationTextEl, provisionalTextEl;

let isDualMode = false;
let speakerColors = ['#38bdf8','#f472b6','#34d399','#fb923c'];

function initOverlay() {
    if (overlayContainer) {
        // If SPA frameworks (like YouTube) remove the overlay from DOM, re-append it
        if (!document.body.contains(overlayContainer)) {
            document.body.appendChild(overlayContainer);
        }
        return;
    }
    
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'my-translator-overlay';
    overlayContainer.className = 'my-translator-overlay';
    
    overlayContainer.innerHTML = `
        <div class="mt-panel mt-translation">
            <div class="mt-content" id="mt-translation-text"></div>
            <div class="mt-provisional" id="mt-provisional-text"></div>
        </div>
        <div class="mt-minimized-text" id="mt-minimized-text">
            🎙️ Voice Translator Minimized
        </div>
        <div class="mt-controls">
            <button id="mt-clear-btn" class="mt-control-btn mt-clear" title="Clear History">⎚</button>
            <button id="mt-minimize-btn" class="mt-control-btn" title="Minimize/Restore">—</button>
            <button id="mt-close-btn" class="mt-control-btn mt-close" title="Close">×</button>
        </div>
    `;
    
    document.body.appendChild(overlayContainer);

    translationTextEl = document.getElementById('mt-translation-text');
    provisionalTextEl = document.getElementById('mt-provisional-text');

    document.getElementById('mt-clear-btn').addEventListener('click', () => {
        translationTextEl.innerHTML = '';
    });

    document.getElementById('mt-close-btn').addEventListener('click', () => {
        overlayContainer.style.display = 'none';
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }); 
    });

    document.getElementById('mt-minimize-btn').addEventListener('click', () => {
        overlayContainer.classList.toggle('mt-minimized');
    });

    makeDraggable(overlayContainer);

    // Initial load styles
    chrome.storage.local.get(['overlay_font_size', 'overlay_text_color', 'overlay_bg_opacity', 'overlay_dual_mode', 'speaker_colors'], (result) => {
        isDualMode = !!result.overlay_dual_mode;
        if (result.speaker_colors && result.speaker_colors.length) speakerColors = result.speaker_colors;
        applyStyles({
            fontSize: result.overlay_font_size || "24",
            textColor: result.overlay_text_color || "#ffffff",
            bgOpacity: result.overlay_bg_opacity || "85"
        });
    });
}

function applyStyles(style) {
    if (!overlayContainer) return;
    if (style.bgOpacity !== undefined) {
        overlayContainer.style.backgroundColor = `rgba(18, 18, 18, ${style.bgOpacity / 100})`;
    }
    if (style.fontSize !== undefined) {
        if (translationTextEl) translationTextEl.style.fontSize = `${style.fontSize}px`;
        if (provisionalTextEl) provisionalTextEl.style.fontSize = `${Math.max(14, style.fontSize * 0.8)}px`;
    }
    if (style.textColor !== undefined && translationTextEl) {
        translationTextEl.style.color = style.textColor;
    }
    if (style.dualMode !== undefined) isDualMode = style.dualMode;
    if (style.speakerColors) speakerColors = style.speakerColors;
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        if (e.target.closest('.mt-controls')) return;
        const rect = element.getBoundingClientRect();
        const isResizing = (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20);
        if (isResizing) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.transform = 'none';
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function scrollBottom(el) {
    // Luôn cuộn xuống dưới cùng để đảm bảo realtime subtitle
    el.scrollTop = el.scrollHeight;
}

function getSpeakerColor(idx) {
    return speakerColors[idx % speakerColors.length] || '#38bdf8';
}

// Pending original text waiting for its translation pair (for dual-mode)
let pendingOriginal = null;
let pendingSpeaker = 0;

function addToken(translatedText, speaker) {
    if (!translatedText) return;

    const block = document.createElement('div');
    block.className = 'mt-block';

    const color = getSpeakerColor(speaker || 0);

    // Speaker badge
    const badge = document.createElement('span');
    badge.className = 'mt-speaker-badge';
    badge.textContent = 'S' + ((speaker || 0) + 1);
    badge.style.background = color + '33';
    badge.style.color = color;
    badge.style.border = '1px solid ' + color + '55';
    block.appendChild(badge);

    // Dual-mode: show original above
    if (isDualMode && pendingOriginal) {
        const origEl = document.createElement('div');
        origEl.className = 'mt-original-line';
        origEl.textContent = pendingOriginal;
        origEl.style.color = color + 'bb';
        block.appendChild(origEl);
    }
    pendingOriginal = null;

    const transEl = document.createElement('span');
    transEl.className = 'mt-token';
    transEl.textContent = translatedText + ' ';
    transEl.style.color = 'inherit';
    block.appendChild(transEl);

    translationTextEl.appendChild(block);
    
    // DOM Culling: limit to 50 blocks to save memory
    while (translationTextEl.children.length > 50) {
        translationTextEl.removeChild(translationTextEl.firstChild);
    }
    
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
        scrollBottom(translationTextEl.parentElement);
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
        sendResponse({ ok: true });
        return;
    }

    if (msg.type === 'TRANSCRIPT') {
        initOverlay();
        overlayContainer.style.display = 'flex';

        if (msg.isFinal) {
            if (!msg.isTranslation) {
                // Store original text for dual-mode pairing
                pendingOriginal = msg.text;
                pendingSpeaker = msg.speaker || 0;
            } else {
                addToken(msg.text, msg.speaker || pendingSpeaker);
            }
            provisionalTextEl.innerText = '';
        } else {
            if (!msg.isTranslation) {
                provisionalTextEl.innerText = msg.text;
                requestAnimationFrame(() => {
                    scrollBottom(translationTextEl.parentElement);
                });
            }
        }
    }
    
    if (msg.type === 'STATUS_UPDATE') {
        if (!msg.isRunning && overlayContainer && provisionalTextEl) {
            provisionalTextEl.innerText = '[Stopped]';
        }
    }
    
    if (msg.type === 'UPDATE_OVERLAY_STYLE') {
        applyStyles(msg.style);
    }
});
})();
