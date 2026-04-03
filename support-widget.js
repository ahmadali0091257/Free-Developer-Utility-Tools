/**
 * Aezoon Customer Support Widget v3.0
 * No external dependencies — works on Shopify, any website
 * Add to Shopify theme.liquid before </body>:
 *   <script src="YOUR_GITHUB_URL/support-widget.js"></script>
 */

(function () {
  'use strict';

  console.log('[Aezoon] Widget v3.0 loading...');

  // ── CONFIG ────────────────────────────────────────────────────
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
  // ── Session ID — localStorage safe with fallback ─────────────
  function getSessionId() {
    try {
      let id = localStorage.getItem('aezoon_session');
      if (!id) {
        id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem('aezoon_session', id);
      }
      return 'aezoon_' + id;
    } catch (e) {
      // localStorage blocked (Shopify sandbox) — use in-memory ID
      if (!window._aezoonSessionId) {
        window._aezoonSessionId = 'aezoon_sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      }
      return window._aezoonSessionId;
    }
  }
  const SESSION_ID = getSessionId();

  let db = null;
  let AI_CONFIG = { model: 'gemini-1.5-flash', api_key: '', system_prompt: '' };
  let chatHistory = [];
  let isTyping = false;
  let chatOpen = false;
  // isHumanModeActive declared later near sendMessage

  // ── AI Memory — visitor ka naam, language, preferences ────────
  const AI_MEMORY = {
    name: null,
    language: null,
    sentiment: null,
    email: null,
    topics: [],
    messageCount: 0,
    sessionStart: Date.now()
  };

  // ── Human timeout tracker ─────────────────────────────────────
  let humanTimeoutTimer = null;
  const HUMAN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  // ── Firebase REST API — no SDK, no CSP issues ────────────────
  const FB_PROJECT = WIDGET_CONFIG.firebaseConfig.projectId;
  const FB_KEY = WIDGET_CONFIG.firebaseConfig.apiKey;
  const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

  async function fbGet(col, docId) {
    try {
      const r = await fetch(`${FB_BASE}/${col}/${docId}?key=${FB_KEY}`);
      if (!r.ok) return null;
      return fbParse((await r.json()).fields || {});
    } catch(e) { return null; }
  }

  async function fbSet(col, docId, obj) {
    try {
      await fetch(`${FB_BASE}/${col}/${docId}?key=${FB_KEY}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ fields: fbEncode(obj) })
      });
    } catch(e) { /* silent */ }
  }

  function fbParse(fields) {
    const r = {};
    for (const [k,v] of Object.entries(fields)) r[k] = fbVal(v);
    return r;
  }
  function fbVal(v) {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return parseInt(v.integerValue);
    if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.arrayValue) return (v.arrayValue.values||[]).map(fbVal);
    if (v.mapValue) return fbParse(v.mapValue.fields||{});
    return null;
  }
  function fbEncode(obj) {
    const f = {};
    for (const [k,v] of Object.entries(obj)) f[k] = fbEncVal(v);
    return f;
  }
  function fbEncVal(v) {
    if (v === null || v === undefined) return {nullValue:null};
    if (typeof v === 'string') return {stringValue:v};
    if (typeof v === 'boolean') return {booleanValue:v};
    if (typeof v === 'number') return Number.isInteger(v) ? {integerValue:String(v)} : {doubleValue:v};
    if (Array.isArray(v)) return {arrayValue:{values:v.map(fbEncVal)}};
    if (typeof v === 'object') return {mapValue:{fields:fbEncode(v)}};
    return {stringValue:String(v)};
  }

  // ── Load AI Config ────────────────────────────────────────────
  async function loadAIConfig() {
    const config = await fbGet('support_settings', 'config');
    if (config) AI_CONFIG = { ...AI_CONFIG, ...config };
    const kb = await fbGet('support_settings', 'knowledge_base');
    if (kb && kb.cards) AI_CONFIG.kb_cards = kb.cards;
  }

  // ── Load History ──────────────────────────────────────────────
  async function loadHistory() {
    const data = await fbGet('support_chats', SESSION_ID);
    if (data && data.messages) {
      chatHistory = data.messages;
      chatHistory.forEach(m => appendBubble(m.role, m.content, m.time, false));
      // FIX: restore AI memory from Firestore so page refresh pe naam/language na bhule
      if (data.ai_memory) {
        Object.assign(AI_MEMORY, data.ai_memory);
      }
    } else {
      appendBubble('bot', AI_CONFIG.welcome_msg || WIDGET_CONFIG.welcomeMsg, getTime(), false);
    }
    scrollBottom();
    startChatListener();
  }

  // ── Poll for human replies every 8s ──────────────────────────
  let lastMsgCount = 0;
  let chatPollInterval = null; // FIX: track interval so we can clear it

  function startChatListener() {
    lastMsgCount = chatHistory.length;
    // FIX: clear any existing interval before starting new one (prevents duplicate loops)
    if (chatPollInterval) clearInterval(chatPollInterval);
    chatPollInterval = setInterval(async () => {
      const data = await fbGet('support_chats', SESSION_ID);
      if (!data) return;
      const msgs = data.messages || [];
      isHumanModeActive = data.human_mode || false;
      const statusEl = document.getElementById('aezoon-header-status');
      if (statusEl) statusEl.innerHTML = isHumanModeActive
        ? `<span class="aezoon-status-dot" style="background:#10b981;"></span> Support Agent is here`
        : `<span class="aezoon-status-dot"></span> Online — Replies instantly`;
      if (msgs.length > lastMsgCount) {
        msgs.slice(lastMsgCount).forEach(m => {
          if (m.role === 'human_agent') {
            chatHistory.push(m); // FIX: push to history so it doesn't get lost on next save
            appendHumanAgentBubble(m.content, m.time, m.agent_name);
            // Human replied — cancel email timer
            clearTimeout(humanEmailTimer);
            if (!chatOpen) { const d = document.getElementById('aezoon-unread-dot'); if(d) d.style.display='flex'; }
          }
        });
        lastMsgCount = msgs.length;
      }
    }, 8000);
  }

  // ── Save Chat ─────────────────────────────────────────────────
  async function saveChat() {
    await fbSet('support_chats', SESSION_ID, {
      session_id: SESSION_ID,
      store: WIDGET_CONFIG.storeName,
      page: window.location.href,
      updated_at: Date.now(),
      messages: chatHistory.slice(-40)
    });
  }

  // ── AI Call ───────────────────────────────────────────────────
  async function callAI(userMsg) {
    const model = AI_CONFIG.model || 'gemini-1.5-flash';
    const key = AI_CONFIG.api_key || '';
    if (!key) return 'Sorry, AI abhi available nahi hai. Please baad mein try karein.';

    // Build memory context
    const memCtx = AI_MEMORY.name || AI_MEMORY.language || AI_MEMORY.topics.length
      ? `\n\nVISITOR MEMORY:\n- Name: ${AI_MEMORY.name || 'unknown'}\n- Language: ${AI_MEMORY.language || 'detecting'}\n- Mood: ${AI_MEMORY.sentiment || 'neutral'}\n- Topics discussed: ${AI_MEMORY.topics.slice(-5).join(', ') || 'none'}\n- Messages sent: ${AI_MEMORY.messageCount}`
      : '';

    const basePrompt = `You are a friendly, professional customer support AI for ${WIDGET_CONFIG.storeName}.

LANGUAGE RULE (MOST IMPORTANT):
- First message is always in English from you
- From the user's SECOND message onwards, detect their language automatically
- Supported: English, Urdu, Roman Urdu, Arabic, and any other language
- Always reply in the EXACT same language the user wrote in — never switch

MEMORY RULES:
- Remember the visitor's name if they mention it — use it naturally in replies
- Remember their language and always respond in it
- Remember what topics they asked about — don't repeat info already given
- If visitor seems frustrated, be extra empathetic

FORMATTING RULES:
- Use bullet points (•) for lists
- Use numbered lists (1. 2. 3.) for steps
- Use **bold** for important words
- Keep answers short — max 4-5 lines
- Never write long paragraphs

ANSWER QUALITY RULES:
- If KB card has the answer → use ONLY that info, be specific and accurate
- If no KB card matches → give a helpful general answer, never make up specifics
- If visitor asks for order status → ask for their order number first
- If visitor is angry (mood: angry) → start with empathy: "I understand your frustration..."
- Never say "I don't have access to your order" without offering an alternative
- Always end with: "Kuch aur poochna hai?" or equivalent in visitor's language

HUMAN ESCALATION RULE:
- Complex issues (payment failed, order missing, refund dispute, urgent complaint) → add [[HUMAN_NEEDED]] at the very END
- Only for genuine complex issues, not simple questions

BEHAVIOR:
- Be warm, helpful, concise
- If unsure, say so honestly and offer to connect with human
- Never make up prices, policies, or product details`;

    const systemPrompt = (AI_CONFIG.system_prompt
      ? basePrompt + '\n\nSTORE SPECIFIC INFO:\n' + AI_CONFIG.system_prompt
      : basePrompt) + memCtx;

    // ── IMPROVED RAG: Find relevant KB cards ─────────────────
    let kbContext = '';
    const kbCards = AI_CONFIG.kb_cards || [];
    if (kbCards.length) {
      const relevant = findRelevantKBCards(userMsg, kbCards);
      if (relevant.length) {
        kbContext = '\n\n--- KNOWLEDGE BASE (USE THIS TO ANSWER) ---\n';
        relevant.forEach(c => {
          kbContext += `\n[${c.icon || '📄'} ${c.name}]\n${c.content}\n`;
        });
        kbContext += '\n--- IMPORTANT: Answer based on above KB info only. Do not add info not in KB. ---';
      } else {
        // IMPROVEMENT: Agar koi KB card match nahi hua toh AI ko batao
        kbContext = '\n\n--- NOTE: No specific KB card found for this question. Give a helpful general answer and offer human support if needed. ---';
      }
    }

    const finalPrompt = systemPrompt + kbContext;

    // IMPROVEMENT: Last 10 messages history (pehle 8 tha)
    const history = chatHistory.slice(-10);

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
          // IMPROVEMENT: temperature thoda kam — zyada accurate answers
          generationConfig: { temperature: 0.5, maxOutputTokens: 600 }
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
        body: JSON.stringify({ model, messages: msgs, max_tokens: 600, temperature: 0.5 })
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

  let isHumanModeActive = false; // synced from Firestore listener — declared once here

  // ── Send Message ──────────────────────────────────────────────
  let lastMsgTime = 0; // FIX: rate limiting — spam se bachao
  async function sendMessage() {
    if (isTyping) return;
    // FIX: 2 second cooldown between messages
    if (Date.now() - lastMsgTime < 2000) return;
    lastMsgTime = Date.now();
    const input = document.getElementById('aezoon-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    const msgTime = getTime();
    chatHistory.push({ role: 'user', content: text, time: msgTime });
    appendBubble('user', text, msgTime, true);

    // If human agent is active — just save, no AI reply
    if (isHumanModeActive) {
      await saveChat();
      return;
    }

    showTyping();
    isTyping = true;

    // IMPROVEMENT: Complex question detect karo — deep thinking mode
    const isComplexQuestion = text.split(' ').length > 8 ||
      /\b(explain|compare|difference|why|how does|what happens|detail|step by step|process|kaise|kyun|farq|samjhao|detail mein|tafseel)\b/i.test(text);

    try {
      // Deep thinking indicator for complex questions
      if (isComplexQuestion) {
        hideTyping();
        showDeepThinking();
      }

      const reply = await callAI(text);

      hideTyping();
      hideDeepThinking();
      isTyping = false;
      chatHistory.push({ role: 'assistant', content: reply, time: getTime() });

      // IMPROVEMENT: Typewriter effect for bot replies (no extra Firebase reads)
      appendBubbleTypewriter('bot', reply, getTime());

      // Update AI memory
      updateMemory(text, reply);
      saveChat();
      saveChatWithMemory();

      // Auto-detect if AI couldn't answer properly → trigger human offer
      const uncertainPhrases = [
        "i don't know", "i'm not sure", "i cannot", "i can't", "not sure",
        "unable to", "don't have information", "no information",
        "mujhe nahi pata", "mujhe maloom nahi", "pata nahi", "nahi pata",
        "معلوم نہیں", "نہیں جانتا", "لا أعرف", "لا أعلم"
      ];
      const replyLower = reply.toLowerCase();
      const aiUncertain = uncertainPhrases.some(p => replyLower.includes(p));

      // Check if AI flagged complex issue OR is uncertain
      const needsHuman = reply.includes('[[HUMAN_NEEDED]]') || aiUncertain;

      if (needsHuman) {
        const cleanReply = reply.replace('[[HUMAN_NEEDED]]', '').trim();
        const bubbles = document.querySelectorAll('#aezoon-messages .aezoon-bubble.bot');
        if (bubbles.length) {
          const last = bubbles[bubbles.length - 1];
          last.innerHTML = formatMessage(cleanReply) + `<div class="aezoon-bubble-time">${getTime()}</div>`;
        }
        // Small delay so user reads AI reply first
        setTimeout(() => showHumanSupportOffer(cleanReply), 800);
      }
    } catch (e) {
      hideTyping();
      hideDeepThinking();
      isTyping = false;
      appendBubble('bot', '❌ Error: ' + e.message, getTime(), true);
    }
  }

  // ── Deep Thinking Indicator ───────────────────────────────────
  function showDeepThinking() {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs || document.getElementById('aezoon-thinking-row')) return;
    const el = document.createElement('div');
    el.id = 'aezoon-thinking-row';
    el.className = 'aezoon-msg-row bot';
    el.innerHTML = `
      <div class="aezoon-bot-avatar"><img src="${WIDGET_CONFIG.iconUrl}" alt="Support"></div>
      <div class="aezoon-thinking-bubble">
        <div class="aezoon-think-spinner"></div>
        <span id="aezoon-think-text">Thinking deeply...</span>
      </div>`;
    msgs.appendChild(el);
    scrollBottom();
    // Cycle through thinking messages
    const thinkMsgs = ['Thinking deeply...', 'Analyzing your question...', 'Finding the best answer...', 'Almost ready...'];
    let i = 0;
    el._thinkInterval = setInterval(() => {
      i = (i + 1) % thinkMsgs.length;
      const t = document.getElementById('aezoon-think-text');
      if (t) t.textContent = thinkMsgs[i];
    }, 1800);
  }

  function hideDeepThinking() {
    const el = document.getElementById('aezoon-thinking-row');
    if (el) { clearInterval(el._thinkInterval); el.remove(); }
  }

  // ── Typewriter Effect — no Firebase, pure DOM ─────────────────
  function appendBubbleTypewriter(role, text, time) {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs) return;
    const row = document.createElement('div');
    row.className = 'aezoon-msg-row bot';
    row.innerHTML = `
      <div class="aezoon-bot-avatar"><img src="${WIDGET_CONFIG.iconUrl}" alt="Support"></div>
      <div class="aezoon-bubble bot">
        <span class="aezoon-typewriter-text"></span><span class="aezoon-cursor">▋</span>
        <div class="aezoon-bubble-time" style="display:none;">${time} ✓</div>
      </div>`;
    msgs.appendChild(row);
    scrollBottom();

    const textEl = row.querySelector('.aezoon-typewriter-text');
    const cursor = row.querySelector('.aezoon-cursor');
    const timeEl = row.querySelector('.aezoon-bubble-time');

    // Clean text for display (remove [[HUMAN_NEEDED]])
    const cleanText = text.replace(/\[\[HUMAN_NEEDED\]\]/g, '').trim();
    const formatted = formatMessage(cleanText);

    // For short messages — instant render, no typewriter
    if (cleanText.length < 80) {
      textEl.innerHTML = formatted;
      cursor.remove();
      timeEl.style.display = 'flex';
      scrollBottom();
      return;
    }

    // Typewriter: render word by word (faster than char by char)
    const words = cleanText.split(' ');
    let i = 0;
    const speed = Math.max(18, Math.min(45, 2000 / words.length)); // adaptive speed

    const interval = setInterval(() => {
      i++;
      textEl.innerHTML = formatMessage(words.slice(0, i).join(' '));
      scrollBottom();
      if (i >= words.length) {
        clearInterval(interval);
        cursor.remove();
        timeEl.style.display = 'flex';
      }
    }, speed);
  }

  // ── AI Memory Update ──────────────────────────────────────────
  function updateMemory(userMsg, aiReply) {
    AI_MEMORY.messageCount++;

    // Detect name — "my name is X" / "I am X" / "mera naam X hai"
    const nameMatch = userMsg.match(/(?:my name is|i am|i'm|mera naam|main hoon)\s+([A-Za-z]+)/i);
    if (nameMatch) AI_MEMORY.name = nameMatch[1];

    // Detect language from user message
    const hasUrdu = /[\u0600-\u06FF]/.test(userMsg);
    const hasArabic = /[\u0621-\u064A]/.test(userMsg);
    const romanUrduWords = /\b(hai|hain|kya|mera|meri|aap|yeh|woh|karo|kare|nahi|bhi|aur|se|ko|ka|ki|ke)\b/i.test(userMsg);
    if (hasUrdu) AI_MEMORY.language = 'Urdu';
    else if (hasArabic) AI_MEMORY.language = 'Arabic';
    else if (romanUrduWords) AI_MEMORY.language = 'Roman Urdu';
    else if (AI_MEMORY.messageCount > 1) AI_MEMORY.language = AI_MEMORY.language || 'English';

    // Detect sentiment
    const angryWords = /\b(angry|frustrated|terrible|worst|useless|refund|scam|fraud|cheated|problem|issue|complaint)\b/i.test(userMsg);
    const happyWords = /\b(thanks|thank you|great|awesome|perfect|love|excellent|shukriya|jazakallah)\b/i.test(userMsg);
    if (angryWords) AI_MEMORY.sentiment = 'angry';
    else if (happyWords) AI_MEMORY.sentiment = 'happy';

    // Track topics
    const topicKeywords = ['shipping', 'return', 'refund', 'order', 'payment', 'product', 'delivery', 'cancel', 'track'];
    topicKeywords.forEach(t => { if (userMsg.toLowerCase().includes(t) && !AI_MEMORY.topics.includes(t)) AI_MEMORY.topics.push(t); });
  }

  // ── Collect visitor device/browser info ──────────────────────
  function getVisitorInfo() {
    const ua = navigator.userAgent;
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : ua.includes('Edge') ? 'Edge' : 'Unknown';
    const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('iPhone') ? 'iPhone' : ua.includes('Android') ? 'Android' : ua.includes('Linux') ? 'Linux' : 'Unknown';
    const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
    const lang = navigator.language || 'Unknown';
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    // Derive country from timezone (basic)
    const tzCountry = tz.split('/')[0] || '';
    return { browser, os, device, lang, timezone: tz, country: tzCountry, screen: `${screen.width}x${screen.height}` };
  }

  const VISITOR_INFO = getVisitorInfo();

  async function saveChatWithMemory() {
    try {
      await fbSet('support_chats', SESSION_ID, {
        session_id: SESSION_ID,
        store: WIDGET_CONFIG.storeName,
        page: window.location.href,
        updated_at: Date.now(),
        messages: chatHistory.slice(-40),
        ai_memory: AI_MEMORY,
        sentiment: AI_MEMORY.sentiment || '',
        visitor_info: VISITOR_INFO  // device/browser info
      });
    } catch(e) {}
  }

  // ── Human Timeout → replaced by 1-min timer in _aezoonRequestHuman ──
  function resetHumanTimeout() { /* no-op — handled by humanEmailTimer */ }

  function showEmailCollectionForm() {
    const msgs = document.getElementById('aezoon-messages');
    if (!msgs || document.getElementById('aezoon-email-form')) return;

    const form = document.createElement('div');
    form.id = 'aezoon-email-form';
    form.className = 'aezoon-email-card';
    form.innerHTML = `
      <div class="aezoon-email-icon">📧</div>
      <div class="aezoon-email-title">Our team will get back to you!</div>
      <div class="aezoon-email-sub">Please enter your email — we'll reply within 24 hours.</div>
      <input class="aezoon-email-inp" id="aezoon-email-inp" type="email" placeholder="your@email.com">
      <div class="aezoon-email-btns">
        <button class="aezoon-email-submit" id="aezoon-email-submit-btn">📨 Submit</button>
        <button class="aezoon-email-cancel" id="aezoon-email-cancel-btn">Cancel</button>
      </div>
      <div class="aezoon-email-status" id="aezoon-email-status"></div>`;
    msgs.appendChild(form);
    scrollBottom();

    document.getElementById('aezoon-email-submit-btn').addEventListener('click', submitEmailRequest);
    document.getElementById('aezoon-email-cancel-btn').addEventListener('click', () => form.remove());
  }

  async function submitEmailRequest() {
    const emailInp = document.getElementById('aezoon-email-inp');
    const email = emailInp?.value.trim();
    const statusEl = document.getElementById('aezoon-email-status');
    if (!email || !email.includes('@')) {
      if (statusEl) statusEl.textContent = '❌ Please enter a valid email';
      return;
    }
    if (statusEl) statusEl.textContent = '⏳ Submitting...';

    // Save email request
    AI_MEMORY.email = email;
    const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user');

    try {
      await fbSet('support_email_requests', 'req_' + Date.now(), {
        email,
        session_id: SESSION_ID,
        page: window.location.href,
        store: WIDGET_CONFIG.storeName,
        issue: lastUserMsg?.content || 'No message',
        language: AI_MEMORY.language || 'unknown',
        visitor_name: AI_MEMORY.name || '',
        status: 'pending',
        created_at: Date.now()
      });
      await saveChatWithMemory();

      if (statusEl) statusEl.textContent = '';
      document.getElementById('aezoon-email-form')?.remove();
      appendBubble('bot',
        `✅ Thank you! We've received your request. Our team will email you at **${email}** within 24 hours with a solution.`,
        getTime(), true);
    } catch(e) {
      if (statusEl) statusEl.textContent = '❌ Error. Please try again.';
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
  let humanEmailTimer = null; // 1 min timer after human connect

  window._aezoonRequestHuman = async function () {
    const card = document.getElementById('aezoon-human-card');
    if (card) card.innerHTML = `<div style="text-align:center;padding:0.5rem;color:#0ea5e9;font-size:0.85rem;">⏳ Connecting you to our support team...</div>`;
    try {
      await fbSet('support_chats', SESSION_ID, {
        session_id: SESSION_ID, store: WIDGET_CONFIG.storeName,
        page: window.location.href, updated_at: Date.now(),
        human_requested: true, human_requested_at: Date.now(),
        messages: chatHistory.slice(-40), unread: 999
      });
      await fbSet('support_alerts', 'alert_' + Date.now(), {
        type: 'human_requested', session_id: SESSION_ID,
        page: window.location.href, store: WIDGET_CONFIG.storeName,
        created_at: Date.now(), read: false
      });
      setTimeout(() => {
        if (card) card.remove();
        appendBubble('bot', "✅ Done! A human agent has been notified. Please wait — we'll reply here shortly.", getTime(), true);
      }, 1500);

      // ── 1 minute timer — if no human reply, show email form ──
      clearTimeout(humanEmailTimer);
      humanEmailTimer = setTimeout(() => {
        // Check if human already replied
        const hasHumanReply = chatHistory.some(m => m.role === 'human_agent');
        if (!hasHumanReply && !document.getElementById('aezoon-email-form')) {
          // Show in user's language
          const lang = AI_MEMORY.language || 'English';
          let msg = '';
          if (lang === 'Urdu' || lang === 'Roman Urdu') {
            msg = 'Hamara agent abhi busy hai. Apna email dein — hum 24 ghante mein jawab denge.';
          } else if (lang === 'Arabic') {
            msg = 'وكيلنا مشغول الآن. أدخل بريدك الإلكتروني وسنرد خلال 24 ساعة.';
          } else {
            msg = 'Our agent is currently busy. Leave your email and we\'ll get back to you within 24 hours.';
          }
          appendBubble('bot', msg, getTime(), true);
          setTimeout(() => showEmailCollectionForm(), 600);
        }
      }, 60 * 1000); // 1 minute

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
      // FIX: restart polling when chat opens (in case it was stopped)
      if (!chatPollInterval) startChatListener();
      setTimeout(() => document.getElementById('aezoon-input')?.focus(), 300);
    } else {
      box.classList.remove('open');
      if (btnImg) btnImg.style.display = 'block';
      if (btnClose) btnClose.style.display = 'none';
      // FIX: stop polling when chat is closed — saves Firestore reads + memory
      if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
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
.aezoon-email-card{background:linear-gradient(135deg,rgba(99,102,241,.08),rgba(14,165,233,.06));border:1.5px solid rgba(99,102,241,.3);border-radius:14px;padding:14px;margin:4px 0;animation:aezoonBubbleBot .3s ease both;text-align:center}
.aezoon-email-icon{font-size:1.8rem;margin-bottom:6px}
.aezoon-email-title{font-size:13.5px;font-weight:700;color:#1e293b;margin-bottom:4px}
.aezoon-email-sub{font-size:11.5px;color:#64748b;margin-bottom:10px}
.aezoon-email-inp{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit;color:#1e293b;background:#f8fafc;margin-bottom:8px;transition:border-color .2s}
.aezoon-email-inp:focus{border-color:#6366f1}
.aezoon-email-btns{display:flex;gap:8px}
.aezoon-email-submit{flex:1;background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;border:none;border-radius:20px;padding:8px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
.aezoon-email-cancel{background:#f1f5f9;color:#64748b;border:none;border-radius:20px;padding:8px 12px;font-size:12px;cursor:pointer;font-family:inherit}
.aezoon-email-status{font-size:11px;color:#ef4444;margin-top:6px;min-height:16px}
@media(max-width:480px){#aezoon-chat-box{width:calc(100vw - 16px);height:72vh;right:8px;bottom:84px;border-radius:16px}#aezoon-widget-btn{bottom:16px;right:16px}}
.aezoon-thinking-bubble{display:flex;align-items:center;gap:8px;padding:9px 14px;background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(139,92,246,.07));border:1px solid rgba(99,102,241,.25);border-radius:14px;border-bottom-left-radius:3px;font-size:12.5px;color:#6366f1;font-weight:500;animation:aezoonBubbleBot .25s ease both}
.aezoon-think-spinner{width:13px;height:13px;border:2px solid rgba(99,102,241,.2);border-top-color:#6366f1;border-radius:50%;animation:aezoonThinkSpin .8s linear infinite;flex-shrink:0}
@keyframes aezoonThinkSpin{to{transform:rotate(360deg)}}
.aezoon-typewriter-text{display:inline;}
.aezoon-cursor{display:inline-block;width:2px;height:0.85em;background:#0ea5e9;margin-left:1px;vertical-align:text-bottom;animation:aezoonBlink .65s step-end infinite;}
@keyframes aezoonBlink{0%,100%{opacity:1}50%{opacity:0}}
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
    console.log('[Aezoon] Widget init started');
    buildWidget();
    loadAIConfig().then(() => loadHistory()).catch(e => {
      console.log('[Aezoon] Config load error:', e);
      appendBubble('bot', WIDGET_CONFIG.welcomeMsg, getTime(), false);
    });
    console.log('[Aezoon] Widget button added to page');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
