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
        <button class="aezoon-human-yes" id="aezoon-human-yes-btn">✅ Yes, connect me</button>
        <button class="aezoon-human-no" id="aezoon-human-no-btn">No thanks</button>
      </div>`;
    msgs.appendChild(card);

    // CSP-safe event listeners
    document.getElementById('aezoon-human-yes-btn')?.addEventListener('click', window._aezoonRequestHuman);
    document.getElementById('aezoon-human-no-btn')?.addEventListener('click', () => {
      document.getElementById('aezoon-human-card')?.remove();
    });
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
    // Inject CSS inline — no separate file needed (Shopify CSP safe)
    if (!document.getElementById('aezoon-widget-css')) {
      const style = document.createElement('style');
      style.id = 'aezoon-widget-css';
      style.textContent = `
#aezoon-widget-btn{position:fixed;bottom:24px;right:24px;width:64px;height:64px;border-radius:50%;background:transparent;border:none;cursor:pointer;padding:0;z-index:99999;transition:transform .25s cubic-bezier(.22,1,.36,1)}
#aezoon-widget-btn:hover{transform:scale(1.1)}
#aezoon-btn-img{width:64px;height:64px;border-radius:50%;object-fit:cover;display:block;filter:drop-shadow(0 4px 14px rgba(14,165,233,.5));transition:filter .25s}
#aezoon-btn-close{display:none;width:64px;height:64px;border-radius:50%;background:#0ea5e9;color:#fff;font-size:22px;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(14,165,233,.45)}
#aezoon-ring1,#aezoon-ring2{position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(14,165,233,.5);animation:aezoonRing 2.2s ease-out infinite;pointer-events:none}
#aezoon-ring2{animation-delay:.8s}
#aezoon-unread-dot{position:absolute;top:2px;right:2px;width:18px;height:18px;background:#ef4444;border-radius:50%;border:2px solid #fff;display:none;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:700;font-family:system-ui,sans-serif}
#aezoon-chat-box{position:fixed;bottom:100px;right:24px;width:370px;height:540px;background:#fff;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;z-index:99998;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#111;border:1px solid rgba(14,165,233,.15)}
#aezoon-chat-box.open{display:flex;animation:aezoonOpen .32s cubic-bezier(.22,1,.36,1) both}
#aezoon-header{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:14px 16px 12px;display:flex;align-items:center;gap:11px;flex-shrink:0;position:relative;overflow:hidden}
#aezoon-header-avatar{width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid rgba(255,255,255,.4)}
#aezoon-header-avatar img{width:100%;height:100%;object-fit:cover}
#aezoon-header-info{flex:1}
#aezoon-header-name{font-weight:700;font-size:14.5px}
#aezoon-header-status{font-size:11.5px;opacity:.9;margin-top:2px;display:flex;align-items:center;gap:5px}
.aezoon-status-dot{width:7px;height:7px;background:#4ade80;border-radius:50%;display:inline-block;animation:aezoonPulse 2s ease-in-out infinite;flex-shrink:0}
#aezoon-close-btn{background:rgba(255,255,255,.15);border:none;color:#fff;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
#aezoon-messages{flex:1;overflow-y:auto;padding:16px 14px 10px;display:flex;flex-direction:column;gap:6px;background:#f0f4f8}
#aezoon-messages::-webkit-scrollbar{width:4px}
#aezoon-messages::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px}
.aezoon-date-sep{text-align:center;margin:4px 0 8px}
.aezoon-date-sep span{background:rgba(255,255,255,.8);color:#64748b;font-size:11px;padding:3px 10px;border-radius:10px}
.aezoon-msg-row{display:flex;align-items:flex-end;gap:7px}
.aezoon-msg-row.user{justify-content:flex-end}
.aezoon-msg-row.bot{justify-content:flex-start}
.aezoon-bot-avatar{width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0;margin-bottom:2px}
.aezoon-bot-avatar img{width:100%;height:100%;object-fit:cover}
.aezoon-bubble{max-width:75%;padding:9px 13px 6px;border-radius:16px;font-size:13.5px;line-height:1.5;word-break:break-word}
.aezoon-bubble.user{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border-bottom-right-radius:4px;box-shadow:0 2px 8px rgba(14,165,233,.3);animation:aezoonBubbleUser .22s cubic-bezier(.22,1,.36,1) both}
.aezoon-bubble.bot{background:#fff;color:#1e293b;border-bottom-left-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.07);border:1px solid #e2e8f0;animation:aezoonBubbleBot .22s cubic-bezier(.22,1,.36,1) both}
.aezoon-bubble-time{font-size:10px;margin-top:4px;display:flex;align-items:center;gap:3px}
.aezoon-bubble.user .aezoon-bubble-time{color:rgba(255,255,255,.65);justify-content:flex-end}
.aezoon-bubble.bot .aezoon-bubble-time{color:#94a3b8}
.aezoon-typing{display:flex;gap:5px;align-items:center;padding:11px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;border-bottom-left-radius:4px;width:fit-content;box-shadow:0 2px 6px rgba(0,0,0,.07)}
.aezoon-dot{width:7px;height:7px;background:#94a3b8;border-radius:50%;animation:aezoonDot 1.3s ease-in-out infinite}
.aezoon-dot:nth-child(2){animation-delay:.18s}
.aezoon-dot:nth-child(3){animation-delay:.36s}
#aezoon-input-area{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 12px;background:#fff;border-top:1px solid #e2e8f0;flex-shrink:0}
#aezoon-input{flex:1;border:1.5px solid #e2e8f0;border-radius:22px;padding:9px 16px;font-size:13.5px;outline:none;resize:none;max-height:80px;min-height:38px;line-height:1.45;font-family:inherit;color:#1e293b;background:#f8fafc;transition:border-color .2s,box-shadow .2s}
#aezoon-input:focus{border-color:#0ea5e9;background:#fff;box-shadow:0 0 0 3px rgba(14,165,233,.12)}
#aezoon-input::placeholder{color:#94a3b8}
#aezoon-send-btn{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#6366f1);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;box-shadow:0 2px 8px rgba(14,165,233,.35);transition:transform .15s}
#aezoon-send-btn:hover{transform:scale(1.08)}
#aezoon-footer{text-align:center;font-size:10.5px;color:#94a3b8;padding:5px 0 8px;background:#fff;border-top:1px solid #f1f5f9;flex-shrink:0}
.aezoon-p{margin:0 0 4px}
.aezoon-list{margin:4px 0;padding-left:4px;list-style:none}
.aezoon-list li{margin-bottom:3px;font-size:13.5px}
ul.aezoon-list li::before{content:'•';margin-right:7px;color:#0ea5e9}
.aezoon-bubble.user ul.aezoon-list li::before{color:rgba(255,255,255,.8)}
ol.aezoon-list{list-style:decimal;padding-left:20px}
.aezoon-human-card{background:linear-gradient(135deg,rgba(14,165,233,.08),rgba(99,102,241,.08));border:1.5px solid rgba(14,165,233,.35);border-radius:14px;padding:12px 14px;margin:4px 0;animation:aezoonBubbleBot .3s ease both}
.aezoon-human-icon{font-size:1.6rem;text-align:center;margin-bottom:6px}
.aezoon-human-text{display:flex;flex-direction:column;gap:2px;margin-bottom:10px;text-align:center}
.aezoon-human-text strong{font-size:13.5px;color:#1e293b}
.aezoon-human-text span{font-size:11.5px;color:#64748b}
.aezoon-human-btns{display:flex;gap:8px}
.aezoon-human-yes{flex:1;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:20px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
.aezoon-human-no{background:#f1f5f9;color:#64748b;border:none;border-radius:20px;padding:8px 12px;font-size:12px;cursor:pointer;font-family:inherit}
.aezoon-agent-bubble{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(5,150,105,.05))!important;border:1.5px solid rgba(16,185,129,.35)!important;color:#1e293b!important}
.aezoon-agent-label{font-size:10px;font-weight:700;color:#10b981;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
@keyframes aezoonRing{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.75);opacity:0}}
@keyframes aezoonOpen{0%{opacity:0;transform:translateY(18px) scale(.95)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes aezoonBubbleUser{0%{opacity:0;transform:translateX(10px) scale(.96)}100%{opacity:1;transform:translateX(0) scale(1)}}
@keyframes aezoonBubbleBot{0%{opacity:0;transform:translateX(-10px) scale(.96)}100%{opacity:1;transform:translateX(0) scale(1)}}
@keyframes aezoonDot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-6px);opacity:1}}
@keyframes aezoonPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
@media(max-width:480px){#aezoon-chat-box{width:calc(100vw - 16px);height:72vh;right:8px;bottom:84px;border-radius:16px}#aezoon-widget-btn{bottom:16px;right:16px}}
      `;
      document.head.appendChild(style);
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
        <button id="aezoon-close-btn" aria-label="Close">✕</button>
      </div>
      <div id="aezoon-messages">
        <div class="aezoon-date-sep"><span>Today</span></div>
      </div>
      <div id="aezoon-input-area">
        <textarea id="aezoon-input" placeholder="${WIDGET_CONFIG.placeholder}" rows="1"></textarea>
        <button id="aezoon-send-btn" aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div id="aezoon-footer">${WIDGET_CONFIG.poweredBy}</div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(box);

    // Event listeners — no inline onclick (Shopify CSP safe)
    document.getElementById('aezoon-close-btn').addEventListener('click', toggleChat);
    document.getElementById('aezoon-send-btn').addEventListener('click', sendMessage);
    document.getElementById('aezoon-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
    });
    document.getElementById('aezoon-input').addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
    });

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
