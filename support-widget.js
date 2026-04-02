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
    storeName: 'Aezoon Store',
    botName: 'Aezoon Support',
    iconUrl: 'https://thumbs.dreamstime.com/b/support-customer-care-icon-elegant-cyan-blue-round-button-support-customer-care-icon-isolated-elegant-cyan-blue-round-button-99714974.jpg',
    welcomeMsg: 'Salam! 👋 Main Aezoon Support hoon. Aapki kaise madad kar sakta hoon?',
    placeholder: 'Apna sawal likhein...',
    poweredBy: 'Powered by Aezoon AI',
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
      // Also load Knowledge Base
      const kbSnap = await db.collection('support_settings').doc('knowledge_base').get();
      if (kbSnap.exists) AI_CONFIG.kb_cards = kbSnap.data().cards || [];
    } catch (e) { console.log('Aezoon: config load error', e); }
  }

  // ── Load existing chat history ────────────────────────────────
  async function loadHistory() {
    try {
      const snap = await db.collection('support_chats').doc(SESSION_ID).get();
      if (snap.exists) {
        const data = snap.data();
        chatHistory = data.messages || [];
        chatHistory.forEach(m => appendBubble(m.role, m.content, m.time, false));
        // Start real-time listener for human replies
        startChatListener();
      } else {
        appendBubble('bot', AI_CONFIG.welcome_msg || WIDGET_CONFIG.welcomeMsg, getTime(), false);
        startChatListener();
      }
      scrollBottom();
    } catch (e) {
      appendBubble('bot', WIDGET_CONFIG.welcomeMsg, getTime(), false);
    }
  }

  // ── Real-time listener for human replies ──────────────────────
  let lastMsgCount = 0;
  function startChatListener() {
    db.collection('support_chats').doc(SESSION_ID)
      .onSnapshot(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        const msgs = data.messages || [];

        // Sync human mode state
        isHumanModeActive = data.human_mode || false;

        // Update header status
        const statusEl = document.getElementById('aezoon-header-status');
        if (statusEl) {
          if (isHumanModeActive) {
            statusEl.innerHTML = `<span class="aezoon-status-dot" style="background:#10b981;"></span> Support Agent is here`;
          } else {
            statusEl.innerHTML = `<span class="aezoon-status-dot"></span> Online — Replies instantly`;
          }
        }

        // Check for new human_agent messages
        if (msgs.length > lastMsgCount) {
          const newMsgs = msgs.slice(lastMsgCount);
          newMsgs.forEach(m => {
            if (m.role === 'human_agent') {
              appendHumanAgentBubble(m.content, m.time, m.agent_name);
              if (!chatOpen) {
                const dot = document.getElementById('aezoon-unread-dot');
                if (dot) { dot.style.display = 'flex'; }
              }
            }
          });
          lastMsgCount = msgs.length;
        }
      });
    lastMsgCount = chatHistory.length;
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
    const basePrompt = `You are a friendly, professional customer support AI for ${WIDGET_CONFIG.storeName}.

LANGUAGE RULE (MOST IMPORTANT):
- First message is always in English from you
- From the user's SECOND message onwards, detect their language automatically
- Supported: English, Urdu, Roman Urdu, Arabic, and any other language
- Always reply in the EXACT same language the user wrote in — never switch

FORMATTING RULES (always follow):
- Use bullet points (•) for lists of features, steps, or options
- Use numbered lists (1. 2. 3.) for step-by-step instructions
- Use **bold** for important words, product names, prices
- Keep answers short and clear — max 4-5 lines unless detail is needed
- Never write long paragraphs — break into bullets

HUMAN ESCALATION RULE (very important):
- If the user has a complex issue you cannot fully resolve (e.g. payment failed, order missing, refund dispute, account problem, urgent complaint), add [[HUMAN_NEEDED]] at the very END of your reply — nothing after it
- Only add [[HUMAN_NEEDED]] when the issue genuinely needs a human — not for simple questions
- Example: "I'm sorry about this issue with your order. Let me explain what I know... [[HUMAN_NEEDED]]"

BEHAVIOR:
- Be warm, helpful, and concise
- If you don't know something, say so honestly and offer to help further
- Never make up prices, policies, or product details not in your knowledge`;

    const systemPrompt = AI_CONFIG.system_prompt
      ? basePrompt + '\n\nSTORE SPECIFIC INFO:\n' + AI_CONFIG.system_prompt
      : basePrompt;

    // ── RAG: Find relevant KB cards ───────────────────────────
    let kbContext = '';
    const kbCards = AI_CONFIG.kb_cards || [];
    if (kbCards.length) {
      const relevant = findRelevantKBCards(userMsg, kbCards);
      if (relevant.length) {
        kbContext = '\n\n--- RELEVANT KNOWLEDGE BASE ---\n';
        relevant.forEach(c => {
          kbContext += `\n[${c.icon || '📄'} ${c.name}]\n${c.content}\n`;
        });
        kbContext += '\n--- USE ABOVE INFO TO ANSWER ---';
      }
    }

    const finalPrompt = systemPrompt + kbContext;

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
          systemInstruction: { parts: [{ text: finalPrompt }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates[0].content.parts[0].text;
    } else {
      const msgs = [
        { role: 'system', content: finalPrompt },
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

  // ── RAG: Find relevant KB cards ───────────────────────────────
  function findRelevantKBCards(userMsg, cards) {
    const msg = userMsg.toLowerCase();
    const scored = cards.map(card => {
      let score = 0;
      const keywords = (card.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
      const name = (card.name || '').toLowerCase();
      keywords.forEach(kw => {
        if (kw && msg.includes(kw)) score += 10;
        if (kw && kw.length > 3 && msg.split(' ').some(w => w.includes(kw) || kw.includes(w))) score += 3;
      });
      name.split(' ').forEach(w => { if (w.length > 2 && msg.includes(w)) score += 4; });
      return { ...card, score };
    });
    return scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  }

  let isHumanModeActive = false; // synced from Firestore listener

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

    // If human agent is active — just save, no AI reply
    if (isHumanModeActive) {
      await saveChat();
      return;
    }

    showTyping();
    isTyping = true;

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

      // Check if AI flagged this as a complex issue needing human
      if (reply.includes('[[HUMAN_NEEDED]]')) {
        const cleanReply = reply.replace('[[HUMAN_NEEDED]]', '').trim();
        // Replace last bubble with clean text
        const bubbles = document.querySelectorAll('#aezoon-messages .aezoon-bubble.bot');
        if (bubbles.length) bubbles[bubbles.length - 1].querySelector('.aezoon-p, p')?.remove();
        showHumanSupportOffer(cleanReply);
      }
    } catch (e) {
      hideTyping();
      isTyping = false;
      appendBubble('bot', '❌ Error: ' + e.message, getTime(), true);
    }
  }

  // ── Human Support Offer ───────────────────────────────────────
  function showHumanSupportOffer(aiMsg) {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs) return;

    // Show AI message first
    const msgRow = document.createElement('div');
    msgRow.className = 'aezoon-msg-row bot';
    msgRow.innerHTML = `
      <div class="aezoon-bot-avatar"><img src="${WIDGET_CONFIG.iconUrl}" alt="Support"></div>
      <div class="aezoon-bubble bot">
        ${formatMessage(aiMsg)}
        <div class="aezoon-bubble-time">${getTime()}</div>
      </div>`;
    msgs.appendChild(msgRow);

    // Show human connect card
    const card = document.createElement('div');
    card.className = 'aezoon-human-card';
    card.id = 'aezoon-human-card';
    card.innerHTML = `
      <div class="aezoon-human-icon">👨‍💼</div>
      <div class="aezoon-human-text">
        <strong>Connect with a human?</strong>
        <span>Our support team will reply shortly</span>
      </div>
      <div class="aezoon-human-btns">
        <button class="aezoon-human-yes" onclick="window._aezoonRequestHuman()">✅ Yes, connect me</button>
        <button class="aezoon-human-no" onclick="this.closest('.aezoon-human-card').remove()">No thanks</button>
      </div>`;
    msgs.appendChild(card);
    scrollBottom();
  }

  // ── Request Human Support ─────────────────────────────────────
  window._aezoonRequestHuman = async function () {
    const card = document.getElementById('aezoon-human-card');
    if (card) {
      card.innerHTML = `<div style="text-align:center;padding:0.5rem;color:#0ea5e9;font-size:0.85rem;">
        ⏳ Connecting you to our support team... We'll reply soon!
      </div>`;
    }

    try {
      // Save human request to Firestore — dashboard will pick this up
      await db.collection('support_chats').doc(SESSION_ID).set({
        session_id: SESSION_ID,
        store: WIDGET_CONFIG.storeName,
        page: window.location.href,
        updated_at: Date.now(),
        human_requested: true,
        human_requested_at: Date.now(),
        messages: chatHistory.slice(-40),
        unread: 999 // force unread badge
      }, { merge: true });

      // Also write to a dedicated alerts collection for dashboard
      await db.collection('support_alerts').add({
        type: 'human_requested',
        session_id: SESSION_ID,
        page: window.location.href,
        store: WIDGET_CONFIG.storeName,
        created_at: Date.now(),
        read: false
      });

      setTimeout(() => {
        if (card) card.remove();
        appendBubble('bot', '✅ Done! A human agent has been notified. Please wait — we\'ll reply here shortly.', getTime(), true);
      }, 1500);
    } catch (e) {
      appendBubble('bot', '❌ Could not connect. Please try again.', getTime(), true);
    }
  };

  // ── DOM Helpers ───────────────────────────────────────────────
  function appendBubble(role, text, time, animate) {
    if (role === 'human_agent') { appendHumanAgentBubble(text, time); return; }
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs) return;
    const row = document.createElement('div');
    row.className = 'aezoon-msg-row ' + (role === 'user' ? 'user' : 'bot');
    const formatted = formatMessage(text);

    if (role === 'bot') {
      row.innerHTML = `
        <div class="aezoon-bot-avatar"><img src="${WIDGET_CONFIG.iconUrl}" alt="Support"></div>
        <div class="aezoon-bubble bot">${formatted}
          <div class="aezoon-bubble-time">${time}</div>
        </div>`;
    } else {
      row.innerHTML = `
        <div class="aezoon-bubble user">${formatted}
          <div class="aezoon-bubble-time">${time} ✓✓</div>
        </div>`;
    }
    msgs.appendChild(row);
    scrollBottom();
  }

  // ── Markdown-to-HTML formatter ────────────────────────────────
  function formatMessage(text) {
    if (!text) return '';
    const lines = text.split('\n');
    let html = '';
    let inUl = false;
    let inOl = false;

    lines.forEach(line => {
      const trimmed = line.trim();

      // Numbered list: "1. " or "1) "
      const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
      // Bullet list: "- ", "* ", "• "
      const ulMatch = trimmed.match(/^[-*•]\s+(.+)/);

      if (olMatch) {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (!inOl) { html += '<ol class="aezoon-list">'; inOl = true; }
        html += `<li>${inlineFormat(olMatch[2])}</li>`;
      } else if (ulMatch) {
        if (inOl) { html += '</ol>'; inOl = false; }
        if (!inUl) { html += '<ul class="aezoon-list">'; inUl = true; }
        html += `<li>${inlineFormat(ulMatch[1])}</li>`;
      } else {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (inOl) { html += '</ol>'; inOl = false; }
        if (trimmed === '') {
          html += '<br>';
        } else {
          html += `<p class="aezoon-p">${inlineFormat(trimmed)}</p>`;
        }
      }
    });

    if (inUl) html += '</ul>';
    if (inOl) html += '</ol>';
    return html;
  }

  function inlineFormat(str) {
    return str
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }

  // ── Human Agent Bubble ────────────────────────────────────────
  function appendHumanAgentBubble(text, time, agentName) {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs) return;
    const row = document.createElement('div');
    row.className = 'aezoon-msg-row bot';
    const formatted = formatMessage(text);
    row.innerHTML = `
      <div class="aezoon-bot-avatar" style="background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">👨‍💼</div>
      <div class="aezoon-bubble bot aezoon-agent-bubble">
        <div class="aezoon-agent-label">${agentName || 'Support Agent'}</div>
        ${formatted}
        <div class="aezoon-bubble-time">${time || getTime()}</div>
      </div>`;
    row.style.animation = 'bubbleInBot 0.25s ease both';
    msgs.appendChild(row);
    scrollBottom();
  }

  function showTyping() {    const msgs = document.getElementById('aezoon-messages');
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
    const btnImg = document.getElementById('aezoon-btn-img');
    const btnClose = document.getElementById('aezoon-btn-close');
    if (chatOpen) {
      box.classList.add('open');
      if (btnImg) btnImg.style.display = 'none';
      if (btnClose) btnClose.style.display = 'flex';
      document.getElementById('aezoon-unread-dot').style.display = 'none';
      setTimeout(() => document.getElementById('aezoon-input')?.focus(), 300);
    } else {
      box.classList.remove('open');
      if (btnImg) btnImg.style.display = 'block';
      if (btnClose) btnClose.style.display = 'none';
    }
  }

  // ── Build Widget HTML ─────────────────────────────────────────
  function buildWidget() {
    // CSS
    if (!document.getElementById('aezoon-widget-css')) {
      const link = document.createElement('link');
      link.id = 'aezoon-widget-css';
      link.rel = 'stylesheet';
      const scripts = document.querySelectorAll('script[src*="support-widget"]');
      const base = scripts.length ? scripts[scripts.length - 1].src.replace('support-widget.js', '') : '';
      link.href = base + 'support-widget.css';
      document.head.appendChild(link);
    }

    // Widget button — image icon + close X
    const btn = document.createElement('button');
    btn.id = 'aezoon-widget-btn';
    btn.setAttribute('aria-label', 'Open support chat');
    btn.innerHTML = `
      <span id="aezoon-ring1"></span>
      <span id="aezoon-ring2"></span>
      <img id="aezoon-btn-img" src="${WIDGET_CONFIG.iconUrl}" alt="Support">
      <span id="aezoon-btn-close">✕</span>
      <span id="aezoon-unread-dot"></span>`;
    btn.onclick = toggleChat;

    // Chat box
    const box = document.createElement('div');
    box.id = 'aezoon-chat-box';
    box.innerHTML = `
      <div id="aezoon-header">
        <div id="aezoon-header-avatar">
          <img src="${WIDGET_CONFIG.iconUrl}" alt="Support">
        </div>
        <div id="aezoon-header-info">
          <div id="aezoon-header-name">${WIDGET_CONFIG.botName}</div>
          <div id="aezoon-header-status">
            <span class="aezoon-status-dot"></span> Online — Replies instantly
          </div>
        </div>
        <button id="aezoon-close-btn" onclick="document.getElementById('aezoon-widget-btn').click()" aria-label="Close">✕</button>
      </div>
      <div id="aezoon-messages">
        <div class="aezoon-date-sep"><span>Today</span></div>
      </div>
      <div id="aezoon-input-area">
        <textarea id="aezoon-input" placeholder="${WIDGET_CONFIG.placeholder}" rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window._aezoonSend()}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
        <button id="aezoon-send-btn" onclick="window._aezoonSend()" aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div id="aezoon-footer">${WIDGET_CONFIG.poweredBy}</div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(box);
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
