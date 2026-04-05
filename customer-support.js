/**
 * customer-support.js — Aezoon Dashboard
 * Customer Support module: live chats, settings, Prompt Upgrade AI
 */

// ── State ─────────────────────────────────────────────────────
let CS_CHATS = [];
let CS_SELECTED_SESSION = null;
let CS_SUPPORT_CONFIG = { model: 'gemini-1.5-flash', api_key: '', system_prompt: '', welcome_msg: '' };
let CS_PROMPT_HISTORY = [];
let CS_PROMPT_TYPING = false;
let CS_UPLOADED_DOCS = []; // { name, content } array of uploaded files
let CS_INIT_DONE = false;
let CS_ALERTS_UNSUB = null;

// ── Init ──────────────────────────────────────────────────────
function initCustomerSupport() {
  if (!CS_INIT_DONE) {
    startSupportChatsSync();
    startAlertsSync();
    requestNotifPermission();
    if (typeof startKBSync === 'function') startKBSync();
    if (typeof startEmailRequestsSync === 'function') startEmailRequestsSync();
    CS_INIT_DONE = true;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  loadSupportConfig();
}

// ── Real-time Firestore sync — limit 7, load more on demand ──
let CS_CHATS_LIMIT = 7;
let CS_CHATS_TOTAL = 0;

function startSupportChatsSync() {
  loadSupportChats();
}

function loadSupportChats(limit) {
  limit = limit || CS_CHATS_LIMIT;
  db.collection('support_chats')
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .onSnapshot(snap => {
      CS_CHATS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (document.getElementById('page-support')?.classList.contains('active')) {
        renderSupportChatList();
        updateSupportStats();
        if (CS_SELECTED_SESSION) {
          const updated = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
          if (updated) renderSupportChatDetail(updated);
        }
      }
    }, err => console.log('Support sync error:', err));
  // Get total count separately (one read)
  db.collection('support_chats').get().then(s => {
    CS_CHATS_TOTAL = s.size;
    renderLoadMoreBtn();
  }).catch(() => {});
}

function loadMoreChats() {
  CS_CHATS_LIMIT += 10;
  loadSupportChats(CS_CHATS_LIMIT);
}

function renderLoadMoreBtn() {
  const el = document.getElementById('csLoadMoreBtn');
  if (!el) return;
  if (CS_CHATS_TOTAL > CS_CHATS.length) {
    el.style.display = 'block';
    el.textContent = `Load More (${CS_CHATS_TOTAL - CS_CHATS.length} more)`;
  } else {
    el.style.display = 'none';
  }
}

async function loadSupportConfig() {
  try {
    const snap = await db.collection('support_settings').doc('config').get();
    if (snap.exists) CS_SUPPORT_CONFIG = { ...CS_SUPPORT_CONFIG, ...snap.data() };
    fillSupportSettingsForm();
  } catch (e) { console.log('Support config load error:', e); }
}

// ── Render Chat List — support-advanced.js has the full version with pinning/sentiment
// This is only used as initial fallback before support-advanced.js loads
var renderSupportChatList = function() {
  const el = document.getElementById('csSidebarList');
  if (!el) return;
  if (!CS_CHATS.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:0.85rem;">No chats yet.</div>`;
    return;
  }
  el.innerHTML = CS_CHATS.map(c => {
    const msgs = c.messages || [];
    const last = msgs[msgs.length - 1];
    const preview = last ? last.content.replace(/\[\[HUMAN_NEEDED\]\]/g,'').substring(0, 45) : 'No messages';
    const isActive = CS_SELECTED_SESSION === c.session_id;
    const unread = c.unread || 0;
    const shortId = (c.session_id || '').replace('aezoon_sess_', '#').substring(0, 12);
    return `<div class="cs-chat-item ${isActive?'active':''}" onclick="selectSupportChat('${c.session_id}')">
      <div class="cs-chat-avatar">${c.human_requested?'🆘':'💬'}</div>
      <div class="cs-chat-info"><div class="cs-chat-name">${shortId}</div><div class="cs-chat-preview">${escHtml(preview)}</div></div>
      <div class="cs-chat-meta"><div class="cs-chat-time">${last?.time||''}</div>${unread>0?`<div class="cs-unread-badge">${unread===999?'!':unread}</div>`:''}</div>
    </div>`;
  }).join('');
};

function updateSupportStats() {
  const total = CS_CHATS.length;
  const today = new Date().toISOString().split('T')[0];
  const todayChats = CS_CHATS.filter(c => new Date(c.updated_at || 0).toISOString().split('T')[0] === today).length;
  const totalMsgs = CS_CHATS.reduce((s, c) => s + (c.messages || []).length, 0);
  // IMPROVEMENT: Human requests count bhi dikhao
  const humanReqs = CS_CHATS.filter(c => c.human_requested && !c.human_mode).length;
  const el = document.getElementById('csSupportStats');
  if (!el) return;
  el.innerHTML = `
    <div class="cs-stat"><div class="cs-stat-val">${total}</div><div class="cs-stat-label">Sessions</div></div>
    <div class="cs-stat"><div class="cs-stat-val">${todayChats}</div><div class="cs-stat-label">Today</div></div>
    <div class="cs-stat"><div class="cs-stat-val">${totalMsgs}</div><div class="cs-stat-label">Messages</div></div>
    ${humanReqs > 0 ? `<div class="cs-stat"><div class="cs-stat-val" style="color:var(--danger);">${humanReqs}</div><div class="cs-stat-label">Need Help</div></div>` : ''}
  `;
}

// ── Select & Render Chat ──────────────────────────────────────
function selectSupportChat(sessionId) {
  CS_SELECTED_SESSION = sessionId;
  const chat = CS_CHATS.find(c => c.session_id === sessionId);
  if (!chat) return;
  db.collection('support_chats').doc(chat.id).update({ unread: 0 }).catch(() => {});
  renderSupportChatList();
  renderSupportChatDetail(chat);
  document.getElementById('csEmptyState').style.display = 'none';
  document.getElementById('csChatMain').style.display = 'flex';
  // Render visitor info if available
  if (typeof renderVisitorInfo === 'function') renderVisitorInfo(chat);
}

function renderSupportChatDetail(chat) {
  const msgs = chat.messages || [];
  const memory = chat.ai_memory || {};
  const shortId = (chat.session_id || '').replace('aezoon_sess_', '#').substring(0, 14);

  // FIX 1: Visitor ka naam show karo agar AI memory mein hai
  const visitorLabel = memory.name ? `👤 ${memory.name}` : 'Visitor ' + shortId;
  document.getElementById('csChatHeaderName').textContent = visitorLabel;

  // FIX 2: Header mein zyada info — language, sentiment bhi
  const sentimentMap = { angry: '😠 Angry', happy: '😊 Happy', confused: '😕 Confused' };
  const sentimentText = memory.sentiment ? ` · ${sentimentMap[memory.sentiment] || memory.sentiment}` : '';
  const langText = memory.language ? ` · 🌐 ${memory.language}` : '';
  document.getElementById('csChatHeaderSub').textContent =
    (chat.page || 'Unknown page') + ' · ' + msgs.length + ' messages' +
    (chat.human_mode ? ' · 👨‍💼 Human Active' : '') + langText + sentimentText;

  // Tag buttons
  const tagBar = document.getElementById('csChatTagBar');
  if (tagBar) {
    const cur = chat.tag || '';
    tagBar.innerHTML = `
      <span style="font-size:0.72rem;color:var(--muted);font-weight:600;">TAG:</span>
      <button class="cs-tag-btn ${cur==='resolved'?'active-resolved':''}" onclick="setChatTag('resolved')">✅ Resolved</button>
      <button class="cs-tag-btn ${cur==='pending'?'active-pending':''}" onclick="setChatTag('pending')">⏳ Pending</button>
      <button class="cs-tag-btn ${cur==='spam'?'active-spam':''}" onclick="setChatTag('spam')">🚫 Spam</button>
      ${cur ? `<button class="cs-tag-btn" onclick="setChatTag('')" style="color:var(--muted);">✕ Clear</button>` : ''}`;
  }

  const container = document.getElementById('csChatMessages');
  if (!container) return;

  // FIX 3: Human requested banner + angry visitor warning
  let topBanners = '';
  if (chat.human_requested) {
    topBanners += `<div class="cs-human-alert-banner">🆘 Visitor ne human support maanga — neeche reply karo</div>`;
  }
  if (memory.sentiment === 'angry') {
    topBanners += `<div class="cs-angry-banner">😠 Visitor naraaz lag raha hai — carefully jawab dena</div>`;
  }

  // FIX 4: Internal notes bhi render karo — pehle invisible the
  container.innerHTML = topBanners + msgs.map(m => {
    const isUser = m.role === 'user';
    const isAgent = m.role === 'human_agent';
    const isNote = m.role === 'internal_note';

    const formatted = (m.content || '')
      .replace(/\[\[HUMAN_NEEDED\]\]/g, '')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>');

    // FIX 4: Internal notes — alag style mein dikhao
    if (isNote) {
      return `<div class="cs-msg-row cs-note-row">
        <div class="cs-internal-note">
          <span class="cs-note-icon">📝</span>
          <span class="cs-note-agent">${escHtml(m.agent || 'Admin')}:</span>
          <span>${escHtml(m.content || '')}</span>
          <span class="cs-bubble-time" style="margin-left:auto;">${m.time || ''}</span>
        </div>
      </div>`;
    }

    if (isAgent) {
      return `<div class="cs-msg-row user">
        <div class="cs-bubble cs-bubble-agent">
          <div class="cs-agent-badge">👨‍💼 ${escHtml(m.agent_name || 'Support Agent')}</div>
          ${formatted}
          <div class="cs-bubble-time">${m.time || ''}</div>
        </div>
      </div>`;
    }
    return `<div class="cs-msg-row ${isUser ? 'user' : 'bot'}">
      <div class="cs-bubble ${isUser ? 'user' : 'bot'}">${formatted}<div class="cs-bubble-time">${m.time || ''}</div></div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;

  // Sync human mode toggle
  const check = document.getElementById('csHumanModeCheck');
  const replyArea = document.getElementById('csHumanReplyArea');
  const label = document.getElementById('csHumanModeLabel');
  const pill = document.getElementById('csModePill');
  const pillIcon = document.getElementById('csModePillIcon');
  const isHuman = chat.human_mode || false;
  CS_HUMAN_MODE = isHuman;
  if (check) check.checked = isHuman;
  if (label) label.textContent = isHuman ? 'Human Mode' : 'AI Mode';
  if (pillIcon) pillIcon.textContent = isHuman ? '👨‍💼' : '🤖';
  if (pill) { isHuman ? pill.classList.add('human-on') : pill.classList.remove('human-on'); }
  if (replyArea) replyArea.style.display = isHuman ? 'flex' : 'none';

  // Update header avatar with visitor initial
  const avatarEl = document.getElementById('csHeaderAvatar');
  if (avatarEl) {
    const initial = memory.name ? memory.name[0].toUpperCase() : shortId.replace('#','')[0] || '?';
    avatarEl.textContent = initial;
  }

  // FIX 5: Human mode auto-ON karo agar visitor ne request kiya tha
  if (chat.human_requested && !isHuman) {
    const replyInp = document.getElementById('csHumanReplyInp');
    if (replyInp) replyInp.placeholder = '⚠️ Visitor ne human support maanga — Human Mode ON karo upar se';
  }
}

function setChatTag(tag) {
  if (!CS_SELECTED_SESSION) return;
  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat) return;
  db.collection('support_chats').doc(chat.id).update({ tag })
    .then(() => toast(tag ? `Tagged: ${tag}` : 'Tag removed', 'success'))
    .catch(e => toast('Error: ' + e.message, 'error'));
}

function deleteSupportChat() {
  if (!CS_SELECTED_SESSION) return;
  if (!confirm('Is chat ko delete karein?')) return;
  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat) return;
  db.collection('support_chats').doc(chat.id).delete()
    .then(() => {
      CS_SELECTED_SESSION = null;
      document.getElementById('csEmptyState').style.display = 'flex';
      document.getElementById('csChatMain').style.display = 'none';
      toast('Chat deleted', 'success');
    }).catch(e => toast('Error: ' + e.message, 'error'));
}

// ── Settings ──────────────────────────────────────────────────
function fillSupportSettingsForm() {
  const c = CS_SUPPORT_CONFIG;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('cs_model', c.model || 'gemini-1.5-flash');
  set('cs_api_key', c.api_key);
  set('cs_system_prompt', c.system_prompt);
  set('cs_welcome_msg', c.welcome_msg);
  updatePromptPreviewCard(c.system_prompt || '');
}

async function saveSupportConfig() {
  const config = {
    model: document.getElementById('cs_model').value,
    api_key: document.getElementById('cs_api_key').value.trim(),
    system_prompt: document.getElementById('cs_system_prompt').value.trim(),
    welcome_msg: document.getElementById('cs_welcome_msg').value.trim(),
    updated_at: Date.now()
  };
  try {
    await db.collection('support_settings').doc('config').set(config);
    CS_SUPPORT_CONFIG = config;
    toast('Support settings saved!', 'success');
    const btn = document.getElementById('csSaveConfigBtn');
    if (btn) { btn.textContent = '✅ Saved!'; setTimeout(() => btn.textContent = '💾 Save Settings', 2000); }
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
// ── PROMPT UPGRADE AI ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── File Upload Handler ───────────────────────────────────────
function handlePromptFileUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  const allowedTypes = ['text/plain', 'text/html', 'application/json', 'text/markdown', 'text/csv', ''];
  let processed = 0;

  files.forEach(file => {
    // Accept text-based files
    if (file.size > 500000) { // 500KB limit per file
      toast(`${file.name} too large (max 500KB)`, 'warning');
      processed++;
      if (processed === files.length) afterFilesLoaded();
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target.result;
      // Remove existing file with same name
      CS_UPLOADED_DOCS = CS_UPLOADED_DOCS.filter(d => d.name !== file.name);
      CS_UPLOADED_DOCS.push({ name: file.name, content: content.substring(0, 8000) }); // cap at 8000 chars
      processed++;
      if (processed === files.length) afterFilesLoaded();
    };
    reader.onerror = () => { processed++; if (processed === files.length) afterFilesLoaded(); };
    reader.readAsText(file);
  });

  // Reset input
  input.value = '';
}

function afterFilesLoaded() {
  renderUploadedDocs();
  // Auto-send analysis message
  const names = CS_UPLOADED_DOCS.map(d => d.name).join(', ');
  const autoMsg = `[FILES_UPLOADED] Mein ne yeh files upload ki hain: ${names}. Inhe analyze karo aur system prompt improve karo.`;
  sendPromptUpgradeMsgInternal(autoMsg, true);
}

function renderUploadedDocs() {
  const el = document.getElementById('csUploadedDocs');
  if (!el) return;
  if (!CS_UPLOADED_DOCS.length) { el.innerHTML = ''; return; }
  el.innerHTML = CS_UPLOADED_DOCS.map((d, i) => `
    <div class="cs-doc-chip">
      <span>📄 ${escHtml(d.name)}</span>
      <button onclick="removeUploadedDoc(${i})" title="Remove">✕</button>
    </div>`).join('');
}

function removeUploadedDoc(idx) {
  CS_UPLOADED_DOCS.splice(idx, 1);
  renderUploadedDocs();
}

// ── Send Message ──────────────────────────────────────────────
async function sendPromptUpgradeMsg() {
  const input = document.getElementById('csPromptInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  await sendPromptUpgradeMsgInternal(text, false);
}

async function sendPromptUpgradeMsgInternal(text, isAuto) {
  if (CS_PROMPT_TYPING) return;

  const time = getCSTime();
  // Don't show raw [FILES_UPLOADED] message, show friendly version
  const displayText = isAuto
    ? `📂 Files uploaded: ${CS_UPLOADED_DOCS.map(d => d.name).join(', ')}`
    : text;

  CS_PROMPT_HISTORY.push({ role: 'user', content: displayText, time });
  renderPromptChat();
  showPromptTyping();
  CS_PROMPT_TYPING = true;

  try {
    const reply = await callPromptUpgradeAI(text);
    hidePromptTyping();
    CS_PROMPT_TYPING = false;
    CS_PROMPT_HISTORY.push({ role: 'assistant', content: reply, time: getCSTime() });
    renderPromptChat();

    // Extract updated prompt if AI provided one
    const promptMatch = reply.match(/```prompt\n([\s\S]*?)```/);
    if (promptMatch) {
      const newPrompt = promptMatch[1].trim();
      // Live update Settings textarea
      const promptEl = document.getElementById('cs_system_prompt');
      if (promptEl) promptEl.value = newPrompt;
      // Live save to Firebase
      await liveUpdatePrompt(newPrompt);
    }
  } catch (e) {
    hidePromptTyping();
    CS_PROMPT_TYPING = false;
    CS_PROMPT_HISTORY.push({ role: 'assistant', content: '❌ Error: ' + e.message, time: getCSTime() });
    renderPromptChat();
  }
}

// Live save prompt to Firebase immediately
async function liveUpdatePrompt(newPrompt) {
  try {
    CS_SUPPORT_CONFIG.system_prompt = newPrompt;
    await db.collection('support_settings').doc('config').set(
      { ...CS_SUPPORT_CONFIG, system_prompt: newPrompt, updated_at: Date.now() }
    );
    // Show live save indicator
    const indicator = document.getElementById('csPromptLiveSave');
    if (indicator) {
      indicator.textContent = '✅ Auto-saved to Firebase';
      indicator.style.color = 'var(--success)';
      setTimeout(() => { indicator.textContent = ''; }, 3000);
    }
  } catch (e) { console.log('Live save error:', e); }
}

// ── AI Call ───────────────────────────────────────────────────
async function callPromptUpgradeAI(userMsg) {
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  const key = CS_SUPPORT_CONFIG.api_key || '';
  if (!key) throw new Error('API key nahi hai. Settings tab mein add karo.');

  const currentPrompt = document.getElementById('cs_system_prompt')?.value?.trim()
    || CS_SUPPORT_CONFIG.system_prompt || '';

  // Build uploaded docs context
  let docsContext = '';
  if (CS_UPLOADED_DOCS.length > 0) {
    docsContext = '\n\n--- UPLOADED STORE DOCUMENTS ---\n';
    CS_UPLOADED_DOCS.forEach(d => {
      docsContext += `\n[File: ${d.name}]\n${d.content.substring(0, 3000)}\n`;
    });
    docsContext += '\n--- END DOCUMENTS ---';
  }

  // Include KB cards context for smarter prompt generation
  const kbSummary = typeof KB_CARDS !== 'undefined' && KB_CARDS.length
    ? '\n\nCURRENT KB CARDS (' + KB_CARDS.length + ' cards):\n' + KB_CARDS.map(c => `• ${c.icon || '📄'} ${c.name}: ${(c.keywords || '').substring(0, 60)}`).join('\n')
    : '\n\n(No KB cards yet)';

  const systemPrompt = `You are an expert AI Prompt Engineer for e-commerce customer support.

YOUR ROLE:
- Analyze store info, uploaded files, and current system prompt
- Ask smart targeted questions — ONE at a time
- Build SHORT, EFFECTIVE prompts (max 300 words)
- Check if KB cards are referenced properly in the prompt

CURRENT SYSTEM PROMPT:
"""
${currentPrompt || '(Empty — not set yet)'}
"""
${docsContext}
${kbSummary}

SMART ANALYSIS RULES:
1. Files uploaded → FIRST summarize what info you found, THEN list what's missing
2. Check coverage: store name, products, tone, policies, shipping, returns, contact info
3. If KB cards exist → prompt must tell AI to use them
4. Ask ONE specific question at a time — never multiple
5. When enough info → generate: \`\`\`prompt\n...\`\`\`
6. After generating → ask "Kuch aur add karna hai? Ya KB cards bhi improve karoon?"
7. NEVER use placeholders like "[Store Name]" — only real info

PROMPT QUALITY:
- Dense and specific — no fluff
- Include: store identity, products, tone, policies, KB card instruction, language detection
- Max 300 words

CONVERSATION STYLE:
- Reply in same language as user (Roman Urdu / English / Urdu)
- After file analysis: "Yeh mila: [summary]. Missing: [gaps]. Pehle [X] batao."
- Be direct and confident`;

  const history = CS_PROMPT_HISTORY.slice(-10);

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
        generationConfig: { temperature: 0.6, maxOutputTokens: 1200 }
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
      body: JSON.stringify({ model, messages: msgs, max_tokens: 1200, temperature: 0.6 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices[0].message.content;
  }
}

// ── Render Prompt Chat ────────────────────────────────────────
function renderPromptChat() {
  const container = document.getElementById('csPromptMessages');
  if (!container) return;

  if (!CS_PROMPT_HISTORY.length) {
    container.innerHTML = `
      <div class="cs-prompt-welcome">
        <div style="font-size:2rem;margin-bottom:0.8rem;">✨</div>
        <div style="font-weight:600;color:var(--text);margin-bottom:0.5rem;">Prompt Upgrade AI</div>
        <div style="color:var(--muted);font-size:0.82rem;line-height:1.6;">
          Main tumhara customer support AI ka system prompt improve karta hoon.<br><br>
          <strong style="color:var(--text);">Kaise shuru karein:</strong><br>
          • Files upload karo (About Us, Policies, Shipping etc.)<br>
          • Ya seedha batao: store ka naam, products, tone<br>
          • Main khud zaroori sawaal poochunga
        </div>
      </div>`;
    return;
  }

  container.innerHTML = CS_PROMPT_HISTORY.map(m => {
    const isUser = m.role === 'user';
    let formatted = (m.content || '')
      .replace(/```prompt\n([\s\S]*?)```/g, (_, p) => `
        <div class="cs-prompt-block">
          <div class="cs-prompt-block-header">
            📝 Updated System Prompt
            <button class="cs-copy-prompt-btn" onclick="copyPromptBlock(this)">📋 Copy</button>
          </div>
          <code>${escHtml(p.trim())}</code>
        </div>`)
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>');

    return `<div class="cs-msg-row ${isUser ? 'user' : 'bot'}">
      <div class="cs-bubble ${isUser ? 'user' : 'bot'}">${formatted}<div class="cs-bubble-time">${m.time || ''}</div></div>
    </div>`;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function copyPromptBlock(btn) {
  const code = btn.closest('.cs-prompt-block').querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy', 2000);
  });
}

function showPromptTyping() {
  const container = document.getElementById('csPromptMessages');
  if (!container) return;
  const el = document.createElement('div');
  el.id = 'csPromptTyping';
  el.className = 'cs-msg-row bot';
  el.innerHTML = `<div class="cs-typing-dots"><span></span><span></span><span></span></div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}
function hidePromptTyping() { document.getElementById('csPromptTyping')?.remove(); }

function clearPromptChat() {
  if (!confirm('Prompt AI chat clear karein?')) return;
  CS_PROMPT_HISTORY = [];
  CS_UPLOADED_DOCS = [];
  renderPromptChat();
  renderUploadedDocs();
}

// ── Shopify Guide ─────────────────────────────────────────────
function renderShopifyGuide() {
  const host = window.location.origin + window.location.pathname.replace('index.html', '');
  const widgetUrl = host + 'support-widget.js';
  const cssUrl = host + 'support-widget.css';
  const el = document.getElementById('csShopifyGuide');
  if (!el) return;
  el.innerHTML = `
    <div class="cs-guide-step">
      <div class="cs-guide-num">1</div>
      <div>
        <strong>Files host karo</strong>
        <p>Yeh 2 files kisi bhi free hosting pe upload karo (GitHub Pages ya Netlify recommended):</p>
        <div class="cs-code-block">support-widget.js\nsupport-widget.css</div>
      </div>
    </div>
    <div class="cs-guide-step">
      <div class="cs-guide-num">2</div>
      <div>
        <strong>Shopify Theme mein embed karo</strong>
        <p>Shopify Admin → Online Store → Themes → Edit Code → <code>theme.liquid</code> → <code>&lt;/body&gt;</code> se pehle paste karo:</p>
        <div class="cs-code-block" id="csEmbedCode">&lt;link rel="stylesheet" href="${cssUrl}"&gt;\n&lt;script src="${widgetUrl}"&gt;&lt;/script&gt;</div>
        <button class="btn btn-outline btn-sm" onclick="copyEmbedCode()" style="margin-top:0.5rem;">📋 Copy Embed Code</button>
      </div>
    </div>
    <div class="cs-guide-step">
      <div class="cs-guide-num">3</div>
      <div>
        <strong>Firebase Rules update karo</strong>
        <p>Firebase Console → Firestore Database → Rules → Yeh paste karo:</p>
        <div class="cs-code-block">match /support_chats/{doc} {\n  allow read, write: if true;\n}\nmatch /support_settings/{doc} {\n  allow read: if true;\n  allow write: if request.auth != null;\n}</div>
      </div>
    </div>
    <div class="cs-guide-step">
      <div class="cs-guide-num">4</div>
      <div>
        <strong>Settings + Prompt configure karo</strong>
        <p>Dashboard mein "Settings" tab → API key add karo. Phir "Prompt AI" tab → files upload karo ya batao store ke baare mein. AI automatically system prompt banayega aur save karega.</p>
      </div>
    </div>
    <div class="cs-guide-step">
      <div class="cs-guide-num">5</div>
      <div>
        <strong>Test karo</strong>
        <p>Apna Shopify store open karo — neeche right corner mein chat bubble dikhega. Click karo aur test karo. Chats real-time dashboard mein "Chats" tab mein aayenge.</p>
      </div>
    </div>`;
}

function copyEmbedCode() {
  const el = document.getElementById('csEmbedCode');
  if (!el) return;
  navigator.clipboard.writeText(el.innerText.replace(/\\n/g, '\n')).then(() => toast('Code copied!', 'success'));
}

// ── Helpers ───────────────────────────────────────────────────
function getCSTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function csSupportTabSwitch(tab) {
  document.querySelectorAll('.cs-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.cs-tab-panel').forEach(p => p.style.display = 'none');
  document.getElementById('csTab_' + tab).style.display = 'flex';
  document.querySelector(`[onclick="csSupportTabSwitch('${tab}')"]`).classList.add('active');
  if (tab === 'guide') renderShopifyGuide();
  if (tab === 'prompt') { renderPromptChat(); renderUploadedDocs(); }
}

// ══════════════════════════════════════════════════════════════
// ── PROMPT NOTEPAD ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let PN_UNDO_STACK = [];
let PN_SUGGESTION = '';
let PN_FULLSCREEN = false;
let PN_SAVE_TIMER = null;

// ── Open / Close ──────────────────────────────────────────────
function openPromptNotepad() {
  const overlay = document.getElementById('promptNotepadOverlay');
  const editor  = document.getElementById('pnEditor');
  if (!overlay || !editor) return;

  // Load current prompt into editor
  const current = document.getElementById('cs_system_prompt')?.value || CS_SUPPORT_CONFIG.system_prompt || '';
  editor.value = current;
  PN_UNDO_STACK = [current];

  overlay.classList.add('open');
  pnUpdateMeta();
  pnUpdateLineNums();
  setTimeout(() => editor.focus(), 150);
}

function closePromptNotepad() {
  document.getElementById('promptNotepadOverlay')?.classList.remove('open');
  document.getElementById('pnAiBar').style.display = 'none';
  PN_FULLSCREEN = false;
  document.getElementById('promptNotepadModal')?.classList.remove('fullscreen');
}

function pnSaveAndClose() {
  const val = document.getElementById('pnEditor')?.value || '';
  // Sync to hidden textarea
  const ta = document.getElementById('cs_system_prompt');
  if (ta) ta.value = val;
  // Update preview card
  updatePromptPreviewCard(val);
  // Auto-save to Firebase
  liveUpdatePrompt(val);
  closePromptNotepad();
  toast('System prompt saved!', 'success');
}

function pnToggleFullscreen() {
  PN_FULLSCREEN = !PN_FULLSCREEN;
  document.getElementById('promptNotepadModal')?.classList.toggle('fullscreen', PN_FULLSCREEN);
}

// ── Editor events ─────────────────────────────────────────────
function pnOnInput() {
  pnUpdateMeta();
  pnUpdateLineNums();
  pnMarkUnsaved();
  // Auto-save debounce (2s)
  clearTimeout(PN_SAVE_TIMER);
  PN_SAVE_TIMER = setTimeout(() => pnAutoSave(), 2000);
}

function pnKeydown(e) {
  const editor = document.getElementById('pnEditor');
  // Tab → 2 spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart, end = editor.selectionEnd;
    editor.value = editor.value.substring(0, s) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = s + 2;
    pnOnInput();
  }
  // Ctrl+S → save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    pnSaveAndClose();
  }
  // Ctrl+Z → undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    pnUndo();
  }
  // Push to undo stack on meaningful change
  if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
    if (PN_UNDO_STACK[PN_UNDO_STACK.length - 1] !== editor.value) {
      PN_UNDO_STACK.push(editor.value);
      if (PN_UNDO_STACK.length > 50) PN_UNDO_STACK.shift();
    }
  }
  // Update cursor position
  setTimeout(pnUpdateCursor, 0);
}

function pnSyncScroll() {
  const editor = document.getElementById('pnEditor');
  const lineNums = document.getElementById('pnLineNums');
  if (lineNums) lineNums.scrollTop = editor.scrollTop;
}

// ── Meta updates ──────────────────────────────────────────────
function pnUpdateMeta() {
  const val = document.getElementById('pnEditor')?.value || '';
  const words = val.trim() ? val.trim().split(/\s+/).length : 0;
  const chars = val.length;
  const el1 = document.getElementById('pnWordCount');
  const el2 = document.getElementById('pnCharCount');
  if (el1) el1.textContent = words + ' words';
  if (el2) el2.textContent = chars + ' chars';
}

function pnUpdateLineNums() {
  const editor = document.getElementById('pnEditor');
  const lineNums = document.getElementById('pnLineNums');
  if (!editor || !lineNums) return;
  const lines = editor.value.split('\n').length;
  lineNums.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function pnUpdateCursor() {
  const editor = document.getElementById('pnEditor');
  const el = document.getElementById('pnCursorPos');
  if (!editor || !el) return;
  const text = editor.value.substring(0, editor.selectionStart);
  const lines = text.split('\n');
  el.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

function pnMarkUnsaved() {
  const dot = document.getElementById('pnUnsavedDot');
  const status = document.getElementById('pnSaveStatus');
  if (dot) dot.style.display = 'inline';
  if (status) { status.textContent = 'Unsaved changes'; status.style.color = 'rgba(255,255,255,0.6)'; }
}

function pnMarkSaved() {
  const dot = document.getElementById('pnUnsavedDot');
  const status = document.getElementById('pnSaveStatus');
  if (dot) dot.style.display = 'none';
  if (status) { status.textContent = '✓ Auto-saved'; status.style.color = '#fff'; }
}

async function pnAutoSave() {
  const val = document.getElementById('pnEditor')?.value || '';
  const ta = document.getElementById('cs_system_prompt');
  if (ta) ta.value = val;
  updatePromptPreviewCard(val);
  try {
    await liveUpdatePrompt(val);
    pnMarkSaved();
  } catch (e) { /* silent */ }
}

// ── Toolbar actions ───────────────────────────────────────────
function pnInsert(text) {
  const editor = document.getElementById('pnEditor');
  if (!editor) return;
  const s = editor.selectionStart;
  const before = editor.value.substring(0, s);
  const after  = editor.value.substring(editor.selectionEnd);
  // Insert at start of current line
  const lineStart = before.lastIndexOf('\n') + 1;
  editor.value = editor.value.substring(0, lineStart) + text + editor.value.substring(lineStart);
  editor.selectionStart = editor.selectionEnd = lineStart + text.length;
  editor.focus();
  pnOnInput();
}

function pnWrap(before, after) {
  const editor = document.getElementById('pnEditor');
  if (!editor) return;
  const s = editor.selectionStart, e = editor.selectionEnd;
  const selected = editor.value.substring(s, e) || 'text';
  editor.value = editor.value.substring(0, s) + before + selected + after + editor.value.substring(e);
  editor.selectionStart = s + before.length;
  editor.selectionEnd   = s + before.length + selected.length;
  editor.focus();
  pnOnInput();
}

function pnUndo() {
  if (PN_UNDO_STACK.length <= 1) return;
  PN_UNDO_STACK.pop();
  const editor = document.getElementById('pnEditor');
  if (editor) {
    editor.value = PN_UNDO_STACK[PN_UNDO_STACK.length - 1];
    pnOnInput();
  }
}

function pnClear() {
  if (!confirm('Editor clear karein?')) return;
  const editor = document.getElementById('pnEditor');
  if (editor) { PN_UNDO_STACK.push(editor.value); editor.value = ''; pnOnInput(); }
}

// ── AI Features ───────────────────────────────────────────────
async function pnAiImprove() {
  const editor = document.getElementById('pnEditor');
  if (!editor?.value.trim()) { toast('Pehle kuch likho', 'warning'); return; }
  await pnCallAI(`Improve this system prompt — make it more effective, clear, and professional. Keep it concise (max 250 words). Return ONLY the improved prompt, no explanation:\n\n${editor.value}`);
}

async function pnAiShorten() {
  const editor = document.getElementById('pnEditor');
  if (!editor?.value.trim()) { toast('Pehle kuch likho', 'warning'); return; }
  await pnCallAI(`Shorten this system prompt significantly while keeping all key information. Max 150 words. Return ONLY the shortened prompt:\n\n${editor.value}`);
}

async function pnAiTranslate() {
  const editor = document.getElementById('pnEditor');
  if (!editor?.value.trim()) { toast('Pehle kuch likho', 'warning'); return; }
  const lang = prompt('Kis language mein translate karein? (e.g. Urdu, Arabic, English)');
  if (!lang) return;
  await pnCallAI(`Translate this system prompt to ${lang}. Return ONLY the translated prompt:\n\n${editor.value}`);
}

async function pnCallAI(instruction) {
  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) { toast('API key nahi hai — Settings mein add karo', 'error'); return; }

  const aiBar = document.getElementById('pnAiBar');
  const loading = document.getElementById('pnAiLoading');
  const content = document.getElementById('pnAiSuggestion');

  aiBar.style.display = 'block';
  loading.style.display = 'flex';
  content.textContent = '';

  try {
    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: instruction }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 600 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text;
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }], max_tokens: 600, temperature: 0.5 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content;
    }
    PN_SUGGESTION = result.trim();
    loading.style.display = 'none';
    content.textContent = PN_SUGGESTION;
  } catch (e) {
    loading.style.display = 'none';
    content.textContent = '❌ Error: ' + e.message;
    PN_SUGGESTION = '';
  }
}

function pnAcceptSuggestion() {
  if (!PN_SUGGESTION) return;
  const editor = document.getElementById('pnEditor');
  if (editor) {
    PN_UNDO_STACK.push(editor.value);
    editor.value = PN_SUGGESTION;
    pnOnInput();
  }
  pnRejectSuggestion();
  toast('✅ Suggestion accepted!', 'success');
}

function pnRejectSuggestion() {
  PN_SUGGESTION = '';
  document.getElementById('pnAiBar').style.display = 'none';
  document.getElementById('pnAiSuggestion').textContent = '';
}

// ── Preview card update ───────────────────────────────────────
function updatePromptPreviewCard(val) {
  const preview = document.getElementById('csPromptPreviewText');
  const wordCount = document.getElementById('csPromptWordCount');
  const savedAt = document.getElementById('csPromptSavedAt');
  if (preview) {
    preview.innerHTML = val.trim()
      ? `<span>${escHtml(val.substring(0, 200))}${val.length > 200 ? '...' : ''}</span>`
      : `<span style="color:var(--muted);font-style:italic;">No prompt set — click to write one</span>`;
  }
  if (wordCount) {
    const w = val.trim() ? val.trim().split(/\s+/).length : 0;
    wordCount.textContent = w + ' words';
  }
  if (savedAt) {
    savedAt.textContent = val ? 'Last saved: ' + new Date().toLocaleTimeString() : '';
  }
}

// ══════════════════════════════════════════════════════════════
// ── FEATURE 6: BROWSER NOTIFICATIONS + ALERTS SYNC ───────────
// ══════════════════════════════════════════════════════════════

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendBrowserNotif(title, body, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: 'https://thumbs.dreamstime.com/b/support-customer-care-icon-elegant-cyan-blue-round-button-support-customer-care-icon-isolated-elegant-cyan-blue-round-button-99714974.jpg',
    badge: 'https://thumbs.dreamstime.com/b/support-customer-care-icon-elegant-cyan-blue-round-button-support-customer-care-icon-isolated-elegant-cyan-blue-round-button-99714974.jpg',
    tag: 'aezoon-support',
    requireInteraction: true
  });
  if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
}

// Listen for new alerts (human_requested + new chats)
function startAlertsSync() {
  // New human requests
  db.collection('support_alerts')
    .where('read', '==', false)
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const alert = change.doc.data();
          if (alert.type === 'human_requested') {
            // Dashboard in-app notification
            showDashboardAlert({
              id: change.doc.id,
              type: 'human',
              title: '🆘 Human Support Requested!',
              body: `A visitor needs human help — ${alert.page || 'store page'}`,
              session_id: alert.session_id,
              time: alert.created_at
            });
            // Browser notification
            sendBrowserNotif(
              '🆘 Human Support Needed!',
              `Visitor on ${alert.page || 'your store'} needs help`,
              () => {
                nav('support');
                setTimeout(() => selectSupportChat(alert.session_id), 500);
              }
            );
            // Mark as read
            change.doc.ref.update({ read: true }).catch(() => {});
          }
        }
      });
    }, err => console.log('Alerts sync error:', err));

  // New chat sessions (first message from new visitor)
  let CS_KNOWN_SESSIONS = new Set();
  let CS_FIRST_LOAD = true;
  db.collection('support_chats').orderBy('updated_at', 'desc').onSnapshot(snap => {
    if (CS_FIRST_LOAD) {
      snap.docs.forEach(d => CS_KNOWN_SESSIONS.add(d.id));
      CS_FIRST_LOAD = false;
      return;
    }
    snap.docChanges().forEach(change => {
      if (change.type === 'added' && !CS_KNOWN_SESSIONS.has(change.doc.id)) {
        CS_KNOWN_SESSIONS.add(change.doc.id);
        const data = change.doc.data();
        showDashboardAlert({
          id: change.doc.id,
          type: 'new_chat',
          title: '💬 New Chat!',
          body: `New visitor started a chat`,
          session_id: data.session_id,
          time: data.updated_at
        });
        sendBrowserNotif(
          '💬 New Support Chat',
          `A visitor started a chat on your store`,
          () => {
            nav('support');
            setTimeout(() => selectSupportChat(data.session_id), 500);
          }
        );
      }
    });
  });
}

// ── Dashboard Alert Banner ────────────────────────────────────
let CS_ALERTS = [];

function showDashboardAlert(alert) {
  CS_ALERTS.unshift(alert);
  renderDashboardAlerts();
  if (typeof playSupportSound === 'function') playSupportSound();
  toast(alert.title + ' — ' + alert.body, alert.type === 'human' ? 'error' : 'success');
  updateSupportNavBadge();
}

function renderDashboardAlerts() {
  const el = document.getElementById('csAlertsBanner');
  if (!el) return;
  if (!CS_ALERTS.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = CS_ALERTS.slice(0, 3).map((a, i) => `
    <div class="cs-alert-item cs-alert-${a.type}">
      <span class="cs-alert-icon">${a.type === 'human' ? '🆘' : '💬'}</span>
      <div class="cs-alert-text">
        <strong>${a.title}</strong>
        <span>${a.body}</span>
      </div>
      <button class="cs-alert-view" onclick="selectSupportChat('${a.session_id}');csSupportTabSwitch('chats')">View →</button>
      <button class="cs-alert-dismiss" onclick="dismissAlert(${i})">✕</button>
    </div>`).join('');
}

function dismissAlert(idx) {
  CS_ALERTS.splice(idx, 1);
  renderDashboardAlerts();
  updateSupportNavBadge();
}

function updateSupportNavBadge() {
  const badge = document.getElementById('supportNavBadge');
  if (!badge) return;
  const count = CS_ALERTS.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

// ══════════════════════════════════════════════════════════════
// ── PROMPT AI — VERSION HISTORY + QUICK ACTIONS + KB AWARE ───
// ══════════════════════════════════════════════════════════════

let PAI_VERSIONS = []; // { label, prompt, savedAt }
const PAI_MAX_VERSIONS = 10;

// Save a version snapshot
function paiSaveVersion(prompt) {
  if (!prompt.trim()) return;
  // Don't save duplicate
  if (PAI_VERSIONS.length && PAI_VERSIONS[0].prompt === prompt) return;
  PAI_VERSIONS.unshift({
    label: 'v' + (PAI_VERSIONS.length + 1),
    prompt,
    savedAt: Date.now()
  });
  if (PAI_VERSIONS.length > PAI_MAX_VERSIONS) PAI_VERSIONS.pop();
  renderPaiVersions();
}

function renderPaiVersions() {
  const el = document.getElementById('paiVersionChips');
  if (!el) return;
  if (!PAI_VERSIONS.length) {
    el.innerHTML = '<span style="font-size:0.72rem;color:var(--muted);">No versions yet</span>';
    return;
  }
  el.innerHTML = PAI_VERSIONS.map((v, i) => `
    <button class="pai-version-chip ${i === 0 ? 'current' : ''}"
      onclick="paiRestoreVersion(${i})"
      title="Saved: ${new Date(v.savedAt).toLocaleTimeString()}">${v.label}</button>`).join('');
}

function paiRestoreVersion(idx) {
  const v = PAI_VERSIONS[idx];
  if (!v) return;
  if (!confirm(`Restore ${v.label}? Current prompt will be replaced.`)) return;
  const el = document.getElementById('cs_system_prompt');
  if (el) el.value = v.prompt;
  updatePromptPreviewCard(v.prompt);
  liveUpdatePrompt(v.prompt);
  toast(`${v.label} restored!`, 'success');
  // Move to top
  PAI_VERSIONS.splice(idx, 1);
  PAI_VERSIONS.unshift(v);
  renderPaiVersions();
}

// ── Quick Actions ─────────────────────────────────────────────
async function paiQuickAction(action) {
  const currentPrompt = document.getElementById('cs_system_prompt')?.value?.trim() || '';
  const kbSummary = typeof KB_CARDS !== 'undefined' && KB_CARDS.length
    ? '\n\nKnowledge Base cards available: ' + KB_CARDS.map(c => c.name).join(', ')
    : '';

  const messages = {
    analyze: `Analyze this system prompt and tell me:\n1. What's good about it\n2. What's missing\n3. What should be improved\n\nPrompt:\n"${currentPrompt || '(empty)'}"${kbSummary}`,
    improve: `Improve this system prompt. Make it more effective for customer support. Keep it under 250 words.\n\nCurrent:\n"${currentPrompt || '(empty)'}"${kbSummary}\n\nReturn the improved prompt in \`\`\`prompt\n...\`\`\` block.`,
    shorten: `Shorten this system prompt to under 120 words while keeping all key info.\n\nCurrent:\n"${currentPrompt}"\n\nReturn in \`\`\`prompt\n...\`\`\` block.`,
    tone_formal: `Rewrite this system prompt to use a formal, professional tone.\n\nCurrent:\n"${currentPrompt}"\n\nReturn in \`\`\`prompt\n...\`\`\` block.`,
    tone_friendly: `Rewrite this system prompt to use a warm, friendly, conversational tone.\n\nCurrent:\n"${currentPrompt}"\n\nReturn in \`\`\`prompt\n...\`\`\` block.`,
    add_kb: `I have these Knowledge Base cards: ${kbSummary || 'none yet'}.\n\nUpdate this system prompt to tell the AI to use the knowledge base cards when answering questions.\n\nCurrent prompt:\n"${currentPrompt}"\n\nReturn in \`\`\`prompt\n...\`\`\` block.`,
    multilang: `Update this system prompt to make the AI detect and respond in the user's language (English, Urdu, Roman Urdu, Arabic etc.).\n\nCurrent:\n"${currentPrompt}"\n\nReturn in \`\`\`prompt\n...\`\`\` block.`
  };

  const msg = messages[action];
  if (!msg) return;

  // Save current version before change
  if (currentPrompt) paiSaveVersion(currentPrompt);

  // Send as message
  const input = document.getElementById('csPromptInput');
  if (input) input.value = '';
  await sendPromptUpgradeMsgInternal(msg, false);
}

// Override callPromptUpgradeAI to be KB-aware and save versions
const _origCallPromptUpgradeAI = callPromptUpgradeAI;
async function callPromptUpgradeAI(userMsg) {
  const result = await _origCallPromptUpgradeAI(userMsg);
  // If a new prompt was generated, save version
  const promptMatch = result.match(/```prompt\n([\s\S]*?)```/);
  if (promptMatch) {
    const currentPrompt = document.getElementById('cs_system_prompt')?.value?.trim() || '';
    if (currentPrompt) paiSaveVersion(currentPrompt);
  }
  return result;
}

// KB functions are in knowledge-base.js — no stubs needed here

// ══════════════════════════════════════════════════════════════
// ── HUMAN REPLY SYSTEM ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let CS_HUMAN_MODE = false; // per-chat human mode state

// ── Toggle Human Mode ─────────────────────────────────────────
function toggleHumanMode(enabled) {
  CS_HUMAN_MODE = enabled;
  const label = document.getElementById('csHumanModeLabel');
  const replyArea = document.getElementById('csHumanReplyArea');
  const pill = document.getElementById('csModePill');
  const pillIcon = document.getElementById('csModePillIcon');

  if (enabled) {
    if (label) label.textContent = 'Human Mode';
    if (pillIcon) pillIcon.textContent = '👨‍💼';
    if (pill) pill.classList.add('human-on');
    if (replyArea) replyArea.style.display = 'flex';
    setTimeout(() => document.getElementById('csHumanReplyInp')?.focus(), 100);
    const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
    if (chat) {
      db.collection('support_chats').doc(chat.id)
        .update({ human_mode: true, human_mode_at: Date.now() })
        .catch(() => {});
    }
    toast('👨‍💼 Human mode ON — AI paused', 'success');
  } else {
    if (label) label.textContent = 'AI Mode';
    if (pillIcon) pillIcon.textContent = '🤖';
    if (pill) pill.classList.remove('human-on');
    if (replyArea) replyArea.style.display = 'none';
    const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
    if (chat) {
      db.collection('support_chats').doc(chat.id)
        .update({ human_mode: false })
        .catch(() => {});
    }
    toast('🤖 AI mode restored', 'success');
  }
}

// ── Send Human Reply ──────────────────────────────────────────
async function sendHumanReply() {
  const inp = document.getElementById('csHumanReplyInp');
  const text = inp?.value.trim();
  if (!text) return;
  if (!CS_SELECTED_SESSION) return toast('Pehle koi chat select karo', 'warning');

  // FIX: Send button disable karo double-send se bachne ke liye
  const sendBtn = document.querySelector('.cs-human-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  inp.value = '';
  inp.style.height = 'auto';

  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat) { if (sendBtn) sendBtn.disabled = false; return; }

  const time = getCSTime();
  const newMsg = {
    role: 'human_agent',
    content: text,
    time,
    agent_name: 'Support Agent'
  };

  const updatedMsgs = [...(chat.messages || []), newMsg];

  try {
    await db.collection('support_chats').doc(chat.id).update({
      messages: updatedMsgs,
      updated_at: Date.now(),
      unread: 0,
      last_human_reply: Date.now(),
      // FIX: human_requested clear karo jab reply ho jaye
      human_requested: false
    });
    toast('Reply sent ✓', 'success');
    // FIX: Reply ke baad input pe focus wapas aao
    setTimeout(() => inp?.focus(), 100);
  } catch (e) {
    toast('Reply send nahi hua: ' + e.message, 'error');
    inp.value = text; // restore on error
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Human Input Keyboard Handler ─────────────────────────────
function csHumanInputKeydown(e) {
  const el = e.target;
  // Auto-grow textarea
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';

  // Handle Enter to send
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendHumanReply();
  }
  // Handle Shift+Enter to Add Note
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    if (typeof addInternalNote === 'function') {
      addInternalNote();
    } else {
      toast('Add Note feature not loaded yet', 'warning');
    }
  }
}

// ── AI Rewrite Reply ──────────────────────────────────────────
async function aiRewriteReply() {
  const inp = document.getElementById('csHumanReplyInp');
  const text = inp?.value.trim();
  if (!text) return toast('Pehle reply likho jise rewrite karna ho', 'warning');
  
  const originalText = inp.value;
  inp.value = '⏳ AI is rewriting...';
  inp.disabled = true;

  try {
    const key = CS_SUPPORT_CONFIG.api_key || '';
    const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
    if (!key) throw new Error("API key missing. Add it in settings.");
    
    // Check if the chat has language memory
    let userLang = 'English';
    const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
    if(chat && chat.ai_memory && chat.ai_memory.language) {
      userLang = chat.ai_memory.language;
    }

    const instruction = `Rewrite this customer support reply to make it highly professional, polite, empathetic, and clear. 
Use bullet points (•) if there are multiple parts to the answer.
Highlight keywords in **bold**.

CRITICAL LANGUAGE RULE: 
Ensure the final reply is strictly written in ${userLang}. (e.g. if ${userLang} is Roman Urdu, use purely Roman Urdu. If it is English, use English).

Original Draft:
"${text}"

ONLY RETURN THE REWRITTEN TEXT AND NOTHING ELSE.`;
    
    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: instruction }] }],
          generationConfig: { temperature: 0.4 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text;
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }], temperature: 0.4 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content;
    }

    inp.value = result.trim();
    toast('✨ Reply rewritten!', 'success');
  } catch(e) {
    inp.value = originalText;
    toast('Rewrite failed: ' + e.message, 'error');
  } finally {
    inp.disabled = false;
    inp.focus();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
  }
}

// ── Summarize Long Chats (>5hrs) ──────────────────────────────
async function summarizeChat() {
  if (!CS_SELECTED_SESSION) return toast('Select a chat to summarize', 'warning');
  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat || !chat.messages || !chat.messages.length) return toast('Chat empty', 'warning');

  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) return toast('API key missing. Add it in settings.', 'warning');
  
  const msgsText = chat.messages.map(m => `${m.role === 'user' ? 'Visitor' : 'Support'}: ${m.content}`).join('\n');
  const instruction = `Summarize this customer support chat in max 4 short bullet points. Mention:
1. What was the customer's main problem or question?
2. Did the AI/Agent resolve it? Which KB Card or logic was used?
3. Customer's mood/sentiment (e.g., normal, frustrated, happy).
4. Any pending action needed from human admin.

CHAT LOG:
${msgsText.substring(msgsText.length - 8000)} // Only pass last 8k chars

Return ONLY the bulleted summary.`;
  
  toast('⏳ Summarizing chat...', 'info');

  try {
    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: instruction }] }],
          generationConfig: { temperature: 0.3 }
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text;
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }], temperature: 0.3 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content;
    }

    // Append summary as a system notification bubble in the UI
    const container = document.getElementById('csChatMessages');
    const noteEl = document.createElement('div');
    noteEl.className = 'cs-msg-row';
    noteEl.innerHTML = `
      <div style="background:rgba(139, 92, 246, 0.1); border:1px solid rgba(139,92,246,0.3); padding:1rem; border-radius:8px; color:var(--text); font-size:0.85rem; width:100%; margin:1rem 0;">
        <strong style="color:#8b5cf6;"><i data-lucide="sparkles" width="14" height="14"></i> AI Chat Summary</strong><br><br>
        ${result.replace(/\n/g, '<br>')}
      </div>`;
    container.appendChild(noteEl);
    container.scrollTop = container.scrollHeight;
    
    // Automatically re-initialize lucide icons inside the new container if lucide is available
    if (typeof lucide !== 'undefined') lucide.createIcons({root: noteEl});
    
    toast('Summary generated!', 'success');
  } catch(e) {
    toast('Summarize failed: ' + e.message, 'error');
  }
}
