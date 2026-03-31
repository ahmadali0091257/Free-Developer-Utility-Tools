// ── AI TEAM ───────────────────────────────────────────────────
// Roman Urdu mein baat karte hain, WhatsApp style UI

const AI_AGENTS = {
  roast: {
    id: 'roast',
    name: '😤 Roast Bot',
    subtitle: 'Savage Feedback AI',
    emoji: '😤',
    avatarClass: 'roast',
    preview: 'Bhai kya kar raha hai tu...',
    defaultPrompt: `Tu Roast Bot hai — ek savage lekin helpful AI jo Aezoon business dashboard ka data dekh ke honest aur funny feedback deta hai.
Tera kaam: Business performance pe savage roast karna, profit kam ho toh taunt karna, mistakes pe funny commentary dena, lekin end mein useful advice bhi dena.
Tu Roman Urdu mein baat karta hai — funny, savage, aur direct. Emojis use kar. Kabhi kabhi "Bhai..." se shuru kar.
Roast karo lekin end mein ek useful tip zaroor do. Zyada harsh mat hona — friendly roast, not mean.`,
    defaultModel: 'gemini-1.5-flash',
    color: '#b71c1c'
  }
};

// State
let AI_CONFIGS = {};
let AI_HISTORIES = { roast: [] };
let currentAgent = null;
let isTyping = false;
let AI_UNREAD = { roast: 0 };

// Roast Bot auto-message timer
let roastAutoTimer = null;

// ── Init ──────────────────────────────────────────────────────
function initAiTeam() {
  loadAiConfigs();
  renderAiContacts();
  loadAiHistories();
  startRoastAutoScheduler();
}

async function loadAiConfigs() {
  try {
    const snap = await db.collection("settings").doc("ai_team_config").get();
    if (snap.exists) AI_CONFIGS = snap.data();
    else {
      AI_CONFIGS = {};
      Object.keys(AI_AGENTS).forEach(id => {
        AI_CONFIGS[id] = { prompt: AI_AGENTS[id].defaultPrompt, model: AI_AGENTS[id].defaultModel, api_key: '' };
      });
    }
  } catch(e) { console.log('AI config load error:', e); }
}

async function loadAiHistories() {
  try {
    const snap = await db.collection("ai_team_history").doc("chats").get();
    if (snap.exists) {
      const data = snap.data();
      Object.keys(AI_AGENTS).forEach(id => {
        AI_HISTORIES[id] = data[id] || [];
        const hist = AI_HISTORIES[id];
        if (hist.length > 0) AI_AGENTS[id].preview = hist[hist.length-1].content.substring(0,40)+'...';
      });
      renderAiContacts();
    }
  } catch(e) { console.log('History load error:', e); }
}

async function saveAiHistories() {
  try {
    const payload = { updatedAt: Date.now() };
    Object.keys(AI_AGENTS).forEach(id => { payload[id] = AI_HISTORIES[id].slice(-30); });
    await db.collection("ai_team_history").doc("chats").set(payload);
  } catch(e) { console.log('History save error:', e); }
}

// ── Notification Badge ────────────────────────────────────────
function addUnread(agentId) {
  if (currentAgent === agentId) return; // already open
  AI_UNREAD[agentId] = (AI_UNREAD[agentId] || 0) + 1;
  renderAiContacts();
  updateNavBadge();
}

function clearUnread(agentId) {
  AI_UNREAD[agentId] = 0;
  renderAiContacts();
  updateNavBadge();
}

function updateNavBadge() {
  const total = Object.values(AI_UNREAD).reduce((s,n) => s+n, 0);
  let badge = document.getElementById('aiTeamNavBadge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Render Contacts ───────────────────────────────────────────
function renderAiContacts() {
  const list = document.getElementById('aiContactList');
  if (!list) return;
  list.innerHTML = Object.values(AI_AGENTS).map(agent => {
    const unread = AI_UNREAD[agent.id] || 0;
    return `
    <div class="ai-contact ${currentAgent === agent.id ? 'active' : ''}" onclick="selectAiAgent('${agent.id}')">
      <div class="ai-avatar-wrap">
        <div class="ai-avatar ${agent.avatarClass}">${agent.emoji}</div>
        <div class="ai-online-dot"></div>
      </div>
      <div class="ai-contact-info">
        <div class="ai-contact-name">${agent.name}</div>
        <div class="ai-contact-preview">${agent.preview}</div>
      </div>
      <div class="ai-contact-meta">
        <div class="ai-contact-time ${unread > 0 ? 'unread' : ''}">${getTimeStr()}</div>
        ${unread > 0 ? `<div class="ai-unread-badge">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function getTimeStr() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Select Agent ──────────────────────────────────────────────
function selectAiAgent(agentId) {
  currentAgent = agentId;
  const agent = AI_AGENTS[agentId];
  clearUnread(agentId);

  document.getElementById('aiChatHeaderAvatar').className = `ai-avatar ${agent.avatarClass}`;
  document.getElementById('aiChatHeaderAvatar').textContent = agent.emoji;
  document.getElementById('aiChatHeaderName').textContent = agent.name;
  document.getElementById('aiChatHeaderStatus').textContent = 'Online';
  document.getElementById('aiChatHeaderStatus').className = 'ai-chat-header-status';

  document.getElementById('aiEmptyState').style.display = 'none';
  document.getElementById('aiChatMain').style.display = 'flex';

  renderAiContacts();
  renderMessages(agentId);
  setTimeout(() => document.getElementById('aiMsgInput')?.focus(), 100);
}

// ── Render Messages ───────────────────────────────────────────
function renderMessages(agentId) {
  const container = document.getElementById('aiMessagesContainer');
  if (!container) return;
  const history = AI_HISTORIES[agentId] || [];

  if (!history.length) {
    const agent = AI_AGENTS[agentId];
    const welcomes = {
      roast: `Yaar! Main <b>Roast Bot</b> hoon — tera savage business advisor. 😤<br><br>Mujhe bata tera business kaisa chal raha hai, main honest feedback dunga. Aur haan, thoda roast bhi hoga! 🔥<br><br><i>Tip: "Mera business analyze karo" ya "Aaj ka performance batao" bol.</i>`,
      coach: `Chalo! Main <b>Coach Z</b> hoon — tera personal business coach. 🏆<br><br>Main tujhe daily targets set karne mein, goals achieve karne mein, aur slow days mein motivate karne mein help karunga.<br><br><i>Tip: "Aaj ka target set karo" ya "Mujhe motivate karo" bol.</i>`,
      fortune: `✨ Assalam o Alaikum... Main <b>Madame Zara</b> hoon — business ki fortune teller. 🔮<br><br>Taaron ne mujhe bheja hai tere business ka future dekhne ke liye. Crystal ball mein tera data chamak raha hai...<br><br><i>Tip: "Aglay hafte ka forecast do" ya "Konsa product zyada bikne wala hai" poocho.</i>`
    };
    container.innerHTML = `
      <div class="ai-date-sep"><span>Aaj</span></div>
      <div class="ai-msg-row bot">
        <div class="ai-bubble bot">${welcomes[agentId] || 'Salam!'}<div class="ai-bubble-time">${getTimeStr()}</div></div>
      </div>`;
    container.scrollTop = container.scrollHeight;
    return;
  }

  container.innerHTML = `<div class="ai-date-sep"><span>Aaj</span></div>`;
  history.forEach(msg => {
    const isUser = msg.role === 'user';
    const isAuto = msg.auto === true;
    const formatted = msg.content
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');
    container.innerHTML += `
      <div class="ai-msg-row ${isUser ? 'user' : 'bot'}">
        <div class="ai-bubble ${isUser ? 'user' : 'bot'}" ${isAuto ? 'style="border-left:3px solid #00a884;padding-left:10px;"' : ''}>
          ${formatted}
          <div class="ai-bubble-time">${msg.time || getTimeStr()} ${isUser ? '<svg width="14" height="10" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L15 1" stroke="#53bdeb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</div>
        </div>
      </div>`;
  });
  container.scrollTop = container.scrollHeight;
}

// ── Send Message ──────────────────────────────────────────────
async function sendAiMessage() {
  if (!currentAgent || isTyping) return;
  const input = document.getElementById('aiMsgInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  const time = getTimeStr();

  AI_HISTORIES[currentAgent].push({ role: 'user', content: text, time });
  renderMessages(currentAgent);
  showTypingIndicator();
  isTyping = true;
  document.getElementById('aiChatHeaderStatus').textContent = 'typing...';
  document.getElementById('aiChatHeaderStatus').className = 'ai-chat-header-status typing';

  try {
    const reply = await callAgentAI(currentAgent, text);
    hideTypingIndicator();
    isTyping = false;
    AI_HISTORIES[currentAgent].push({ role: 'assistant', content: reply, time: getTimeStr() });
    AI_AGENTS[currentAgent].preview = reply.substring(0, 40) + '...';
    renderMessages(currentAgent);
    renderAiContacts();
    saveAiHistories();
    document.getElementById('aiChatHeaderStatus').textContent = 'Online';
    document.getElementById('aiChatHeaderStatus').className = 'ai-chat-header-status';
  } catch(e) {
    hideTypingIndicator();
    isTyping = false;
    AI_HISTORIES[currentAgent].push({ role: 'assistant', content: `❌ Error: ${e.message}`, time: getTimeStr() });
    renderMessages(currentAgent);
    document.getElementById('aiChatHeaderStatus').textContent = 'Online';
    document.getElementById('aiChatHeaderStatus').className = 'ai-chat-header-status';
  }
}

// ── AI API Call ───────────────────────────────────────────────
async function callAgentAI(agentId, userMessage) {
  const agentCfg = AI_CONFIGS[agentId] || {};
  const mainCfg = typeof AI_CONFIG !== 'undefined' ? AI_CONFIG : {};
  const model = agentCfg.model || mainCfg.selected_model || mainCfg.model || 'gemini-1.5-flash';
  const isGemini = model.startsWith('gemini');
  const key = agentCfg.api_key || (isGemini ? mainCfg.gemini_key : mainCfg.deepseek_key) || '';
  if (!key) throw new Error('API key nahi mili. Settings mein add karo ⚙️');

  const orders = typeof getOrders === 'function' ? getOrders() : [];
  const expenses = typeof getExpenses === 'function' ? getExpenses() : [];
  const dataContext = buildDataContext(orders, expenses);
  const systemPrompt = (agentCfg.prompt || AI_AGENTS[agentId].defaultPrompt) + dataContext;
  const history = AI_HISTORIES[agentId].slice(-10);

  if (isGemini) {
    const msgs = [
      ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      { role: 'user', parts: [{ text: userMessage }] }
    ];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: msgs, systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { temperature: 0.8, maxOutputTokens: 1024 } })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
  } else {
    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: userMessage }
    ];
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: 1024, temperature: 0.8 })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices[0].message.content;
  }
}

function buildDataContext(orders, expenses) {
  const delivered = orders.filter(o => o.status === 'delivered');
  const returned = orders.filter(o => o.status === 'returned');
  const fake = orders.filter(o => o.status === 'fake');
  const totalProfit = delivered.reduce((s,o) => s+(parseFloat(o.profit_per)||0)*(parseFloat(o.qty)||1), 0);
  const totalRevenue = delivered.reduce((s,o) => s+(parseFloat(o.total)||0), 0);
  const totalExpenses = expenses.filter(e=>e.type==='expense').reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const phoneCounts = {};
  orders.forEach(o => { if(o.phone) phoneCounts[o.phone] = (phoneCounts[o.phone]||0)+1; });
  const duplicatePhones = Object.entries(phoneCounts).filter(([,c])=>c>1).length;
  const cities = {};
  orders.forEach(o => { if(o.city) cities[o.city] = (cities[o.city]||0)+1; });
  const topCities = Object.entries(cities).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>`${c}:${n}`).join(', ');
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(o => o.date === today);
  return `\n\n--- LIVE DATA ---
Total Orders: ${orders.length} | Delivered: ${delivered.length} | Returned: ${returned.length} | Fake: ${fake.length}
Today Orders: ${todayOrders.length} | Today Delivered: ${todayOrders.filter(o=>o.status==='delivered').length}
Revenue: AED ${totalRevenue.toFixed(2)} | Gross Profit: AED ${totalProfit.toFixed(2)} | Expenses: AED ${totalExpenses.toFixed(2)} | Net: AED ${(totalProfit-totalExpenses).toFixed(2)}
Duplicate Phones: ${duplicatePhones} | Top Cities: ${topCities||'N/A'}
Recent 5: ${JSON.stringify(orders.slice(-5).map(o=>({id:o.custom_id,name:o.customer_name,city:o.city,product:o.product,status:o.status,total:o.total})))}
--- END ---`;
}

// ── Typing Indicator ──────────────────────────────────────────
function showTypingIndicator() {
  const container = document.getElementById('aiMessagesContainer');
  const el = document.createElement('div');
  el.id = 'aiTypingIndicator';
  el.className = 'ai-typing-row';
  el.innerHTML = `<div class="ai-typing-dots"><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div></div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}
function hideTypingIndicator() { document.getElementById('aiTypingIndicator')?.remove(); }

// ── Roast Auto-Scheduler ──────────────────────────────────────
const ROAST_SCHEDULE = [
  { hour: 14, minute: 0, label: '2:00 PM' },
  { hour: 23, minute: 0, label: '11:00 PM' }
];

function startRoastAutoScheduler() {
  if (roastAutoTimer) clearInterval(roastAutoTimer);
  roastAutoTimer = setInterval(() => checkRoastSchedule(), 60 * 1000);
  checkRoastSchedule();
}

async function checkRoastSchedule() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const todayKey = now.toISOString().split('T')[0];
  for (const slot of ROAST_SCHEDULE) {
    if (h === slot.hour && m === slot.minute) {
      const firebaseKey = `roast_auto_${todayKey}_${slot.hour}`;
      try {
        const snap = await db.collection("roast_auto_log").doc(firebaseKey).get();
        if (snap.exists) return;
        await db.collection("roast_auto_log").doc(firebaseKey).set({ sentAt: Date.now(), slot: slot.label });
        await roastBotAutoMessage(slot.label);
      } catch(e) { console.log('Roast schedule error:', e); }
    }
  }
}

async function roastBotAutoMessage(timeLabel) {
  const orders = typeof getOrders === 'function' ? getOrders() : [];
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(o => o.date === today);
  const todayDelivered = todayOrders.filter(o => o.status === 'delivered');
  const todayProfit = todayDelivered.reduce((s,o) => s+(parseFloat(o.profit_per)||0)*(parseFloat(o.qty)||1), 0);
  const isEvening = timeLabel === '11:00 PM';

  const prompt = isEvening
    ? `Aaj ka din khatam. Data: ${todayOrders.length} orders, ${todayDelivered.length} delivered, AED ${todayProfit.toFixed(2)} profit. Raat 11 baje ka end-of-day savage roast do. 3-4 lines. Roman Urdu. 😤`
    : `Dopahar ho gayi. Data: ${todayOrders.length} orders, ${todayDelivered.length} delivered, AED ${todayProfit.toFixed(2)} profit. Mid-day check-in roast do. 3-4 lines. Roman Urdu. 😤`;

  try {
    const reply = await callAgentAI('roast', prompt);
    const autoMsg = `🤖 _Auto (${timeLabel})_\n\n${reply}`;
    AI_HISTORIES.roast.push({ role: 'assistant', content: autoMsg, time: getTimeStr(), auto: true });
    AI_AGENTS.roast.preview = `🤖 ${reply.substring(0, 30)}...`;
    if (currentAgent === 'roast') renderMessages('roast');
    addUnread('roast'); // notification badge
    renderAiContacts();
    await saveAiHistories();
  } catch(e) { console.log('Roast auto message error:', e); }
}

// ── Clear Chat ────────────────────────────────────────────────
function clearAiChat() {
  if (!currentAgent) return;
  if (!confirm('Is chat ko clear karein?')) return;
  AI_HISTORIES[currentAgent] = [];
  renderMessages(currentAgent);
  saveAiHistories();
}

// ── Settings ──────────────────────────────────────────────────
function openAiTeamSettings() {
  document.getElementById('aiSettingsOverlay').classList.add('open');
  renderAiSettingsCards();
}
function closeAiTeamSettings() { document.getElementById('aiSettingsOverlay').classList.remove('open'); }

function renderAiSettingsCards() {
  const container = document.getElementById('aiConfigCards');
  container.innerHTML = Object.values(AI_AGENTS).map(agent => {
    const cfg = AI_CONFIGS[agent.id] || {};
    return `
      <div class="ai-config-card">
        <div class="ai-config-card-header">
          <div class="ai-avatar ${agent.avatarClass}">${agent.emoji}</div>
          <div><div class="ai-config-card-name">${agent.name}</div><div style="font-size:0.72rem;color:#8696a0;">${agent.subtitle}</div></div>
        </div>
        <div class="ai-config-card-body">
          <div><label class="ai-cfg-label">AI Model</label>
            <select class="ai-cfg-inp" id="cfg_model_${agent.id}">
              <option value="gemini-1.5-flash" ${(cfg.model||'gemini-1.5-flash')==='gemini-1.5-flash'?'selected':''}>Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro" ${cfg.model==='gemini-1.5-pro'?'selected':''}>Gemini 1.5 Pro</option>
              <option value="deepseek-chat" ${cfg.model==='deepseek-chat'?'selected':''}>DeepSeek V3</option>
              <option value="deepseek-reasoner" ${cfg.model==='deepseek-reasoner'?'selected':''}>DeepSeek R1</option>
            </select>
          </div>
          <div><label class="ai-cfg-label">API Key (optional)</label>
            <input class="ai-cfg-inp" id="cfg_key_${agent.id}" type="text" placeholder="Leave empty to use Dashboard key" value="${cfg.api_key||''}" autocomplete="off" spellcheck="false">
          </div>
          <div><label class="ai-cfg-label">System Prompt</label>
            <textarea class="ai-cfg-inp ai-cfg-textarea" id="cfg_prompt_${agent.id}" rows="4">${cfg.prompt || agent.defaultPrompt}</textarea>
          </div>
          <button class="ai-cfg-save" onclick="saveAgentConfig('${agent.id}')">💾 Save ${agent.name}</button>
        </div>
      </div>`;
  }).join('');
}

async function saveAgentConfig(agentId) {
  const model = document.getElementById(`cfg_model_${agentId}`).value;
  const key = document.getElementById(`cfg_key_${agentId}`).value.trim().replace(/\s+/g,'');
  const prompt = document.getElementById(`cfg_prompt_${agentId}`).value.trim();
  AI_CONFIGS[agentId] = { model, api_key: key, prompt };
  try {
    await db.collection("settings").doc("ai_team_config").set(AI_CONFIGS, { merge: true });
    const btn = document.querySelector(`[onclick="saveAgentConfig('${agentId}')"]`);
    if (btn) { btn.textContent = '✅ Saved!'; setTimeout(() => btn.textContent = `💾 Save ${AI_AGENTS[agentId].name}`, 2000); }
  } catch(e) { alert('Save failed: ' + e.message); }
}

// ── Input auto-resize ─────────────────────────────────────────
function aiInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
  const ta = e.target;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}
