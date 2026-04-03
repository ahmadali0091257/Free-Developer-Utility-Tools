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
- Include variations (English + Roman Urdu if relevant)
- Include common misspellings/alternate phrasings
- Short phrases only (1-3 words each)
- Return ONLY a comma-separated list, nothing else
Example: shipping, delivery, order time, kab aayega, dispatch, tracking`;

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
  // Show loading state
  const grid = document.getElementById('kbCardsGrid');
  if (grid && KB_CARDS.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--muted);">
      <div style="font-size:1.5rem;margin-bottom:0.5rem;">⏳</div>Loading cards...
    </div>`;
  }
  // Always fetch fresh from Firestore when tab opens
  fetchKBCards().then(() => {
    renderKBStats();
    renderKBTemplates();
  });
}
