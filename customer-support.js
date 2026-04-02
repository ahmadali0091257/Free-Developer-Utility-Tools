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

// ── Init ──────────────────────────────────────────────────────
function initCustomerSupport() {
  if (!CS_INIT_DONE) {
    startSupportChatsSync();
    CS_INIT_DONE = true;
  }
  loadSupportConfig();
}

// ── Real-time Firestore sync ──────────────────────────────────
function startSupportChatsSync() {
  db.collection('support_chats')
    .orderBy('updated_at', 'desc')
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
}

async function loadSupportConfig() {
  try {
    const snap = await db.collection('support_settings').doc('config').get();
    if (snap.exists) CS_SUPPORT_CONFIG = { ...CS_SUPPORT_CONFIG, ...snap.data() };
    fillSupportSettingsForm();
  } catch (e) { console.log('Support config load error:', e); }
}

// ── Render Chat List ──────────────────────────────────────────
function renderSupportChatList() {
  const el = document.getElementById('csSidebarList');
  if (!el) return;
  const search = (document.getElementById('csSearchInp')?.value || '').toLowerCase();
  let chats = CS_CHATS.filter(c => {
    const msgs = c.messages || [];
    const lastMsg = msgs[msgs.length - 1]?.content || '';
    return !search || (c.session_id || '').toLowerCase().includes(search) ||
      lastMsg.toLowerCase().includes(search) || (c.page || '').toLowerCase().includes(search);
  });
  if (!chats.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:0.85rem;">No chats yet.<br>Widget install karo store pe.</div>`;
    return;
  }
  el.innerHTML = chats.map(c => {
    const msgs = c.messages || [];
    const last = msgs[msgs.length - 1];
    const preview = last ? last.content.substring(0, 45) + (last.content.length > 45 ? '...' : '') : 'No messages';
    const isActive = CS_SELECTED_SESSION === c.session_id;
    const unread = c.unread || 0;
    const shortId = (c.session_id || '').replace('aezoon_sess_', '#').substring(0, 12);
    return `
      <div class="cs-chat-item ${isActive ? 'active' : ''}" onclick="selectSupportChat('${c.session_id}')">
        <div class="cs-chat-avatar">💬</div>
        <div class="cs-chat-info">
          <div class="cs-chat-name">${shortId}</div>
          <div class="cs-chat-preview">${escHtml(preview)}</div>
        </div>
        <div class="cs-chat-meta">
          <div class="cs-chat-time">${last?.time || ''}</div>
          ${unread > 0 ? `<div class="cs-unread-badge">${unread}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function updateSupportStats() {
  const total = CS_CHATS.length;
  const today = new Date().toISOString().split('T')[0];
  const todayChats = CS_CHATS.filter(c => new Date(c.updated_at || 0).toISOString().split('T')[0] === today).length;
  const totalMsgs = CS_CHATS.reduce((s, c) => s + (c.messages || []).length, 0);
  const el = document.getElementById('csSupportStats');
  if (!el) return;
  el.innerHTML = `
    <div class="cs-stat"><div class="cs-stat-val">${total}</div><div class="cs-stat-label">Sessions</div></div>
    <div class="cs-stat"><div class="cs-stat-val">${todayChats}</div><div class="cs-stat-label">Today</div></div>
    <div class="cs-stat"><div class="cs-stat-val">${totalMsgs}</div><div class="cs-stat-label">Messages</div></div>
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
}

function renderSupportChatDetail(chat) {
  const msgs = chat.messages || [];
  const shortId = (chat.session_id || '').replace('aezoon_sess_', '#').substring(0, 14);
  document.getElementById('csChatHeaderName').textContent = 'Visitor ' + shortId;
  document.getElementById('csChatHeaderSub').textContent = (chat.page || 'Unknown page') + ' · ' + msgs.length + ' messages';
  const container = document.getElementById('csChatMessages');
  if (!container) return;
  container.innerHTML = msgs.map(m => {
    const isUser = m.role === 'user';
    const formatted = (m.content || '').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return `<div class="cs-msg-row ${isUser ? 'user' : 'bot'}">
      <div class="cs-bubble ${isUser ? 'user' : 'bot'}">${formatted}<div class="cs-bubble-time">${m.time || ''}</div></div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
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

  const systemPrompt = `You are an expert AI Prompt Engineer specializing in e-commerce customer support.

YOUR ROLE:
- Analyze the user's store information and current system prompt
- Ask smart, targeted questions to understand what's missing
- Build SHORT, EFFECTIVE system prompts (max 300 words) that cover all key info
- Don't repeat yourself — each update should ADD value, not duplicate

CURRENT SYSTEM PROMPT IN USE:
"""
${currentPrompt || '(Empty — no prompt set yet)'}
"""
${docsContext}

RULES FOR PROMPT GENERATION:
1. Keep prompts SHORT and DENSE — no fluff, only key facts
2. Cover: store name, products, tone, policies, shipping, returns, contact
3. When you have enough info, generate the final prompt wrapped in: \`\`\`prompt\n...\`\`\`
4. After generating, ask: "Kuch aur add karna hai?" to check if more info needed
5. If files were uploaded, extract ONLY the most important facts (store name, policies, contact, shipping rules)
6. Never add placeholder text like "[Store Name]" — only use real info the user provided
7. If info is missing, ask ONE specific question at a time

CONVERSATION STYLE:
- Respond in the same language as the user (Roman Urdu / English / Urdu)
- Be direct and efficient — no long explanations
- After analyzing files, summarize what you found and what's still needed`;

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
