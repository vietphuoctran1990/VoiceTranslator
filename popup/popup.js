document.addEventListener("DOMContentLoaded", async () => {
const SPEAKER_COLORS_DEFAULT = ["#38bdf8","#f472b6","#34d399","#fb923c"];
const DEFAULT_GATEWAY_URL = "https://ai.tranvietphuoc.id.vn/api/v1";
const els = {
  uiLanguage: document.getElementById("ui-language"),
  audioSource: document.getElementById("audio-source"),
  sourceLang: document.getElementById("source-language"),
  targetLang: document.getElementById("target-language"),
  apiKey: document.getElementById("api-key"),
  toggleKey: document.getElementById("toggle-key"),
  btnStart: document.getElementById("btn-start"),
  btnStop: document.getElementById("btn-stop"),
  btnExport: document.getElementById("btn-export"),
  btnClearLog: document.getElementById("btn-clear-log"),
  statusDot: document.getElementById("status-indicator"),
  statusText: document.getElementById("status-text"),
  errorMsg: document.getElementById("error-msg"),
  ttsEngine: document.getElementById("tts-engine"),
  googleTtsSection: document.getElementById("google-tts-section"),
  googleTtsKey: document.getElementById("google-tts-key"),
  googleTtsVoice: document.getElementById("google-tts-voice"),
  elevenlabsTtsSection: document.getElementById("elevenlabs-tts-section"),
  elevenlabsApiKey: document.getElementById("elevenlabs-api-key"),
  elevenlabsVoiceId: document.getElementById("elevenlabs-voice-id"),
  openaiTtsSection: document.getElementById("openai-tts-section"),
  openaiTtsBaseUrl: document.getElementById("openai-tts-base-url"),
  openaiTtsApiKey: document.getElementById("openai-tts-api-key"),
  openaiTtsModel: document.getElementById("openai-tts-model"),
  openaiTtsModelList: document.getElementById("openai-tts-model-list"),
  openaiTtsVoice: document.getElementById("openai-tts-voice"),
  openaiTtsSpeed: document.getElementById("openai-tts-speed"),
  btnOpenaiLoadModels: document.getElementById("btn-openai-load-models"),
  btnOpenaiTest: document.getElementById("btn-openai-test"),
  openaiTtsTestStatus: document.getElementById("openai-tts-test-status"),
  openaiChatSection: document.getElementById("openai-chat-section"),
  openaiChatBaseUrl: document.getElementById("openai-chat-base-url"),
  openaiChatApiKey: document.getElementById("openai-chat-api-key"),
  openaiChatModel: document.getElementById("openai-chat-model"),
  openaiChatModelList: document.getElementById("openai-chat-model-list"),
  btnOpenaiChatLoadModels: document.getElementById("btn-openai-chat-load-models"),
  btnOpenaiChatTest: document.getElementById("btn-openai-chat-test"),
  openaiChatTestStatus: document.getElementById("openai-chat-test-status"),
  overlayFontSize: document.getElementById("overlay-font-size"),
  overlayTextColor: document.getElementById("overlay-text-color"),
  overlayBgOpacity: document.getElementById("overlay-bg-opacity"),
  overlayDualMode: document.getElementById("overlay-dual-mode"),
  translationEngine: document.getElementById("translation-engine"),
  googleTranslationKey: document.getElementById("google-translation-key"),
  googleTranslationSection: document.getElementById("google-translation-section"),
  deeplApiKey: document.getElementById("deepl-api-key"),
  deeplSection: document.getElementById("deepl-translation-section"),
  microsoftApiKey: document.getElementById("microsoft-api-key"),
  microsoftRegion: document.getElementById("microsoft-region"),
  microsoftSection: document.getElementById("microsoft-translation-section"),
  customVocabulary: document.getElementById("custom-vocabulary"),
  liveLog: document.getElementById("live-log"),
  autoStopTimer: document.getElementById("auto-stop-timer"),
  sessionsBadge: document.getElementById("sessions-badge"),
  sessionsList: document.getElementById("sessions-list"),
  sessionsEmpty: document.getElementById("sessions-empty")
};

const i18n = {
  en: {
    tab_home:"Home", tab_settings:"Config", tab_style:"Style", tab_history:"History", tab_sessions:"Sessions",
    title_audio_source:"Audio Source:", opt_tab_audio:"Current Tab Audio", opt_mic:"Microphone",
    title_source_lang:"Source Language", opt_auto:"Auto-detect", title_target_lang:"Target Language",
    title_soniox_key:"Soniox API Key (STT):", placeholder_soniox_key:"Enter Soniox API Key",
    title_engine:"Translation Engine:", opt_soniox:"Soniox (Native, Fast)", opt_google:"Google Translation",
    opt_deepl:"DeepL API", opt_microsoft:"Microsoft Translator",
    title_google_key:"Google Cloud API Key:", placeholder_google_key:"Enter Google Cloud API Key",
    title_deepl_key:"DeepL API Key:", placeholder_deepl_key:"Enter DeepL API Key",
    title_azure_key:"Azure Translator API Key:", placeholder_azure_key:"Enter Azure Key",
    title_azure_region:"Azure Region:", placeholder_azure_region:"e.g. eastus, global",
    title_tts:"Read translation aloud (TTS)", title_custom_vocab:"Custom Vocabulary:",
    desc_custom_vocab:"Force translation. Format: <code style='background:#222;padding:2px 4px;border-radius:3px;'>Source = Target</code>",
    placeholder_custom_vocab:"machine learning = hoc may",
    title_tts_engine:"TTS Engine", title_google_tts_key:"Google TTS API Key:",
    placeholder_google_tts_key:"Leave empty for free TTS", title_tts_voice:"Voice:",
    title_elevenlabs_key:"ElevenLabs API Key:", title_elevenlabs_voice:"ElevenLabs Voice ID:",
    title_openai_base_url:"API Base URL (OpenAI Compatible):", title_openai_api_key:"API Key / Virtual Key:",
    title_openai_model:"TTS Model:", title_openai_voice:"Voice(s) (comma separated, per speaker):",
    title_openai_speed:"Playback speed:", btn_load_models:"Load", btn_test_tts:"Test voice",
    opt_openai_compat:"OpenAI-compatible Gateway (LLM)", title_openai_chat_model:"Chat Model:", btn_test_translate:"Test",
    title_overlay_style:"Overlay Customization", title_font_size:"Font Size:",
    title_text_color:"Text Color:", title_bg_opacity:"BG Opacity %:",
    title_dual_mode:"Dual-Mode Overlay", desc_dual_mode:"Show original text above translation",
    title_speaker_colors:"Speaker Label Colors", label_speaker_a:"Speaker A", label_speaker_b:"Speaker B",
    label_speaker_c:"Speaker C", label_speaker_d:"Speaker D",
    btn_start:"Start Translating", btn_stop:"Stop", btn_export:"Export Transcript",
    title_auto_stop:"Auto-Stop inactivity (mins):", desc_auto_stop:"Set 0 to disable.",
    title_live_log:"Live Session Log", log_empty:"No session data yet. Click Start to begin.",
    sessions_empty:"No saved sessions yet.", status_ready:"Ready", status_connecting:"Connecting...",
    status_listening:"Listening", status_error:"Error",
    err_mic_permission:"Allow microphone access in the tab that just opened, then press Start again."
  },
  vi: {
    tab_home:"Trang chủ", tab_settings:"Cấu hình", tab_style:"Giao diện", tab_history:"Lịch sử", tab_sessions:"Phiên làm việc",
    title_audio_source:"Nguồn âm thanh:", opt_tab_audio:"Âm thanh Tab hiện tại", opt_mic:"Microphone",
    title_source_lang:"Ngôn ngữ gốc", opt_auto:"Tự động phát hiện", title_target_lang:"Ngôn ngữ đích",
    title_soniox_key:"Soniox API Key (STT):", placeholder_soniox_key:"Nhập Soniox API Key",
    title_engine:"Công cụ dịch thuật:", opt_soniox:"Soniox (Nhanh nhất)", opt_google:"Google Translation",
    opt_deepl:"DeepL API", opt_microsoft:"Microsoft Translator",
    title_google_key:"Google Cloud API Key:", placeholder_google_key:"Nhập Google Cloud API Key",
    title_deepl_key:"DeepL API Key:", placeholder_deepl_key:"Nhập DeepL API Key",
    title_azure_key:"Azure Translator API Key:", placeholder_azure_key:"Nhập Azure Key",
    title_azure_region:"Azure Region:", placeholder_azure_region:"VD: eastus, global",
    title_tts:"Đọc bản dịch (TTS)", title_custom_vocab:"Từ điển tùy biến:",
    desc_custom_vocab:"Ép dịch theo ý bạn. Định dạng: <code style='background:#222;padding:2px 4px;border-radius:3px;'>Từ gốc = Từ dịch</code>",
    placeholder_custom_vocab:"học máy = machine learning",
    title_tts_engine:"Động cơ Đọc (TTS Engine)", title_google_tts_key:"Google TTS API Key:",
    placeholder_google_tts_key:"Để trống để dùng Free TTS", title_tts_voice:"Giọng đọc:",
    title_elevenlabs_key:"ElevenLabs API Key:", title_elevenlabs_voice:"ElevenLabs Voice ID(s):",
    title_openai_base_url:"API Base URL (chuẩn OpenAI):", title_openai_api_key:"API Key / Virtual Key:",
    title_openai_model:"Model TTS:", title_openai_voice:"Giọng đọc (cách nhau dấu phẩy, theo người nói):",
    title_openai_speed:"Tốc độ phát:", btn_load_models:"Tải DS", btn_test_tts:"Nghe thử",
    opt_openai_compat:"Gateway chuẩn OpenAI (LLM)", title_openai_chat_model:"Model Chat:", btn_test_translate:"Dịch thử",
    title_overlay_style:"Tùy chỉnh Phụ đề (Overlay)", title_font_size:"Cỡ chữ:",
    title_text_color:"Màu chữ:", title_bg_opacity:"Độ mờ nền %:",
    title_dual_mode:"Chế độ Song ngữ", desc_dual_mode:"Hiện văn bản gốc phía trên bản dịch",
    title_speaker_colors:"Màu nhãn người nói", label_speaker_a:"Người nói A", label_speaker_b:"Người nói B",
    label_speaker_c:"Người nói C", label_speaker_d:"Người nói D",
    btn_start:"Bắt đầu Dịch", btn_stop:"Dừng", btn_export:"Xuất Transcript",
    title_auto_stop:"Tự động dừng sau (phút):", desc_auto_stop:"Đặt 0 để tắt.",
    title_live_log:"Lịch sử phiên dịch", log_empty:"Chưa có dữ liệu. Nhấn Bắt đầu để dịch.",
    sessions_empty:"Chưa có phiên lưu trữ nào.", status_ready:"Sẵn sàng", status_connecting:"Đang kết nối...",
    status_listening:"Đang nghe", status_error:"Lỗi",
    err_mic_permission:"Hãy cho phép dùng micro ở tab vừa mở, rồi bấm Bắt đầu lại."
  }
};

let speakerColors = [...SPEAKER_COLORS_DEFAULT];

function getSpeakerColor(idx) { return speakerColors[idx % speakerColors.length] || SPEAKER_COLORS_DEFAULT[0]; }
function getSpeakerLabel(idx, lang) {
  const letters = ["A","B","C","D","E","F"];
  return (lang === "vi" ? "Người nói " : "Speaker ") + (letters[idx] || (idx+1));
}

function updateUILanguage(lang) {
  if (!i18n[lang]) lang = "en";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (!i18n[lang][key]) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.placeholder !== undefined) el.placeholder = i18n[lang][key];
    } else if (el.tagName === "DIV" && el.innerHTML.includes("<code")) {
      el.innerHTML = i18n[lang][key];
    } else {
      el.textContent = i18n[lang][key];
    }
  });
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, r => { if (r) updateUIState(r.isRunning, r.status, r.error); });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.getAttribute("data-tab");
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(tabId).classList.add("active");
    if (tabId === "tab-sessions") loadSessions();
    if (tabId === "tab-history") chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT" }, r => { if (r) updateLiveLog(r.log); });
  });
});

function buildLogEntry(entry, lang) {
  const div = document.createElement("div");
  div.className = "log-entry";
  if (typeof entry === "string") { div.textContent = entry; return div; }

  const spk = entry.speaker !== undefined ? entry.speaker : 0;
  const color = getSpeakerColor(spk);
  const badge = document.createElement("span");
  badge.className = "log-speaker-label";
  badge.textContent = getSpeakerLabel(spk, lang);
  badge.style.background = color + "22";
  badge.style.color = color;
  badge.style.border = "1px solid " + color + "55";
  div.appendChild(badge);

  if (entry.original) {
    const orig = document.createElement("div");
    orig.className = "log-original";
    orig.textContent = entry.original;
    div.appendChild(orig);
  }
  const trans = document.createElement("div");
  trans.className = "log-translation";
  trans.textContent = entry.translation || "...";
  div.appendChild(trans);
  return div;
}

function updateLiveLog(log) {
  const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
  if (!log || log.length === 0) {
    els.liveLog.innerHTML = "<div class='log-empty'>" + (i18n[lang]["log_empty"] || "No data.") + "</div>";
    return;
  }
  els.liveLog.innerHTML = "";
  log.forEach(entry => els.liveLog.appendChild(buildLogEntry(entry, lang)));
  els.liveLog.scrollTop = els.liveLog.scrollHeight;
}

function buildMarkdown(log, startTime) {
  const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
  const date = startTime ? new Date(startTime).toLocaleString("vi-VN") : new Date().toLocaleString("vi-VN");
  let md = "# Voice Transcript\n**Time:** " + date + "\n\n---\n\n";
  log.forEach(entry => {
    if (typeof entry === "string") { md += entry + "\n\n"; return; }
    const spkLabel = getSpeakerLabel(entry.speaker !== undefined ? entry.speaker : 0, lang);
    md += "### " + spkLabel + "\n";
    if (entry.original) md += "**Original:** " + entry.original + "\n";
    if (entry.translation) md += "**Translation:** " + entry.translation + "\n";
    md += "\n";
  });
  return md;
}

function downloadMarkdown(md, filename) {
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadSessions() {
  chrome.runtime.sendMessage({ type: "GET_SESSIONS" }, res => {
    const sessions = (res && res.sessions) ? res.sessions : [];
    const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
    els.sessionsBadge.textContent = sessions.length;
    els.sessionsBadge.style.display = sessions.length > 0 ? "inline-block" : "none";
    if (sessions.length === 0) {
      els.sessionsEmpty.style.display = "block";
      els.sessionsList.innerHTML = "";
      return;
    }
    els.sessionsEmpty.style.display = "none";
    els.sessionsList.innerHTML = "";
    sessions.forEach(s => {
      const card = document.createElement("div");
      card.className = "session-card";
      const date = new Date(s.startTime).toLocaleString("vi-VN");
      const count = s.log ? s.log.length : 0;
      const preview = s.log && s.log[0] ? (s.log[0].translation || s.log[0].original || "") : "";
      card.innerHTML =
        "<div class='session-card-header'>" +
          "<span class='session-date'></span>" +
          "<span class='session-count'></span>" +
        "</div>" +
        "<div class='session-preview'></div>" +
        "<div class='session-actions'>" +
          "<button class='session-btn view' data-action='view'>&#128065; View</button>" +
          "<button class='session-btn export' data-action='export'>&#8659; Export</button>" +
          "<button class='session-btn delete' data-action='delete' title='Delete'>&#10005;</button>" +
        "</div>";
      // Transcript text is untrusted (speech/LLM output): set it as text, never HTML
      card.querySelector(".session-date").textContent = date;
      card.querySelector(".session-count").textContent = count + " segments";
      card.querySelector(".session-preview").textContent = preview.slice(0,100) || "...";
      card.querySelector("[data-action=view]").addEventListener("click", () => openSessionModal(s, lang));
      card.querySelector("[data-action=export]").addEventListener("click", () => {
        const md = buildMarkdown(s.log, s.startTime);
        const fname = "transcript_" + s.startTime.slice(0,19).replace(/[:]/g,"-") + ".md";
        downloadMarkdown(md, fname);
      });
      card.querySelector("[data-action=delete]").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "DELETE_SESSION", startTime: s.startTime }, () => loadSessions());
      });
      els.sessionsList.appendChild(card);
    });
  });
}

function openSessionModal(session, lang) {
  const overlay = document.createElement("div");
  overlay.className = "session-modal-overlay";
  const date = new Date(session.startTime).toLocaleString("vi-VN");
  const modal = document.createElement("div");
  modal.className = "session-modal";
  modal.innerHTML =
    "<div class='session-modal-header'>" +
      "<span class='session-modal-title'></span>" +
      "<button class='session-modal-close'>&#10005;</button>" +
    "</div>" +
    "<div class='session-modal-body' id='modal-body'></div>";
  modal.querySelector(".session-modal-title").textContent = date;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const body = modal.querySelector("#modal-body");
  (session.log || []).forEach(entry => body.appendChild(buildLogEntry(entry, lang)));
  modal.querySelector(".session-modal-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function toggleEngineSections() {
  els.googleTranslationSection.style.display = els.translationEngine.value === "google" ? "block" : "none";
  els.deeplSection.style.display = els.translationEngine.value === "deepl" ? "block" : "none";
  els.microsoftSection.style.display = els.translationEngine.value === "microsoft" ? "block" : "none";
  els.openaiChatSection.style.display = els.translationEngine.value === "openai_compat" ? "block" : "none";
}

function toggleTtsSections() {
  if (!els.googleTtsSection) return;
  const engine = els.ttsEngine.value;
  els.googleTtsSection.style.display = (engine === "google_cloud" || engine === "google_free") ? "block" : "none";
  els.elevenlabsTtsSection.style.display = engine === "elevenlabs" ? "block" : "none";
  els.openaiTtsSection.style.display = engine === "openai_compat" ? "block" : "none";
}

// Chrome only grants fetch access to hosts listed in the manifest; other
// gateway hosts are requested at runtime (must run inside a click handler)
// Accepts one URL or a list; all origins go in a single request() call
async function ensureGatewayPermission(baseUrls) {
  const origins = new Set();
  for (const baseUrl of [].concat(baseUrls)) {
    try { origins.add(new URL(window.normalizeOpenAIBaseUrl(baseUrl)).origin + "/*"); } catch (e) { throw new Error("Invalid Base URL: " + baseUrl); }
  }
  // request() resolves true immediately if already granted; call it first so
  // the click's user gesture is still active
  if (!(await chrome.permissions.request({ origins: [...origins] }))) throw new Error("Permission denied for " + [...origins].join(", "));
}

// The offscreen document can't show the microphone prompt, so the permission
// is granted once from a normal extension tab (permission/permission.html)
async function ensureMicPermission() {
  let state = "prompt";
  try { state = (await navigator.permissions.query({ name: "microphone" })).state; } catch (e) {}
  if (state === "granted") return;
  chrome.tabs.create({ url: chrome.runtime.getURL("permission/permission.html") });
  const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
  throw new Error(i18n[lang].err_mic_permission);
}

function getOpenaiTtsConfig() {
  return {
    baseUrl: els.openaiTtsBaseUrl.value.trim(),
    apiKey: els.openaiTtsApiKey.value.trim(),
    model: els.openaiTtsModel.value.trim()
  };
}

// Translation and TTS can share one gateway: empty chat URL/key fall back to the TTS ones
function getOpenaiChatConfig() {
  return {
    baseUrl: els.openaiChatBaseUrl.value.trim() || els.openaiTtsBaseUrl.value.trim(),
    apiKey: els.openaiChatApiKey.value.trim() || els.openaiTtsApiKey.value.trim(),
    model: els.openaiChatModel.value.trim()
  };
}

function setStatusText(el, text, isError) {
  el.textContent = text;
  el.style.color = isError ? "#f87171" : "#888";
}
function setTestStatus(text, isError) { setStatusText(els.openaiTtsTestStatus, text, isError); }

// Fill a model datalist from GET /models; preferPattern models are listed first
async function loadGatewayModels(cfg, listEl, inputEl, statusEl, preferPattern, excludePattern) {
  setStatusText(statusEl, "...", false);
  try {
    await ensureGatewayPermission(cfg.baseUrl);
    const models = await window.openaiCompatListModels(cfg);
    models.sort((a, b) => (preferPattern.test(b) ? 1 : 0) - (preferPattern.test(a) ? 1 : 0));
    listEl.innerHTML = "";
    models.forEach(m => { const o = document.createElement("option"); o.value = m; listEl.appendChild(o); });
    const pick = models.find(m => preferPattern.test(m) && !(excludePattern && excludePattern.test(m)));
    if (!inputEl.value.trim() && pick) { inputEl.value = pick; saveSettings(); }
    setStatusText(statusEl, models.length + " models", false);
  } catch (e) {
    setStatusText(statusEl, e.message, true);
  }
}

els.btnOpenaiLoadModels.addEventListener("click", () => {
  loadGatewayModels(getOpenaiTtsConfig(), els.openaiTtsModelList, els.openaiTtsModel, els.openaiTtsTestStatus, /tts|speech|audio/i);
});

els.btnOpenaiChatLoadModels.addEventListener("click", () => {
  loadGatewayModels(getOpenaiChatConfig(), els.openaiChatModelList, els.openaiChatModel, els.openaiChatTestStatus,
    /flash|gpt|chat|pro/i, /tts|image|embed|audio|speech|vision-only/i);
});

els.btnOpenaiChatTest.addEventListener("click", async () => {
  const cfg = getOpenaiChatConfig();
  setStatusText(els.openaiChatTestStatus, "...", false);
  try {
    await ensureGatewayPermission(cfg.baseUrl);
    const t0 = Date.now();
    const result = await window.openaiCompatTranslate({
      ...cfg,
      text: els.targetLang.value === "en" ? "Xin chào, hôm nay trời đẹp quá." : "Hello, the weather is really nice today.",
      sourceLanguage: "auto",
      targetLanguage: els.targetLang.value
    });
    setStatusText(els.openaiChatTestStatus, result + " (" + (Date.now() - t0) + "ms)", false);
  } catch (e) {
    setStatusText(els.openaiChatTestStatus, e.message, true);
  }
});

let testAudio = null;
els.btnOpenaiTest.addEventListener("click", async () => {
  const cfg = getOpenaiTtsConfig();
  const voice = els.openaiTtsVoice.value.split(",").map(v => v.trim()).filter(v => v)[0];
  const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
  setTestStatus("...", false);
  try {
    await ensureGatewayPermission(cfg.baseUrl);
    const blob = await window.openaiCompatSpeech({
      ...cfg, voice,
      text: lang === "vi" ? "Xin chào, đây là giọng đọc thử nghiệm." : "Hello, this is a test voice."
    });
    if (testAudio) testAudio.pause();
    const url = URL.createObjectURL(blob);
    testAudio = new Audio(url);
    testAudio.playbackRate = parseFloat(els.openaiTtsSpeed.value) || 1.2;
    testAudio.onended = () => URL.revokeObjectURL(url);
    await testAudio.play();
    setTestStatus("OK", false);
  } catch (e) {
    setTestStatus(e.message, true);
  }
});

function broadcastOverlayStyle() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {
      type: "UPDATE_OVERLAY_STYLE",
      style: {
        fontSize: els.overlayFontSize.value,
        textColor: els.overlayTextColor.value,
        bgOpacity: els.overlayBgOpacity.value,
        dualMode: els.overlayDualMode ? els.overlayDualMode.checked : false,
        speakerColors
      }
    }).catch(() => {});
  });
}

const saveSettings = () => {
  const sc = [0,1,2,3].map(i => { const el = document.getElementById("speaker-color-"+i); return el ? el.value : SPEAKER_COLORS_DEFAULT[i]; });
  speakerColors = sc;
  chrome.storage.local.set({
    ui_language: els.uiLanguage ? els.uiLanguage.value : "vi",
    soniox_api_key: els.apiKey.value.trim(),
    source_language: els.sourceLang.value,
    target_language: els.targetLang.value,
    audio_source: els.audioSource.value,
    tts_engine: els.ttsEngine.value,
    google_tts_key: els.googleTtsKey.value.trim(),
    google_tts_voice: els.googleTtsVoice.value,
    elevenlabs_api_key: els.elevenlabsApiKey.value.trim(),
    elevenlabs_voice_id: els.elevenlabsVoiceId.value.trim(),
    openai_tts_base_url: els.openaiTtsBaseUrl.value.trim(),
    openai_tts_api_key: els.openaiTtsApiKey.value.trim(),
    openai_tts_model: els.openaiTtsModel.value.trim(),
    openai_tts_voice: els.openaiTtsVoice.value.trim(),
    openai_tts_speed: els.openaiTtsSpeed.value,
    openai_chat_base_url: els.openaiChatBaseUrl.value.trim(),
    openai_chat_api_key: els.openaiChatApiKey.value.trim(),
    openai_chat_model: els.openaiChatModel.value.trim(),
    overlay_font_size: els.overlayFontSize.value,
    overlay_text_color: els.overlayTextColor.value,
    overlay_bg_opacity: els.overlayBgOpacity.value,
    overlay_dual_mode: els.overlayDualMode ? els.overlayDualMode.checked : false,
    speaker_colors: sc,
    translation_engine: els.translationEngine.value,
    google_translation_key: els.googleTranslationKey.value.trim(),
    deepl_api_key: els.deeplApiKey.value.trim(),
    microsoft_api_key: els.microsoftApiKey.value.trim(),
    microsoft_region: els.microsoftRegion.value.trim(),
    custom_vocabulary: els.customVocabulary ? els.customVocabulary.value : "",
    auto_stop_timer: els.autoStopTimer ? els.autoStopTimer.value : 5
  });
  broadcastOverlayStyle();
};

// Load settings
chrome.storage.local.get([
  "ui_language","soniox_api_key","source_language","target_language","audio_source","tts_engine",
  "google_tts_key","google_tts_voice","elevenlabs_api_key","elevenlabs_voice_id",
  "openai_tts_base_url","openai_tts_api_key","openai_tts_model","openai_tts_voice","openai_tts_speed",
  "openai_chat_base_url","openai_chat_api_key","openai_chat_model",
  "overlay_font_size","overlay_text_color","overlay_bg_opacity","overlay_dual_mode","speaker_colors",
  "translation_engine","google_translation_key","deepl_api_key","microsoft_api_key","microsoft_region",
  "custom_vocabulary","auto_stop_timer"
], result => {
  const lang = result.ui_language || "vi";
  if (els.uiLanguage) els.uiLanguage.value = lang;
  updateUILanguage(lang);
  if (result.soniox_api_key) els.apiKey.value = result.soniox_api_key;
  if (result.source_language) els.sourceLang.value = result.source_language;
  if (result.target_language) els.targetLang.value = result.target_language;
  if (result.audio_source) els.audioSource.value = result.audio_source;
  if (result.tts_engine) els.ttsEngine.value = result.tts_engine;
  if (result.google_tts_key) els.googleTtsKey.value = result.google_tts_key;
  if (result.google_tts_voice) els.googleTtsVoice.value = result.google_tts_voice;
  if (result.elevenlabs_api_key) els.elevenlabsApiKey.value = result.elevenlabs_api_key;
  if (result.elevenlabs_voice_id) els.elevenlabsVoiceId.value = result.elevenlabs_voice_id;
  els.openaiTtsBaseUrl.value = result.openai_tts_base_url || DEFAULT_GATEWAY_URL;
  if (result.openai_tts_api_key) els.openaiTtsApiKey.value = result.openai_tts_api_key;
  if (result.openai_tts_model) els.openaiTtsModel.value = result.openai_tts_model;
  if (result.openai_tts_voice) els.openaiTtsVoice.value = result.openai_tts_voice;
  if (result.openai_tts_speed) els.openaiTtsSpeed.value = result.openai_tts_speed;
  if (result.openai_chat_base_url) els.openaiChatBaseUrl.value = result.openai_chat_base_url;
  if (result.openai_chat_api_key) els.openaiChatApiKey.value = result.openai_chat_api_key;
  if (result.openai_chat_model) els.openaiChatModel.value = result.openai_chat_model;
  if (result.overlay_font_size) els.overlayFontSize.value = result.overlay_font_size;
  if (result.overlay_text_color) els.overlayTextColor.value = result.overlay_text_color;
  if (result.overlay_bg_opacity) els.overlayBgOpacity.value = result.overlay_bg_opacity;
  if (els.overlayDualMode) els.overlayDualMode.checked = !!result.overlay_dual_mode;
  if (result.speaker_colors && result.speaker_colors.length) {
    speakerColors = result.speaker_colors;
    result.speaker_colors.forEach((c, i) => { const el = document.getElementById("speaker-color-"+i); if (el) el.value = c; });
  }
  if (result.translation_engine) els.translationEngine.value = result.translation_engine;
  if (result.google_translation_key) els.googleTranslationKey.value = result.google_translation_key;
  if (result.deepl_api_key) els.deeplApiKey.value = result.deepl_api_key;
  if (result.microsoft_api_key) els.microsoftApiKey.value = result.microsoft_api_key;
  if (result.microsoft_region) els.microsoftRegion.value = result.microsoft_region;
  if (result.custom_vocabulary) els.customVocabulary.value = result.custom_vocabulary;
  if (result.auto_stop_timer !== undefined) els.autoStopTimer.value = result.auto_stop_timer;
  toggleEngineSections();
  toggleTtsSections();
});

// Event listeners - settings
els.uiLanguage.addEventListener("change", () => { saveSettings(); updateUILanguage(els.uiLanguage.value); });
els.apiKey.addEventListener("input", saveSettings);
els.sourceLang.addEventListener("change", saveSettings);
els.targetLang.addEventListener("change", saveSettings);
els.audioSource.addEventListener("change", saveSettings);
if (els.ttsEngine) els.ttsEngine.addEventListener("change", () => { toggleTtsSections(); saveSettings(); });
els.googleTtsKey.addEventListener("input", saveSettings);
els.googleTtsVoice.addEventListener("change", saveSettings);
if (els.elevenlabsApiKey) els.elevenlabsApiKey.addEventListener("input", saveSettings);
if (els.elevenlabsVoiceId) els.elevenlabsVoiceId.addEventListener("input", saveSettings);
[els.openaiTtsBaseUrl, els.openaiTtsApiKey, els.openaiTtsModel, els.openaiTtsVoice, els.openaiTtsSpeed,
 els.openaiChatBaseUrl, els.openaiChatApiKey, els.openaiChatModel].forEach(el => el.addEventListener("input", saveSettings));
els.overlayFontSize.addEventListener("input", saveSettings);
els.overlayTextColor.addEventListener("input", saveSettings);
els.overlayBgOpacity.addEventListener("input", saveSettings);
if (els.overlayDualMode) els.overlayDualMode.addEventListener("change", saveSettings);
[0,1,2,3].forEach(i => { const el = document.getElementById("speaker-color-"+i); if (el) el.addEventListener("input", saveSettings); });
els.googleTranslationKey.addEventListener("input", saveSettings);
els.deeplApiKey.addEventListener("input", saveSettings);
els.microsoftApiKey.addEventListener("input", saveSettings);
els.microsoftRegion.addEventListener("input", saveSettings);
els.customVocabulary.addEventListener("input", saveSettings);
if (els.autoStopTimer) els.autoStopTimer.addEventListener("input", saveSettings);
els.translationEngine.addEventListener("change", () => { toggleEngineSections(); saveSettings(); });
els.toggleKey.addEventListener("click", () => { els.apiKey.type = els.apiKey.type === "password" ? "text" : "password"; });
els.btnClearLog.addEventListener("click", () => { chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" }, () => updateLiveLog([])); });

// Status & transcript on open
chrome.runtime.sendMessage({ type: "GET_STATUS" }, r => { if (r) updateUIState(r.isRunning, r.status, r.error); });
chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT" }, r => { if (r) updateLiveLog(r.log); });

// Load sessions badge count on startup
chrome.runtime.sendMessage({ type: "GET_SESSIONS" }, res => {
  const count = (res && res.sessions) ? res.sessions.length : 0;
  if (els.sessionsBadge) { els.sessionsBadge.textContent = count; els.sessionsBadge.style.display = count > 0 ? "inline-block" : "none"; }
});

// Live updates
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "STATUS_UPDATE") updateUIState(msg.isRunning, msg.status, msg.error);
  if (msg.type === "TRANSCRIPT" && msg.isTranslation && msg.isFinal) {
    chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT" }, r => { if (r) updateLiveLog(r.log); });
  }
});

// Start button
els.btnStart.addEventListener("click", () => {
  if (!els.apiKey.value.trim()) { showError("Soniox API Key is required."); return; }
  if (els.translationEngine.value === "google" && !els.googleTranslationKey.value.trim()) { showError("Google Key required."); return; }
  if (els.translationEngine.value === "deepl" && !els.deeplApiKey.value.trim()) { showError("DeepL Key required."); return; }
  if (els.translationEngine.value === "microsoft" && !els.microsoftApiKey.value.trim()) { showError("Azure Key required."); return; }
  // Gateway origins not in the manifest need a runtime grant, requested within this click
  const gatewayUrls = [];
  if (els.ttsEngine.value === "openai_compat") {
    if (!els.openaiTtsBaseUrl.value.trim()) { showError("Gateway TTS Base URL required."); return; }
    gatewayUrls.push(els.openaiTtsBaseUrl.value);
  }
  if (els.translationEngine.value === "openai_compat") {
    const chat = getOpenaiChatConfig();
    if (!chat.baseUrl) { showError("Gateway Base URL required."); return; }
    if (!chat.model) { showError("Gateway Chat Model required."); return; }
    gatewayUrls.push(chat.baseUrl);
  }
  const permissions = gatewayUrls.length ? ensureGatewayPermission(gatewayUrls) : Promise.resolve();
  permissions
    .then(() => els.audioSource.value === "mic" ? ensureMicPermission() : null)
    .then(startRecording)
    .catch(e => showError(e.message));
});

function startRecording() {
  els.errorMsg.style.display = "none";
  updateUIState(true, "connecting");
  chrome.runtime.sendMessage({
    type: "START_RECORDING",
    config: {
      audioSource: els.audioSource.value,
      apiKey: els.apiKey.value.trim(),
      sourceLanguage: els.sourceLang.value,
      targetLanguage: els.targetLang.value,
      ttsEngine: els.ttsEngine.value,
      googleTtsKey: els.googleTtsKey.value.trim(),
      googleTtsVoice: els.googleTtsVoice.value,
      elevenlabsApiKey: els.elevenlabsApiKey.value.trim(),
      elevenlabsVoiceId: els.elevenlabsVoiceId.value.trim(),
      openaiTtsBaseUrl: els.openaiTtsBaseUrl.value.trim(),
      openaiTtsApiKey: els.openaiTtsApiKey.value.trim(),
      openaiTtsModel: els.openaiTtsModel.value.trim(),
      openaiTtsVoice: els.openaiTtsVoice.value.trim(),
      openaiTtsSpeed: parseFloat(els.openaiTtsSpeed.value) || 1.2,
      translationEngine: els.translationEngine.value,
      openaiChatBaseUrl: getOpenaiChatConfig().baseUrl,
      openaiChatApiKey: getOpenaiChatConfig().apiKey,
      openaiChatModel: getOpenaiChatConfig().model,
      googleTranslationKey: els.googleTranslationKey.value.trim(),
      deeplApiKey: els.deeplApiKey.value.trim(),
      microsoftApiKey: els.microsoftApiKey.value.trim(),
      microsoftRegion: els.microsoftRegion.value.trim(),
      customVocabulary: els.customVocabulary ? els.customVocabulary.value : "",
      autoStopTimer: els.autoStopTimer ? parseInt(els.autoStopTimer.value) : 5,
      style: {
        fontSize: els.overlayFontSize.value,
        textColor: els.overlayTextColor.value,
        bgOpacity: els.overlayBgOpacity.value,
        dualMode: els.overlayDualMode ? els.overlayDualMode.checked : false,
        speakerColors
      }
    }
  });
}

els.btnStop.addEventListener("click", () => {
  els.btnStop.disabled = true;
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, () => { els.btnStop.disabled = false; });
});

els.btnExport.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT" }, res => {
    if (res && res.log && res.log.length > 0) {
      const md = buildMarkdown(res.log, res.startTime);
      downloadMarkdown(md, "transcript_" + new Date().toISOString().slice(0,19).replace(/[:]/g,"-") + ".md");
    } else {
      showError("No transcript log available.");
    }
  });
});

function updateUIState(isRunning, status, error = null) {
  els.btnStart.style.display = isRunning ? "none" : "inline-block";
  els.btnStop.style.display = isRunning ? "inline-block" : "none";
  els.statusDot.className = "status-dot " + status;
  const lang = (els.uiLanguage ? els.uiLanguage.value : "vi") || "vi";
  // Background reports connected/disconnected; the labels are listening/ready
  const key = "status_" + ({ connected: "listening", disconnected: "ready" }[status] || status);
  if (i18n[lang][key]) els.statusText.textContent = i18n[lang][key];
  if (error) showError(error);
  else if (status === "connected") els.errorMsg.style.display = "none";
}

function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.style.display = "block";
}

}); // end DOMContentLoaded
