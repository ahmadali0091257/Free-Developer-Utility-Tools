/**
 * Aezoon Customer Support Widget
 * Shopify mein add karne ka tarika:
 *   1. Firebase config aur widget config neeche set karo
 *   2. Yeh script apne Shopify theme ke <head> ya </body> se pehle add karo:
 *      <link rel="stylesheet" href="YOUR_HOST/support-widget.css">
 *      <script src="YOUR_HOST/support-widget.js"></script>
 */

(function () {
  'use strict';

  // ── CONFIG — Yahan apni values dalo ──────────────────────────
  const WIDGET_CONFIG = {
    storeName: 'Aezoon Store',          // Tumhara store naam
    botName: 'Aezoon Support',          // Chat mein dikhne wala naam
    botEmoji: '🛍️',                     // Avatar emoji
    welcomeMsg: 'Salam! 👋 Main Aezoon Support hoon. Aapki kaise madad kar sakta hoon?',
    placeholder: 'Apna sawal likhein...',
    primaryColor: '#6366f1',
    poweredBy: 'Powered by Aezoon',
    firebaseConfig: {
      apiKey: "AIzaSyC_asx16rLu7LmC3d-jRVBESrQvfrceuVo",
      authDomain: "aezoon-app.firebaseapp.com",
      projectId: "aezoon-app",
      storageBucket: "aezoon-app.firebasestorage.app",
      messagingSenderId: "900605885255",
      appId: "1:900605885255:web:ecaddb61a88ad344c1ea62"
    }
  };
  // ─────────────────────────────────────────────────────────────

  // Session ID — har visitor ka unique ID
  const SESSION_ID = 'aezoon_' + (localStorage.getItem('aezoon_session') || (() => {
    const id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    localStorage.setItem('aezoon_session', id);
    return id;
  })());

  let db = null;
  let AI_CONFIG = { model: 'gemini-1.5-flash', api_key: '', system_prompt: '' };
  let chatHistory = [];
  let isTyping = false;
  let chatOpen = false;

  // ── Load Firebase ─────────────────────────────────────────────
  function loadFirebase(cb) {
    if (window.firebase && window.firebase.firestore) { initDB(cb); return; }
    const scripts = [
      'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-compat.js'
    ];
    let loaded = 0;
    scripts.forEach(src => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { if (++loaded === scripts.length) initDB(cb); };
      document.head.appendChild(s);
    });
  }

  function initDB(cb) {
    if (!firebase.apps.length) firebase.initializeApp(WIDGET_CONFIG.firebaseConfig);
    db = firebase.firestore();
    cb();
  }

  // ── Load AI Config from Firestore ─────────────────────────────
  async function loadAIConfig() {
    try {
      const snap = await db.collection('support_settings').doc('config').get();
      if (snap.exists) AI_CONFIG = { ...AI_CONFIG, ...snap.data() };
    } catch (e) { console.log('Aezoon: config load error', e); }
  }

  // ── Load existing chat history ────────────────────────────────
  async function loadHistory() {
    try {
      const snap = await db.collection('support_chats').doc(SESSION_ID).get();
      if (snap.exists) {
        chatHistory = snap.data().messages || [];
        chatHistory.forEach(m => appendBubble(m.role, m.content, m.time, false));
      } else {
        appendBubble('bot', AI_CONFIG.welcome_msg || WIDGET_CONFIG.welcomeMsg, getTime(), false);
      }
      scrollBottom();
    } catch (e) {
      appendBubble('bot', WIDGET_CONFIG.welcomeMsg, getTime(), false);
    }
  }

  // ── Save chat to Firestore ────────────────────────────────────
  async function saveChat() {
    try {
      await db.collection('support_chats').doc(SESSION_ID).set({
        session_id: SESSION_ID,
        store: WIDGET_CONFIG.storeName,
        page: window.location.href,
        updated_at: Date.now(),
        messages: chatHistory.slice(-40)
      }, { merge: true });
    } catch (e) { /* silent */ }
  }

  // ── AI Call ───────────────────────────────────────────────────
  async function callAI(userMsg) {
    const model = AI_CONFIG.model || 'gemini-1.5-flash';
    const key = AI_CONFIG.api_key || '';
    if (!key) return 'Sorry, AI abhi available nahi hai. Please baad mein try karein.';

    const systemPrompt = AI_CONFIG.system_prompt ||
      `You are a helpful customer support agent for ${WIDGET_CONFIG.storeName}. Answer customer questions politely and helpfully. Keep answers concise.`;

    const history = chatHistory.slice(-8);

    if (model.startsWith('gemini')) {
      const msgs = [
        ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userMsg }] }
      ];
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: msgs,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates[0].content.parts[0].text;
    } else {
      const msgs = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        { role: 'user', content: userMsg }
      ];
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: msgs, max_tokens: 512, temperature: 0.7 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices[0].message.content;
    }
  }

  // ── Send Message ──────────────────────────────────────────────
  async function sendMessage() {
    if (isTyping) return;
    const input = document.getElementById('aezoon-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    const time = getTime();
    chatHistory.push({ role: 'user', content: text, time });
    appendBubble('user', text, time, true);
    showTyping();
    isTyping = true;

    try {
      const reply = await callAI(text);
      hideTyping();
      isTyping = false;
      chatHistory.push({ role: 'assistant', content: reply, time: getTime() });
      appendBubble('bot', reply, getTime(), true);
      saveChat();
    } catch (e) {
      hideTyping();
      isTyping = false;
      appendBubble('bot', '❌ Error: ' + e.message, getTime(), true);
    }
  }

  // ── DOM Helpers ───────────────────────────────────────────────
  function appendBubble(role, text, time, animate) {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs) return;
    const row = document.createElement('div');
    row.className = 'aezoon-msg-row ' + (role === 'user' ? 'user' : 'bot');
    const formatted = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    row.innerHTML = `<div class="aezoon-bubble ${role === 'user' ? 'user' : 'bot'}">${formatted}<div class="aezoon-bubble-time">${time}</div></div>`;
    if (animate) row.style.animation = 'aezoonSlideUp 0.2s ease';
    msgs.appendChild(row);
    scrollBottom();
  }

  function showTyping() {
    const msgs = document.getElementById('aezoon-messages');
    const el = document.createElement('div');
    el.id = 'aezoon-typing-row';
    el.className = 'aezoon-msg-row bot';
    el.innerHTML = `<div class="aezoon-typing"><div class="aezoon-dot"></div><div class="aezoon-dot"></div><div class="aezoon-dot"></div></div>`;
    msgs.appendChild(el);
    scrollBottom();
  }

  function hideTyping() { document.getElementById('aezoon-typing-row')?.remove(); }
  function scrollBottom() {
    const msgs = document.getElementById('aezoon-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  function getTime() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ── Toggle Chat ───────────────────────────────────────────────
  function toggleChat() {
    chatOpen = !chatOpen;
    const box = document.getElementById('aezoon-chat-box');
    const btn = document.getElementById('aezoon-widget-btn');
    if (chatOpen) {
      box.classList.add('open');
      btn.innerHTML = '✕';
      document.getElementById('aezoon-unread-dot').style.display = 'none';
      document.getElementById('aezoon-input')?.focus();
    } else {
      box.classList.remove('open');
      btn.innerHTML = WIDGET_CONFIG.botEmoji;
    }
  }

  // ── Build Widget HTML ─────────────────────────────────────────
  function buildWidget() {
    // CSS
    if (!document.getElementById('aezoon-widget-css')) {
      const link = document.createElement('link');
      link.id = 'aezoon-widget-css';
      link.rel = 'stylesheet';
      // Try to find CSS relative to script
      const scripts = document.querySelectorAll('script[src*="support-widget"]');
      const base = scripts.length ? scripts[scripts.length - 1].src.replace('support-widget.js', '') : '';
      link.href = base + 'support-widget.css';
      document.head.appendChild(link);
    }

    // Widget button
    const btn = document.createElement('button');
    btn.id = 'aezoon-widget-btn';
    btn.setAttribute('aria-label', 'Open support chat');
    btn.innerHTML = `${WIDGET_CONFIG.botEmoji}<span id="aezoon-unread-dot"></span>`;
    btn.style.background = WIDGET_CONFIG.primaryColor;
    btn.onclick = toggleChat;

    // Chat box
    const box = document.createElement('div');
    box.id = 'aezoon-chat-box';
    box.innerHTML = `
      <div id="aezoon-header" style="background:${WIDGET_CONFIG.primaryColor}">
        <div id="aezoon-header-avatar">${WIDGET_CONFIG.botEmoji}</div>
        <div id="aezoon-header-info">
          <div id="aezoon-header-name">${WIDGET_CONFIG.botName}</div>
          <div id="aezoon-header-status">● Online — Typically replies instantly</div>
        </div>
        <button id="aezoon-close-btn" onclick="document.getElementById('aezoon-widget-btn').click()">✕</button>
      </div>
      <div id="aezoon-messages"></div>
      <div id="aezoon-input-area">
        <textarea id="aezoon-input" placeholder="${WIDGET_CONFIG.placeholder}" rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window._aezoonSend()}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
        <button id="aezoon-send-btn" onclick="window._aezoonSend()">➤</button>
      </div>
      <div id="aezoon-footer">${WIDGET_CONFIG.poweredBy}</div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(box);

    // Expose send function globally
    window._aezoonSend = sendMessage;
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    buildWidget();
    loadFirebase(async () => {
      await loadAIConfig();
      await loadHistory();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
