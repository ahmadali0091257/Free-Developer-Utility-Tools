/**
 * knowledge-base.js — Aezoon Customer Support
 * RAG (Retrieval Augmented Generation) Knowledge Base
 * - Cards with name + keywords + content
 * - AI finds relevant card automatically
 * - Widget uses KB for accurate answers
 */

// ── State ─────────────────────────────────────────────────────
let KB_CARDS = [];
let KB_EDITING_ID = null;

// ── Firestore Sync — get() instead of onSnapshot to save reads ──
function startKBSync() {
  fetchKBCards();
}

async function fetchKBCards() {
  try {
    const snap = await db.collection('support_kb').orderBy('created_at', 'asc').get();
    KB_CARDS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Always render — tab visibility check removed
    renderKBCards();
    renderKBStats();
  } catch (e) { console.log('KB fetch error:', e); }
}

async function syncKBToConfig() {
  // Save KB summary to support_settings so widget can fetch it
  try {
    const summary = KB_CARDS.map(c => ({
      id: c.id,
      name: c.name,
      keywords: c.keywords || '',
      content: c.content || ''
    }));
    await db.collection('support_settings').doc('knowledge_base').set({
      cards: summary,
      updated_at: Date.now()
    });
  } catch (e) { /* silent */ }
}

// ── Render KB Cards ───────────────────────────────────────────
function renderKBCards() {
  const grid = document.getElementById('kbCardsGrid');
  const empty = document.getElementById('kbEmptyState');
  if (!grid) return;

  const search = (document.getElementById('kbSearchInp')?.value || '').toLowerCase();
  const filtered = KB_CARDS.filter(c =>
    !search ||
    (c.name || '').toLowerCase().includes(search) ||
    (c.keywords || '').toLowerCase().includes(search) ||
    (c.content || '').toLowerCase().includes(search)
  );

  if (!filtered.length) {
    grid.innerHTML = '';
    if (empty) {
      empty.style.display = 'flex';
      // Show different message if search active
      const emptyTitle = empty.querySelector('.kb-empty-title');
      if (emptyTitle) emptyTitle.textContent = search ? 'No cards match your search' : 'No knowledge cards yet';
    }
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = filtered.map(c => {
    const kwList = (c.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 5);
    const preview = (c.content || '').substring(0, 120) + ((c.content || '').length > 120 ? '...' : '');
    return `
      <div class="kb-card" id="kbc-${c.id}">
        <div class="kb-card-header">
          <div class="kb-card-icon">${c.icon || '📄'}</div>
          <div class="kb-card-title">${escHtml(c.name || 'Untitled')}</div>
          <div class="kb-card-actions">
            <button class="kb-action-btn" onclick="openKBModal('${c.id}')" title="Edit">✏️</button>
            <button class="kb-action-btn kb-delete-btn" onclick="deleteKBCard('${c.id}')" title="Delete">🗑</button>
          </div>
        </div>
        <div class="kb-card-keywords">
          ${kwList.map(k => `<span class="kb-kw-chip">${escHtml(k)}</span>`).join('')}
          ${(c.keywords || '').split(',').length > 5 ? `<span class="kb-kw-more">+${(c.keywords || '').split(',').length - 5}</span>` : ''}
        </div>
        <div class="kb-card-preview">${escHtml(preview)}</div>
        <div class="kb-card-footer">
          <span class="kb-card-words">${(c.content || '').trim().split(/\s+/).filter(Boolean).length} words</span>
          <span class="kb-card-updated">Updated ${formatKBDate(c.updated_at)}</span>
        </div>
      </div>`;
  }).join('');
}

function formatKBDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── KB Stats ──────────────────────────────────────────────────
function renderKBStats() {
  const el = document.getElementById('kbStats');
  if (!el) return;
  const totalWords = KB_CARDS.reduce((s, c) => s + (c.content || '').trim().split(/\s+/).filter(Boolean).length, 0);
  const totalKw = KB_CARDS.reduce((s, c) => s + (c.keywords || '').split(',').filter(k => k.trim()).length, 0);
  el.innerHTML = `
    <div class="kb-stat"><span class="kb-stat-val">${KB_CARDS.length}</span><span class="kb-stat-label">Cards</span></div>
    <div class="kb-stat"><span class="kb-stat-val">${totalWords}</span><span class="kb-stat-label">Total Words</span></div>
    <div class="kb-stat"><span class="kb-stat-val">${totalKw}</span><span class="kb-stat-label">Keywords</span></div>`;
}

// ── Open/Close Modal ──────────────────────────────────────────
function openKBModal(id) {
  KB_EDITING_ID = id || null;
  const modal = document.getElementById('kbModal');
  if (!modal) return;

  if (id) {
    const card = KB_CARDS.find(c => c.id === id);
    if (!card) return;
    document.getElementById('kb_name').value = card.name || '';
    document.getElementById('kb_icon').value = card.icon || '📄';
    document.getElementById('kb_keywords').value = card.keywords || '';
    document.getElementById('kb_content').value = card.content || '';
    document.querySelector('#kbModal h3').textContent = '✏️ Edit Knowledge Card';
  } else {
    document.getElementById('kb_name').value = '';
    document.getElementById('kb_icon').value = '📄';
    document.getElementById('kb_keywords').value = '';
    document.getElementById('kb_content').value = '';
    document.querySelector('#kbModal h3').textContent = '➕ Add Knowledge Card';
  }
  modal.classList.add('open');
  setTimeout(() => document.getElementById('kb_name')?.focus(), 100);
}

function closeKBModal() {
  document.getElementById('kbModal')?.classList.remove('open');
  KB_EDITING_ID = null;
}

// ── Save Card ─────────────────────────────────────────────────
async function saveKBCard() {
  const name = document.getElementById('kb_name').value.trim();
  const icon = document.getElementById('kb_icon').value.trim() || '📄';
  const keywords = document.getElementById('kb_keywords').value.trim();
  const content = document.getElementById('kb_content').value.trim();

  if (!name) return toast('Card name required', 'error');
  if (!content) return toast('Content required', 'error');

  const data = { name, icon, keywords, content, updated_at: Date.now() };
  const docId = KB_EDITING_ID || 'kb_' + Date.now();
  if (!KB_EDITING_ID) data.created_at = Date.now();

  try {
    await db.collection('support_kb').doc(docId).set(data, { merge: true });
    await fetchKBCards(); // refresh after save
    await syncKBToConfig();
    closeKBModal();
    toast(KB_EDITING_ID ? 'Card updated!' : 'Card added!', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ── Delete Card ───────────────────────────────────────────────
function deleteKBCard(id) {
  if (!confirm('Delete this knowledge card?')) return;
  db.collection('support_kb').doc(id).delete()
    .then(() => { fetchKBCards(); syncKBToConfig(); toast('Deleted', 'success'); })
    .catch(e => toast('Error: ' + e.message, 'error'));
}

// ── AI Auto-Generate Keywords ─────────────────────────────────
async function kbAiGenerateKeywords() {
  const name = document.getElementById('kb_name').value.trim();
  const content = document.getElementById('kb_content').value.trim();
  if (!name && !content) return toast('Name ya content pehle likho', 'warning');

  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) return toast('API key nahi hai — Settings mein add karo', 'error');

  const btn = document.getElementById('kbGenKwBtn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const prompt = `Generate 10-15 short search keywords for this knowledge card.
Card Name: "${name}"
Content: "${content.substring(0, 500)}"

Rules:
- MUST be ONLY in English. Do not use any Roman Urdu or other languages.
- Include variations and common English misspellings/alternate phrasings
- Short phrases only (1-3 words each)
- Return ONLY a comma-separated list, nothing else
Example: shipping, delivery, order time, dispatch, tracking`;

    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 200 } })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text.trim();
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 0.3 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content.trim();
    }
    document.getElementById('kb_keywords').value = result.replace(/\n/g, ', ');
    toast('Keywords generated!', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = '✨ Auto Keywords'; btn.disabled = false; } }
}

// ── AI Improve Content ────────────────────────────────────────
async function kbAiImproveContent() {
  const content = document.getElementById('kb_content').value.trim();
  if (!content) return toast('Content pehle likho', 'warning');

  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) return toast('API key nahi hai', 'error');

  const btn = document.getElementById('kbImproveBtn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const prompt = `Improve this customer support knowledge card content. Make it:
- Clear and easy to understand
- Well structured with bullet points where needed
- Concise but complete
- Professional tone

Original content:
"${content}"

Return ONLY the improved content, no explanation.`;

    let result = '';
    if (model.startsWith('gemini')) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 600 } })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.candidates[0].content.parts[0].text.trim();
    } else {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.4 })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      result = data.choices[0].message.content.trim();
    }
    document.getElementById('kb_content').value = result;
    toast('Content improved!', 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = '✨ Improve'; btn.disabled = false; } }
}

// ── RAG: Find Relevant Cards ──────────────────────────────────
// Called by widget to find relevant KB cards for a user message
function kbFindRelevantCards(userMsg, allCards) {
  if (!allCards || !allCards.length) return [];
  const msg = userMsg.toLowerCase();

  // Score each card
  const scored = allCards.map(card => {
    let score = 0;
    const keywords = (card.keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    const name = (card.name || '').toLowerCase();
    const content = (card.content || '').toLowerCase();

    // Keyword match (highest weight)
    keywords.forEach(kw => {
      if (kw && msg.includes(kw)) score += 10;
      // Partial match
      if (kw && kw.length > 3 && msg.split(' ').some(w => w.includes(kw) || kw.includes(w))) score += 4;
    });

    // Name match
    name.split(' ').forEach(w => { if (w.length > 2 && msg.includes(w)) score += 5; });

    // Content word match (lower weight)
    const contentWords = content.split(/\s+/).filter(w => w.length > 4);
    const msgWords = msg.split(/\s+/);
    msgWords.forEach(mw => { if (mw.length > 3 && contentWords.includes(mw)) score += 1; });

    return { ...card, score };
  });

  // Return top 2 cards with score > 0
  return scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
}

// ── Template Cards ────────────────────────────────────────────
const KB_TEMPLATES = [
  {
    name: 'Shipping Policy',
    icon: '🚚',
    keywords: 'shipping, delivery, order time, kab aayega, dispatch, tracking, courier, kitne din, deliver',
    content: 'We deliver within 3-5 business days.\n• Standard shipping: Free on orders above AED 100\n• Express shipping: AED 25 (1-2 days)\n• We ship via Aramex and DHL\n• Tracking number sent via email after dispatch'
  },
  {
    name: 'Return & Refund Policy',
    icon: '↩️',
    keywords: 'return, refund, wapas, exchange, money back, cancel, damaged, wrong item, replace',
    content: 'We accept returns within 7 days of delivery.\n• Item must be unused and in original packaging\n• Contact us with your order number to initiate return\n• Refund processed within 3-5 business days\n• Damaged or wrong items: full refund or replacement'
  },
  {
    name: 'Payment Methods',
    icon: '💳',
    keywords: 'payment, pay, card, cash, COD, online payment, visa, mastercard, bank transfer, how to pay',
    content: 'We accept the following payment methods:\n• Credit/Debit Cards (Visa, Mastercard)\n• Cash on Delivery (COD)\n• Bank Transfer\n• PayPal\nAll payments are secure and encrypted.'
  },
  {
    name: 'Order Tracking',
    icon: '📦',
    keywords: 'track, tracking, order status, where is my order, order number, check order, update',
    content: 'To track your order:\n1. Check your email for tracking number\n2. Visit our tracking page\n3. Enter your order number\nOr reply with your order number and we will check for you.'
  },
  {
    name: 'Contact Information',
    icon: '📞',
    keywords: 'contact, phone, email, whatsapp, call, reach, support, help, address',
    content: 'You can reach us through:\n• WhatsApp: +971 XX XXX XXXX\n• Email: support@yourstore.com\n• Working hours: 9 AM - 9 PM (Mon-Sat)\n• Response time: Within 2 hours'
  }
];

function loadKBTemplate(idx) {
  const t = KB_TEMPLATES[idx];
  if (!t) return;
  document.getElementById('kb_name').value = t.name;
  document.getElementById('kb_icon').value = t.icon;
  document.getElementById('kb_keywords').value = t.keywords;
  document.getElementById('kb_content').value = t.content;
  toast('Template loaded!', 'success');
}

function renderKBTemplates() {
  const el = document.getElementById('kbTemplatesList');
  if (!el) return;
  el.innerHTML = KB_TEMPLATES.map((t, i) => `
    <button class="kb-template-chip" onclick="loadKBTemplate(${i})">${t.icon} ${t.name}</button>`).join('');
}

// ── Tab switch ────────────────────────────────────────────────
function switchToKBTab() {
  csSupportTabSwitch('kb');
  const grid = document.getElementById('kbCardsGrid');
  if (grid && KB_CARDS.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--muted);">
      <div style="font-size:1.5rem;margin-bottom:0.5rem;">⏳</div>Loading cards...
    </div>`;
  }
  fetchKBCards().then(() => {
    renderKBStats();
    renderKBTemplates();
  });
}

function kbSubTab(tab) {
  const cards = document.getElementById('kbSubCards');
  const ai = document.getElementById('kbSubAI');
  const btnCards = document.getElementById('kbSubTabCards');
  const btnAI = document.getElementById('kbSubTabAI');
  if (tab === 'cards') {
    if (cards) cards.style.display = 'flex';
    if (ai) ai.style.display = 'none';
    if (btnCards) btnCards.classList.add('active');
    if (btnAI) btnAI.classList.remove('active');
  } else {
    if (cards) cards.style.display = 'none';
    if (ai) { ai.style.display = 'flex'; }
    if (btnCards) btnCards.classList.remove('active');
    if (btnAI) btnAI.classList.add('active');
    renderKBAIChat();
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 50);
  }
}

// ══════════════════════════════════════════════════════════════
// ── AI KB MANAGER — Analyze, Create, Edit Cards Automatically ─
// ══════════════════════════════════════════════════════════════

let KB_AI_HISTORY = [];
let KB_AI_TYPING = false;

// ── Main AI call for KB management ───────────────────────────
async function callKBAI(userMsg) {
  const key = CS_SUPPORT_CONFIG.api_key || '';
  const model = CS_SUPPORT_CONFIG.model || 'gemini-1.5-flash';
  if (!key) throw new Error('API key nahi hai — Settings mein add karo');

  // Build current KB context
  const kbContext = KB_CARDS.length
    ? KB_CARDS.map(c => `[${c.icon || '📄'} ${c.name}]\nKeywords: ${c.keywords || ''}\nContent: ${(c.content || '').substring(0, 300)}`).join('\n\n')
    : '(No cards yet)';

  const systemPrompt = `You are an expert Knowledge Base Manager for an e-commerce customer support system.

CURRENT KNOWLEDGE BASE CARDS:
${kbContext}

YOUR CAPABILITIES:
1. ANALYZE existing cards — find gaps, missing info, weak keywords
2. CREATE new cards — when business info is provided that has no card
3. EDIT existing cards — improve content, add missing info, fix keywords
4. ASK smart questions — if info is incomplete, ask ONE specific question

CARD FORMAT (when creating/editing, always use this JSON format):
\`\`\`kb_action
{
  "action": "create" | "edit" | "delete",
  "card_id": "existing_id_if_editing",
  "name": "Card Name",
  "icon": "emoji",
  "keywords": "keyword1, keyword2, roman urdu keywords, english keywords",
  "content": "Full card content here"
}
\`\`\`

RULES:
- Always check if a similar card already exists before creating new one
- If card exists but is incomplete → suggest EDIT with improved version
- Keywords must include BOTH English AND Roman Urdu variations
- Content must be specific, not generic — use real info provided
- Ask ONE question at a time if info is missing
- After any action, ask: "Kuch aur improve karna hai?"

CONVERSATION STYLE:
- Reply in same language as user (Roman Urdu / English)
- Be direct and efficient
- Show what you found/changed clearly`;

  const history = KB_AI_HISTORY.slice(-12);

  if (model.startsWith('gemini')) {
    const msgs = [
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      { role: 'user', parts: [{ text: userMsg }] }
    ];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: msgs,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500 }
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
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: 1500, temperature: 0.4 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }
}

// ── Send message to KB AI ─────────────────────────────────────
async function sendKBAIMsg() {
  const input = document.getElementById('kbAiInput');
  const text = input?.value.trim();
  if (!text || KB_AI_TYPING) return;
  input.value = '';
  input.style.height = 'auto';
  await sendKBAIMsgInternal(text);
}

async function sendKBAIMsgInternal(text) {
  if (KB_AI_TYPING) return;
  KB_AI_TYPING = true;

  const time = getCSTime();
  KB_AI_HISTORY.push({ role: 'user', content: text, time });
  renderKBAIChat();
  showKBAITyping();

  try {
    const reply = await callKBAI(text);
    hideKBAITyping();
    KB_AI_TYPING = false;
    KB_AI_HISTORY.push({ role: 'assistant', content: reply, time: getCSTime() });
    renderKBAIChat();

    // Parse and execute any kb_action blocks
    const actionMatches = [...reply.matchAll(/```kb_action\n([\s\S]*?)```/g)];
    for (const match of actionMatches) {
      try {
        const action = JSON.parse(match[1].trim());
        await executeKBAction(action);
      } catch (e) { console.log('KB action parse error:', e); }
    }
  } catch (e) {
    hideKBAITyping();
    KB_AI_TYPING = false;
    KB_AI_HISTORY.push({ role: 'assistant', content: '❌ Error: ' + e.message, time: getCSTime() });
    renderKBAIChat();
  }
}

// ── Execute KB action from AI ─────────────────────────────────
async function executeKBAction(action) {
  if (!action || !action.action) return;

  const data = {
    name: action.name || 'Untitled',
    icon: action.icon || '📄',
    keywords: action.keywords || '',
    content: action.content || '',
    updated_at: Date.now()
  };

  try {
    if (action.action === 'create') {
      const docId = 'kb_' + Date.now();
      data.created_at = Date.now();
      await db.collection('support_kb').doc(docId).set(data);
      await fetchKBCards();
      await syncKBToConfig();
      toast(`✅ Card created: ${data.name}`, 'success');
    } else if (action.action === 'edit' && action.card_id) {
      await db.collection('support_kb').doc(action.card_id).update(data);
      await fetchKBCards();
      await syncKBToConfig();
      toast(`✅ Card updated: ${data.name}`, 'success');
    } else if (action.action === 'delete' && action.card_id) {
      await db.collection('support_kb').doc(action.card_id).delete();
      await fetchKBCards();
      await syncKBToConfig();
      toast(`🗑 Card deleted: ${data.name}`, 'success');
    }
    // Re-render KB stats
    renderKBStats();
  } catch (e) { toast('KB action error: ' + e.message, 'error'); }
}

// ── Render KB AI Chat ─────────────────────────────────────────
function renderKBAIChat() {
  const container = document.getElementById('kbAiMessages');
  if (!container) return;

  if (!KB_AI_HISTORY.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--muted);">
        <div style="font-size:2.5rem;margin-bottom:0.8rem;">🧠</div>
        <div style="font-weight:600;color:var(--text);margin-bottom:0.5rem;">KB AI Manager</div>
        <div style="font-size:0.8rem;line-height:1.7;">
          Main tumhari Knowledge Base ko analyze aur improve karta hoon.<br><br>
          <strong style="color:var(--text);">Kya kar sakta hoon:</strong><br>
          • <b>Cards analyze karo</b> — gaps aur missing info dhundho<br>
          • <b>New cards banao</b> — business info se automatically<br>
          • <b>Existing cards improve karo</b> — better content aur keywords<br>
          • <b>Business analyze karo</b> — batao kya sell karte ho<br><br>
          <em>Shuru karo: "Mere cards analyze karo" ya "Mera store X hai..."</em>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = KB_AI_HISTORY.map(m => {
    const isUser = m.role === 'user';
    let formatted = (m.content || '')
      // Render kb_action blocks as preview cards
      .replace(/```kb_action\n([\s\S]*?)```/g, (_, json) => {
        try {
          const a = JSON.parse(json.trim());
          const actionLabel = a.action === 'create' ? '✅ Creating Card' : a.action === 'edit' ? '✏️ Editing Card' : '🗑 Deleting Card';
          return `<div class="kb-ai-action-card">
            <div class="kb-ai-action-header">${actionLabel}: ${escHtml(a.name || '')}</div>
            ${a.keywords ? `<div class="kb-ai-action-kw">🏷️ ${escHtml(a.keywords.substring(0, 80))}...</div>` : ''}
            ${a.content ? `<div class="kb-ai-action-preview">${escHtml(a.content.substring(0, 120))}...</div>` : ''}
          </div>`;
        } catch { return ''; }
      })
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>');

    return `<div class="cs-msg-row ${isUser ? 'user' : 'bot'}">
      <div class="cs-bubble ${isUser ? 'user' : 'bot'}">${formatted}<div class="cs-bubble-time">${m.time || ''}</div></div>
    </div>`;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function showKBAITyping() {
  const c = document.getElementById('kbAiMessages');
  if (!c) return;
  const el = document.createElement('div');
  el.id = 'kbAiTyping';
  el.className = 'cs-msg-row bot';
  el.innerHTML = `<div class="cs-typing-bubble"><span></span><span></span><span></span></div>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}
function hideKBAITyping() { document.getElementById('kbAiTyping')?.remove(); }

// ── Quick Actions for KB AI ───────────────────────────────────
async function kbAiQuickAction(action) {
  const messages = {
    analyze: 'Mere saare KB cards analyze karo. Kya missing hai? Kaunse cards weak hain? Kya improve karna chahiye?',
    gaps: 'Meri business ke liye kaunse important topics ke cards missing hain? Common customer questions ke liye cards check karo.',
    improve_all: 'Saare cards ke keywords improve karo — Roman Urdu aur English dono add karo jahan missing hain.',
    business_analyze: 'Meri business analyze karo. Jo cards hain unse pata lagao main kya sell karta hoon aur kya missing info hai jo customers pooch sakte hain.'
  };
  const msg = messages[action];
  if (!msg) return;
  await sendKBAIMsgInternal(msg);
}

// ── Handle file upload for KB AI ──────────────────────────────
function handleKBAIFileUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  let processed = 0;
  const contents = [];

  files.forEach(file => {
    if (file.size > 300000) { toast(`${file.name} too large`, 'warning'); processed++; return; }
    const reader = new FileReader();
    reader.onload = e => {
      contents.push({ name: file.name, text: e.target.result.substring(0, 5000) });
      processed++;
      if (processed === files.length) {
        input.value = '';
        const combined = contents.map(f => `[File: ${f.name}]\n${f.text}`).join('\n\n---\n\n');
        const msg = `[FILES] Yeh files analyze karo aur inse KB cards banao ya existing cards improve karo:\n\n${combined}`;
        sendKBAIMsgInternal(msg);
      }
    };
    reader.onerror = () => { processed++; };
    reader.readAsText(file);
  });
}
