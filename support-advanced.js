/**
 * support-advanced.js — Advanced Customer Support Features
 * Pin, Search, Visitor Info, History, Email Requests,
 * AI Draft, Translate, Canned Responses, Sound, Internal Notes
 */

// ══════════════════════════════════════════════════════════════
// ── 1. SOUND NOTIFICATION ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════
let CS_SOUND_ENABLED = true;

function playSupportSound() {
  if (!CS_SOUND_ENABLED) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

function toggleSupportSound() {
  CS_SOUND_ENABLED = !CS_SOUND_ENABLED;
  const btn = document.getElementById('csSoundToggle');
  if (btn) btn.textContent = CS_SOUND_ENABLED ? '🔔' : '🔕';
  toast(CS_SOUND_ENABLED ? 'Sound ON' : 'Sound OFF', 'success');
}

// ══════════════════════════════════════════════════════════════
// ── 2. PIN CHATS ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// FIX: localStorage ki jagah Firestore use karo — sab devices pe sync hoga
let CS_PINNED = [];

// App start pe pinned chats load karo
async function loadPinnedChats() {
  try {
    const snap = await db.collection('support_settings').doc('pinned_chats').get();
    if (snap.exists) CS_PINNED = snap.data().sessions || [];
  } catch(e) { CS_PINNED = []; }
}
loadPinnedChats();

async function togglePinChat(sessionId) {
  const idx = CS_PINNED.indexOf(sessionId);
  if (idx > -1) { CS_PINNED.splice(idx, 1); toast('Unpinned', 'success'); }
  else { CS_PINNED.unshift(sessionId); toast('📌 Pinned!', 'success'); }
  // FIX: Firestore mein save karo
  try {
    await db.collection('support_settings').doc('pinned_chats').set({ sessions: CS_PINNED });
  } catch(e) { console.log('Pin save error:', e); }
  renderSupportChatList();
}

function isPinned(sessionId) { return CS_PINNED.includes(sessionId); }

// Override renderSupportChatList to sort pinned first
const _origRenderChatList = renderSupportChatList;
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

  // Sort: pinned first, then by updated_at
  chats.sort((a, b) => {
    const ap = isPinned(a.session_id) ? 1 : 0;
    const bp = isPinned(b.session_id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.updated_at || 0) - (a.updated_at || 0);
  });

  if (!chats.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:0.85rem;">No chats yet.<br>Widget install karo store pe.</div>`;
    return;
  }

  el.innerHTML = chats.map(c => {
    const msgs = c.messages || [];
    const last = msgs[msgs.length - 1];
    const preview = last ? last.content.replace(/\[\[HUMAN_NEEDED\]\]/g,'').substring(0, 45) + (last.content.length > 45 ? '...' : '') : 'No messages';
    const isActive = CS_SELECTED_SESSION === c.session_id;
    const unread = c.unread || 0;
    const shortId = (c.session_id || '').replace('aezoon_sess_', '#').substring(0, 12);
    const tag = c.tag || '';
    const humanReq = c.human_requested || false;
    const pinned = isPinned(c.session_id);
    const sentiment = c.sentiment || '';
    const sentimentIcon = sentiment === 'angry' ? '😠' : sentiment === 'happy' ? '😊' : sentiment === 'confused' ? '😕' : '';

    return `
      <div class="cs-chat-item ${isActive ? 'active' : ''} ${pinned ? 'cs-pinned' : ''}" onclick="selectSupportChat('${c.session_id}')">
        <div class="cs-chat-avatar">${humanReq ? '🆘' : pinned ? '📌' : '💬'}</div>
        <div class="cs-chat-info">
          <div class="cs-chat-name">
            ${shortId}
            ${tag ? `<span class="cs-tag-badge cs-tag-${tag}">${tag}</span>` : ''}
            ${humanReq ? `<span class="cs-tag-badge cs-tag-human">Human</span>` : ''}
            ${sentimentIcon ? `<span title="${sentiment}">${sentimentIcon}</span>` : ''}
          </div>
          <div class="cs-chat-preview">${escHtml(preview)}</div>
        </div>
        <div class="cs-chat-meta">
          <div class="cs-chat-time">${last?.time || ''}</div>
          ${unread > 0 ? `<div class="cs-unread-badge">${unread === 999 ? '!' : unread}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// ── 3. CHAT SEARCH ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function openChatSearch() {
  const bar = document.getElementById('csChatSearchBar');
  if (!bar) return;
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) document.getElementById('csChatSearchInp')?.focus();
}

function searchInChat() {
  const q = (document.getElementById('csChatSearchInp')?.value || '').toLowerCase().trim();
  const container = document.getElementById('csChatMessages');
  if (!container) return;
  // Remove previous highlights
  container.querySelectorAll('.cs-search-highlight').forEach(el => {
    el.outerHTML = el.innerHTML;
  });
  if (!q) return;
  container.querySelectorAll('.cs-bubble').forEach(bubble => {
    const html = bubble.innerHTML;
    const highlighted = html.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      '<span class="cs-search-highlight">$1</span>');
    bubble.innerHTML = highlighted;
  });
  // Scroll to first match
  const first = container.querySelector('.cs-search-highlight');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ══════════════════════════════════════════════════════════════
// ── 4. VISITOR INFO CARD ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function renderVisitorInfo(chat) {
  const el = document.getElementById('csVisitorInfo');
  if (!el) return;
  const info = chat.visitor_info || {};
  const msgs = chat.messages || [];
  const userMsgs = msgs.filter(m => m.role === 'user').length;
  const firstMsg = msgs[0];
  const memory = chat.ai_memory || {};

  el.innerHTML = `
    <div class="cs-visitor-card">
      <div class="cs-visitor-header">
        <span class="cs-visitor-avatar">${memory.name ? memory.name[0].toUpperCase() : '👤'}</span>
        <div>
          <div class="cs-visitor-name">${memory.name || 'Unknown Visitor'}</div>
          <div class="cs-visitor-lang">🌐 ${memory.language || info.language || 'Unknown'}</div>
        </div>
      </div>
      <div class="cs-visitor-rows">
        ${info.country ? `<div class="cs-vrow"><span>🌍</span><span>${info.country}</span></div>` : ''}
        ${info.browser ? `<div class="cs-vrow"><span>🖥️</span><span>${info.browser}</span></div>` : ''}
        ${info.os ? `<div class="cs-vrow"><span>📱</span><span>${info.os}</span></div>` : ''}
        <div class="cs-vrow"><span>💬</span><span>${userMsgs} messages sent</span></div>
        ${firstMsg ? `<div class="cs-vrow"><span>🕐</span><span>First: ${firstMsg.time || '—'}</span></div>` : ''}
        ${chat.page ? `<div class="cs-vrow"><span>📄</span><span style="word-break:break-all;font-size:0.7rem;">${chat.page.replace(/https?:\/\/[^/]+/, '')}</span></div>` : ''}
        ${memory.email ? `<div class="cs-vrow"><span>📧</span><span>${memory.email}</span></div>` : ''}
        ${memory.sentiment ? `<div class="cs-vrow"><span>😊</span><span>Mood: ${memory.sentiment}</span></div>` : ''}
      </div>
      ${memory.notes ? `<div class="cs-visitor-notes">📝 ${memory.notes}</div>` : ''}
      <button class="btn btn-outline btn-sm" style="margin-top:0.6rem;width:100%;font-size:0.7rem;" onclick="openVisitorPopup('${chat.session_id}')">
        🔍 Full Profile
      </button>
    </div>`;
}

// ── Visitor Full Profile Popup ────────────────────────────────
function openVisitorPopup(sessionId) {
  const chat = CS_CHATS.find(c => c.session_id === sessionId);
  if (!chat) return;

  const memory = chat.ai_memory || {};
  const info = chat.visitor_info || {};
  const msgs = chat.messages || [];
  const userMsgs = msgs.filter(m => m.role === 'user');
  const botMsgs = msgs.filter(m => m.role === 'assistant');
  const humanMsgs = msgs.filter(m => m.role === 'human_agent');
  const firstMsg = msgs[0];
  const lastMsg = msgs[msgs.length - 1];

  // Session duration
  const duration = firstMsg && lastMsg
    ? Math.round((Date.now() - (chat.created_at || Date.now())) / 60000)
    : 0;

  // Topics as chips
  const topics = memory.topics || [];

  const sentimentColor = { angry: '#ef4444', happy: '#10b981', confused: '#f59e0b' };
  const sentimentEmoji = { angry: '😠', happy: '😊', confused: '😕', neutral: '😐' };

  const popup = document.getElementById('csVisitorPopup');
  const content = document.getElementById('csVisitorPopupContent');
  if (!popup || !content) return;

  content.innerHTML = `
    <div class="cvp-hero">
      <div class="cvp-avatar">${memory.name ? memory.name[0].toUpperCase() : '?'}</div>
      <div class="cvp-hero-info">
        <div class="cvp-name">${escHtml(memory.name || 'Unknown Visitor')}</div>
        <div class="cvp-session">${(sessionId || '').replace('aezoon_sess_', '#').substring(0, 16)}</div>
        ${memory.sentiment ? `<div class="cvp-mood" style="color:${sentimentColor[memory.sentiment] || 'var(--muted)'}">
          ${sentimentEmoji[memory.sentiment] || '😐'} ${memory.sentiment}
        </div>` : ''}
      </div>
    </div>

    <div class="cvp-grid">
      <div class="cvp-section">
        <div class="cvp-section-title">📍 Location & Device</div>
        <div class="cvp-rows">
          ${info.country ? `<div class="cvp-row"><span class="cvp-label">Country</span><span class="cvp-val">🌍 ${escHtml(info.country)}</span></div>` : ''}
          ${info.city ? `<div class="cvp-row"><span class="cvp-label">City</span><span class="cvp-val">🏙️ ${escHtml(info.city)}</span></div>` : ''}
          ${info.browser ? `<div class="cvp-row"><span class="cvp-label">Browser</span><span class="cvp-val">🖥️ ${escHtml(info.browser)}</span></div>` : ''}
          ${info.os ? `<div class="cvp-row"><span class="cvp-label">OS</span><span class="cvp-val">📱 ${escHtml(info.os)}</span></div>` : ''}
          ${info.device ? `<div class="cvp-row"><span class="cvp-label">Device</span><span class="cvp-val">${escHtml(info.device)}</span></div>` : ''}
          ${!info.country && !info.city ? `<div class="cvp-row"><span class="cvp-val" style="color:var(--muted);font-style:italic;">Location not available</span></div>` : ''}
        </div>
      </div>

      <div class="cvp-section">
        <div class="cvp-section-title">💬 Session Stats</div>
        <div class="cvp-rows">
          <div class="cvp-row"><span class="cvp-label">Messages</span><span class="cvp-val">${userMsgs.length} sent</span></div>
          <div class="cvp-row"><span class="cvp-label">AI Replies</span><span class="cvp-val">${botMsgs.length}</span></div>
          ${humanMsgs.length ? `<div class="cvp-row"><span class="cvp-label">Human Replies</span><span class="cvp-val">👨‍💼 ${humanMsgs.length}</span></div>` : ''}
          <div class="cvp-row"><span class="cvp-label">Language</span><span class="cvp-val">🌐 ${escHtml(memory.language || 'Unknown')}</span></div>
          ${firstMsg ? `<div class="cvp-row"><span class="cvp-label">Started</span><span class="cvp-val">🕐 ${firstMsg.time || '—'}</span></div>` : ''}
          ${chat.tag ? `<div class="cvp-row"><span class="cvp-label">Tag</span><span class="cvp-val cs-tag-badge cs-tag-${chat.tag}">${chat.tag}</span></div>` : ''}
        </div>
      </div>

      ${memory.email ? `
      <div class="cvp-section">
        <div class="cvp-section-title">📧 Contact</div>
        <div class="cvp-rows">
          <div class="cvp-row"><span class="cvp-label">Email</span><span class="cvp-val">${escHtml(memory.email)}</span></div>
        </div>
      </div>` : ''}

      ${topics.length ? `
      <div class="cvp-section">
        <div class="cvp-section-title">🏷️ Topics Discussed</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.4rem;">
          ${topics.map(t => `<span class="kb-kw-chip">${escHtml(t)}</span>`).join('')}
        </div>
      </div>` : ''}

      ${chat.page ? `
      <div class="cvp-section" style="grid-column:1/-1;">
        <div class="cvp-section-title">📄 Page Visited</div>
        <div style="font-size:0.75rem;color:var(--muted);word-break:break-all;margin-top:0.3rem;">${escHtml(chat.page)}</div>
      </div>` : ''}
    </div>

    <div class="cvp-actions">
      <button class="btn btn-outline btn-sm" onclick="selectSupportChat('${sessionId}');closeVisitorPopup()">
        💬 Open Chat
      </button>
      ${memory.email ? `<button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${memory.email}');toast('Email copied!','success')">
        📋 Copy Email
      </button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="if(confirm('Delete this chat?')){CS_SELECTED_SESSION='${sessionId}';deleteSupportChat();closeVisitorPopup()}">
        🗑 Delete
      </button>
    </div>`;

  popup.classList.add('open');
}

function closeVisitorPopup() {
  document.getElementById('csVisitorPopup')?.classList.remove('open');
}


// ══════════════════════════════════════════════════════════════
// ── 5. CHAT HISTORY TIMELINE ──────────────────────────────────
// ══════════════════════════════════════════════════════════════
function showChatHistoryTimeline(sessionId) {
  const chat = CS_CHATS.find(c => c.session_id === sessionId);
  if (!chat) return;
  const msgs = chat.messages || [];
  const modal = document.getElementById('csHistoryModal');
  const content = document.getElementById('csHistoryContent');
  if (!modal || !content) return;

  // Group by date
  const byDate = {};
  msgs.forEach(m => {
    const d = m.date || new Date().toLocaleDateString();
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  });

  content.innerHTML = `
    <div style="font-size:0.82rem;color:var(--muted);margin-bottom:1rem;">
      ${msgs.length} total messages · Session: ${sessionId.substring(0,20)}...
    </div>
    ${Object.entries(byDate).map(([date, dayMsgs]) => `
      <div class="cs-timeline-date">${date}</div>
      ${dayMsgs.map(m => `
        <div class="cs-timeline-msg ${m.role}">
          <div class="cs-timeline-role">${m.role === 'user' ? '👤 Visitor' : m.role === 'human_agent' ? '👨‍💼 Agent' : '🤖 AI'}</div>
          <div class="cs-timeline-text">${escHtml((m.content||'').replace(/\[\[HUMAN_NEEDED\]\]/g,'').substring(0,200))}</div>
          <div class="cs-timeline-time">${m.time || ''}</div>
        </div>`).join('')}
    `).join('')}`;
  modal.classList.add('open');
}

// ══════════════════════════════════════════════════════════════
// ── 6. AI DRAFT ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function generateAIDraft() {
  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat) return;
  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) return toast('API key nahi hai', 'error');

  const btn = document.getElementById('csAiDraftBtn');
  if (btn) { btn.innerHTML = '⏳ Drafting...'; btn.disabled = true; }

  const msgs = chat.messages || [];
  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) { if(btn){btn.textContent='✨ AI Draft';btn.disabled=false;} return toast('No user message', 'warning'); }

  const memory = chat.ai_memory || {};
  const systemPrompt = CS_SUPPORT_CONFIG.system_prompt || 'You are a helpful customer support agent.';
  const prompt = `${systemPrompt}

You are helping a human support agent draft a reply.
Visitor's last message: "${lastUserMsg.content}"
Visitor language: ${memory.language || 'unknown'}
Visitor name: ${memory.name || 'unknown'}

Write a SHORT, helpful reply in the SAME language as the visitor. Max 3-4 sentences. Be warm and professional.
Return ONLY the reply text, nothing else.`;

  try {
    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ contents: [{role:'user',parts:[{text:prompt}]}], generationConfig:{temperature:0.6,maxOutputTokens:300} })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text.trim();
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${key}`},
        body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], max_tokens:300, temperature:0.6 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content.trim();
    }
    const inp = document.getElementById('csHumanReplyInp');
    if (inp) { inp.value = result; inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,100)+'px'; inp.focus(); }
    toast('✨ Draft ready — edit aur send karo', 'success');
  } catch(e) { toast('Error: '+e.message, 'error'); }
  finally { if(btn){btn.innerHTML='<i data-lucide="sparkles" width="11" height="11"></i> AI Draft'; btn.disabled=false; if(typeof lucide!=='undefined') lucide.createIcons();} }
}

// ══════════════════════════════════════════════════════════════
// ── 7. AUTO-TRANSLATE ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function translateReply() {
  const inp = document.getElementById('csHumanReplyInp');
  const text = inp?.value.trim();
  if (!text) return toast('Pehle kuch likho', 'warning');

  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  const memory = chat?.ai_memory || {};
  const targetLang = memory.language || 'English';

  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) return toast('API key nahi hai', 'error');

  const btn = document.getElementById('csTranslateBtn');
  if (btn) { btn.innerHTML = '⏳ Translating...'; btn.disabled = true; }

  try {
    const prompt = `Translate this text to ${targetLang}. Return ONLY the translated text:\n\n"${text}"`;
    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ contents: [{role:'user',parts:[{text:prompt}]}], generationConfig:{temperature:0.2,maxOutputTokens:300} })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text.trim();
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${key}`},
        body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], max_tokens:300, temperature:0.2 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content.trim();
    }
    inp.value = result;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    toast(`Translated to ${targetLang}`, 'success');
  } catch(e) { toast('Error: '+e.message, 'error'); }
  finally { if(btn){btn.innerHTML='<i data-lucide="globe" width="11" height="11"></i> Translate'; btn.disabled=false; if(typeof lucide!=='undefined') lucide.createIcons();} }
}

// ══════════════════════════════════════════════════════════════
// ── 8. CANNED RESPONSES ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// FIX: Canned responses ab Firestore mein save hongi — localStorage nahi
// Isse sab devices/browsers pe same responses milenge
let CS_CANNED = [
  { id: 1, title: 'Greeting', text: 'Hello! Thank you for contacting us. How can I help you today?' },
  { id: 2, title: 'Shipping Time', text: 'Your order will be delivered within 3-5 business days.' },
  { id: 3, title: 'Return Policy', text: 'We accept returns within 7 days of delivery. Item must be unused and in original packaging.' },
  { id: 4, title: 'Order Tracking', text: 'Please share your order number and I will check the status for you.' },
  { id: 5, title: 'Closing', text: 'Is there anything else I can help you with? Have a great day! 😊' }
];

// Firestore se canned responses load karo
async function loadCannedResponses() {
  try {
    const snap = await db.collection('support_settings').doc('canned_responses').get();
    if (snap.exists && snap.data().items && snap.data().items.length) {
      CS_CANNED = snap.data().items;
    }
  } catch(e) { console.log('Canned load error:', e); }
}

function renderCannedResponses() {
  const el = document.getElementById('csCannedList');
  if (!el) return;
  el.innerHTML = CS_CANNED.map(c => `
    <div class="cs-canned-item" onclick="insertCanned(${c.id})">
      <div class="cs-canned-title">${escHtml(c.title)}</div>
      <div class="cs-canned-preview">${escHtml(c.text.substring(0,60))}...</div>
    </div>`).join('');
}

function insertCanned(id) {
  const c = CS_CANNED.find(x => x.id === id);
  if (!c) return;
  const inp = document.getElementById('csHumanReplyInp');
  if (inp) {
    inp.value = c.text;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    inp.focus();
  }
  document.getElementById('csCannedPanel')?.classList.remove('open');
}

function toggleCannedPanel() {
  const panel = document.getElementById('csCannedPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    loadCannedResponses().then(renderCannedResponses);
  }
}

async function saveCannedResponse() {
  const title = document.getElementById('csNewCannedTitle')?.value.trim();
  const text = document.getElementById('csNewCannedText')?.value.trim();
  if (!title || !text) return toast('Title aur text dono chahiye', 'error');
  CS_CANNED.push({ id: Date.now(), title, text });
  // FIX: Firestore mein save karo — localStorage nahi
  try {
    await db.collection('support_settings').doc('canned_responses').set({ items: CS_CANNED });
    document.getElementById('csNewCannedTitle').value = '';
    document.getElementById('csNewCannedText').value = '';
    renderCannedResponses();
    toast('Saved to cloud! ☁️', 'success');
  } catch(e) { toast('Save error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
// ── 9. INTERNAL NOTES ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function addInternalNote() {
  const inp = document.getElementById('csNoteInp') || document.getElementById('csHumanReplyInp');
  const text = inp?.value.trim();
  if (!text || !CS_SELECTED_SESSION) return;
  const chat = CS_CHATS.find(c => c.session_id === CS_SELECTED_SESSION);
  if (!chat) return;

  const note = { role: 'internal_note', content: text, time: getCSTime(), agent: 'Admin' };
  const updatedMsgs = [...(chat.messages || []), note];

  try {
    await db.collection('support_chats').doc(chat.id).update({
      messages: updatedMsgs, updated_at: Date.now()
    });
    inp.value = '';
    toast('Note added', 'success');
  } catch(e) { toast('Error: '+e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
// ── 10. EMAIL REQUESTS ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
let CS_EMAIL_REQUESTS = [];

function startEmailRequestsSync() {
  db.collection('support_email_requests')
    .orderBy('created_at', 'desc')
    .limit(50)
    .onSnapshot(snap => {
      CS_EMAIL_REQUESTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (document.getElementById('page-email-requests')?.classList.contains('active')) {
        renderEmailRequests();
      }
      updateEmailRequestsBadge();
    }, err => console.log('Email requests sync error:', err));
}

function updateEmailRequestsBadge() {
  const pending = CS_EMAIL_REQUESTS.filter(r => r.status === 'pending').length;
  const badge = document.getElementById('emailReqNavBadge');
  if (!badge) return;
  badge.textContent = pending;
  badge.style.display = pending > 0 ? 'inline-flex' : 'none';
}

function renderEmailRequests() {
  const el = document.getElementById('emailReqList');
  if (!el) return;

  const filter = document.getElementById('emailReqFilter')?.value || '';
  let reqs = filter ? CS_EMAIL_REQUESTS.filter(r => r.status === filter) : CS_EMAIL_REQUESTS;

  const pending = CS_EMAIL_REQUESTS.filter(r => r.status === 'pending').length;
  const resolved = CS_EMAIL_REQUESTS.filter(r => r.status === 'resolved').length;
  const statsEl = document.getElementById('emailReqStats');
  if (statsEl) statsEl.innerHTML = `
    <div class="cs-stat"><div class="cs-stat-val">${CS_EMAIL_REQUESTS.length}</div><div class="cs-stat-label">Total</div></div>
    <div class="cs-stat"><div class="cs-stat-val" style="color:var(--warning)">${pending}</div><div class="cs-stat-label">Pending</div></div>
    <div class="cs-stat"><div class="cs-stat-val" style="color:var(--success)">${resolved}</div><div class="cs-stat-label">Resolved</div></div>`;

  if (!reqs.length) {
    el.innerHTML = '<div class="empty" style="margin-top:1rem;">No email requests yet</div>';
    return;
  }

  el.innerHTML = reqs.map(r => `
    <div class="email-req-card">
      <div class="email-req-header">
        <div>
          <div class="email-req-email">📧 ${escHtml(r.email || '—')}</div>
          <div class="email-req-meta">${r.created_at ? new Date(r.created_at).toLocaleString() : '—'} · ${escHtml(r.page || '').replace(/https?:\/\/[^/]+/,'')}</div>
        </div>
        <span class="email-req-status ${r.status || 'pending'}">${r.status || 'pending'}</span>
      </div>
      <div class="email-req-issue">${escHtml(r.issue || '—')}</div>
      <div class="email-req-actions">
        <select class="inp" style="font-size:0.78rem;padding:0.3rem 0.6rem;width:auto;" onchange="updateEmailReqStatus('${r.id}', this.value)">
          <option value="pending" ${r.status==='pending'?'selected':''}>⏳ Pending</option>
          <option value="in_progress" ${r.status==='in_progress'?'selected':''}>🔄 In Progress</option>
          <option value="resolved" ${r.status==='resolved'?'selected':''}>✅ Resolved</option>
        </select>
        <button class="btn btn-outline btn-sm" onclick="viewEmailReqChat('${r.session_id}')">💬 View Chat</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmailReq('${r.id}')">🗑</button>
      </div>
      ${r.admin_note ? `<div class="email-req-note">📝 ${escHtml(r.admin_note)}</div>` : ''}
      <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
        <input class="inp" style="font-size:0.78rem;padding:0.3rem 0.6rem;" placeholder="Add admin note..." id="note_${r.id}">
        <button class="btn btn-outline btn-sm" onclick="saveEmailReqNote('${r.id}')">Save Note</button>
      </div>
    </div>`).join('');
}

async function updateEmailReqStatus(id, status) {
  try {
    await db.collection('support_email_requests').doc(id).update({ status, updated_at: Date.now() });
    toast('Status updated', 'success');
  } catch(e) { toast('Error: '+e.message, 'error'); }
}

async function saveEmailReqNote(id) {
  const note = document.getElementById('note_'+id)?.value.trim();
  if (!note) return;
  try {
    await db.collection('support_email_requests').doc(id).update({ admin_note: note, updated_at: Date.now() });
    toast('Note saved', 'success');
  } catch(e) { toast('Error: '+e.message, 'error'); }
}

function deleteEmailReq(id) {
  if (!confirm('Delete this request?')) return;
  db.collection('support_email_requests').doc(id).delete()
    .then(() => toast('Deleted', 'success'))
    .catch(e => toast('Error: '+e.message, 'error'));
}

function viewEmailReqChat(sessionId) {
  if (!sessionId) return;
  nav('support');
  setTimeout(() => {
    csSupportTabSwitch('chats');
    selectSupportChat(sessionId);
  }, 300);
}

// ── IMPROVEMENT: CSV Export — email requests ko download karo ──
function exportEmailRequestsCSV() {
  if (!CS_EMAIL_REQUESTS.length) return toast('Koi email request nahi hai', 'warning');
  const headers = ['Email', 'Issue', 'Status', 'Language', 'Visitor Name', 'Page', 'Date'];
  const rows = CS_EMAIL_REQUESTS.map(r => [
    r.email || '',
    (r.issue || '').replace(/,/g, ';'),
    r.status || 'pending',
    r.language || '',
    r.visitor_name || '',
    (r.page || '').replace(/,/g, ';'),
    r.created_at ? new Date(r.created_at).toLocaleString() : ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `email-requests-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV downloaded! 📥', 'success');
}

// ══════════════════════════════════════════════════════════════
// ── 11. HOOK INTO EXISTING FUNCTIONS ─────────────────────────
// ══════════════════════════════════════════════════════════════

// Play sound when new chat arrives — called from showDashboardAlert in customer-support.js
function playSoundOnNewAlert() { playSupportSound(); }
