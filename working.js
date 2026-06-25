/**
 * working.js — Aezoon Dashboard Fixes
 * Data always comes from GLOBAL_ORDERS / GLOBAL_EXPENSES (Firebase real-time)
 * getOrders() and getExpenses() are defined in index.html and return those globals
 */

// ── OTHER FIXES ───────────────────────────────────────────────

function renderSettings() {
  const storageEl = document.getElementById('storageInfo');
  if (storageEl) storageEl.innerHTML = `<strong>Cloud Count:</strong> ${(typeof getOrders==='function'?getOrders():[]).length} Orders | ${(typeof getExpenses==='function'?getExpenses():[]).length} Entries`;
  applyAiConfigToUI();
}

function deleteExpense(id) {
  if (!confirm('Delete this entry?')) return;
  db.collection("expenses").doc(id).delete()
    .then(() => toast('Deleted', 'success'))
    .catch(e => toast('Error: ' + e.message, 'error'));
}

function confirmClearLocalData() {
  toast('Data is stored in Firebase Cloud — use Settings > Cloud Management to delete.', 'warning');
}

function exportBackup() {
  const orders = typeof getOrders === 'function' ? getOrders() : [];
  const expenses = typeof getExpenses === 'function' ? getExpenses() : [];
  const b = new Blob([JSON.stringify({ v:'2.1_Cloud', date:new Date().toISOString(), orders, expenses }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `Aezoon_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  toast('Exported!', 'success');
}

function importBackup(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.orders) localStorage.setItem(KEYS.orders, JSON.stringify(d.orders));
      if (d.expenses) localStorage.setItem(KEYS.expenses, JSON.stringify(d.expenses));
      toast('Imported!', 'success');
      renderSettings(); renderDashboard();
    } catch (err) { toast('Invalid file!', 'error'); }
  };
  r.readAsText(f);
}

function confirmClearData() {
  if (!confirm('ARE YOU ABSOLUTELY SURE? This will wipe ALL CLOUD data!')) return;
  db.collection("orders").get().then(res => res.forEach(d => d.ref.delete()));
  db.collection("expenses").get().then(res => res.forEach(d => d.ref.delete()));
  db.collection("ai_goals").get().then(res => res.forEach(d => d.ref.delete()));
  toast('All Cloud Data Cleared.', 'success');
}

function showOrderDetail(id) {
  const o = getOrders().find(x => x.id === id);
  if (!o) return;
  document.getElementById('orderDetailContent').innerHTML = `
    <div class="order-detail-grid">
      <div class="detail-row"><div class="detail-label">Order #</div><div class="detail-val">${o.custom_id||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">Customer</div><div class="detail-val">${o.customer_name}</div></div>
      <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-val">${o.phone||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">City</div><div class="detail-val">${o.city||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">Product</div><div class="detail-val">${o.product} × ${o.qty}</div></div>
      <div class="detail-row"><div class="detail-label">Total</div><div class="detail-val" style="color:var(--success)">AED ${fmt(o.total)}</div></div>
      <div class="detail-row"><div class="detail-label">Profit</div><div class="detail-val" style="color:var(--primary)">AED ${fmt((o.profit_per||0)*(o.qty||1))}</div></div>
      <div class="detail-row"><div class="detail-label">Date</div><div class="detail-val">${o.date}</div></div>
      ${o.age||o.gender?`<div class="detail-row"><div class="detail-label">Age / Gender</div><div class="detail-val">${o.age||'—'} / ${o.gender||'—'}</div></div>`:''}
      <div class="detail-row" style="grid-column:1/-1"><div class="detail-label">Address</div><div class="detail-val">${o.address||'—'}</div></div>
      ${o.notes?`<div class="detail-row" style="grid-column:1/-1"><div class="detail-label">Notes</div><div class="detail-val">${o.notes}</div></div>`:''}
      ${o.tracking_id?`<div class="detail-row"><div class="detail-label">Tracking ID</div><div class="detail-val" style="color:var(--info);font-weight:600;">${o.tracking_id}</div></div>`:''}
      ${o.correct_status?`<div class="detail-row"><div class="detail-label">Correct Status</div><div class="detail-val" style="color:var(--primary);font-weight:600;">${o.correct_status}</div></div>`:''}
      ${o.notes_extra?`<div class="detail-row" style="grid-column:1/-1"><div class="detail-label">Extra Notes</div><div class="detail-val">${o.notes_extra}</div></div>`:''}
    </div>
    ${typeof buildOrderTimeline === 'function' ? `<div style="margin:0.5rem 0 0.8rem;"><div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:0.4rem;">Status Timeline</div>${buildOrderTimeline(o)}</div>` : ''}
    <div style="display:flex;gap:0.8rem;align-items:center;margin-top:0.5rem;">
      <select class="inp" id="detail_status_${o.id}" style="flex:1;">
        ${['unfulfilled','processing','shipped','delivered','returned','cancel','fake','no_response'].map(s=>
          `<option value="${s}" ${o.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
        ).join('')}
      </select>
      <button class="btn btn-primary" onclick="updStatus('${o.id}')">Update Status</button>
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="openOrderModal('${o.id}');closeModal('orderDetailModal')">✏️ Edit</button>
      <button class="btn btn-danger" onclick="DataManager.deleteOrder('${o.id}');closeModal('orderDetailModal')">🗑 Delete</button>
    </div>
  `;
  document.getElementById('orderDetailModal').classList.add('open');
}

// ── Customers System ──────────────────────────────────────────
let MANUAL_CUSTOMERS = [];

function startCustomerSync() {
  db.collection("customers").onSnapshot(snap => {
    MANUAL_CUSTOMERS = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (document.getElementById('page-customers')?.classList.contains('active')) renderCustomers();
  });
}

function buildCustomerMap() {
  const orders = getOrders();
  const map = {};
  orders.forEach(o => {
    const key = (o.phone || o.customer_name || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!key) return;
    if (!map[key]) map[key] = { id:'auto_'+key, name:o.customer_name||'', phone:o.phone||'', city:o.city||'', address:o.address||'', email:o.email||'', notes:'', orders:[], source:'auto' };
    map[key].orders.push(o);
    if (o.customer_name) map[key].name = o.customer_name;
    if (o.phone) map[key].phone = o.phone;
    if (o.city) map[key].city = o.city;
    if (o.address) map[key].address = o.address;
    if (o.email) map[key].email = o.email;
  });
  return map;
}

function getMergedCustomers() {
  const autoMap = buildCustomerMap();
  MANUAL_CUSTOMERS.forEach(mc => {
    const key = (mc.phone || mc.name || '').trim().toLowerCase().replace(/\s+/g, '');
    if (autoMap[key]) {
      autoMap[key].id = mc.id;
      autoMap[key].name = mc.name || autoMap[key].name;
      autoMap[key].phone = mc.phone || autoMap[key].phone;
      autoMap[key].city = mc.city || autoMap[key].city;
      autoMap[key].address = mc.address || autoMap[key].address;
      autoMap[key].email = mc.email || autoMap[key].email;
      autoMap[key].notes = mc.notes || '';
      autoMap[key].source = 'merged';
    } else {
      autoMap[key] = { ...mc, orders: [], source: 'manual' };
    }
  });
  return Object.values(autoMap);
}

function getCustomerTags(cust, allCustomers) {
  const tags = [];
  const orders = cust.orders || [];
  const delivered = orders.filter(o => o.status === 'delivered');
  const totalSpent = delivered.reduce((s,o) => s+(parseFloat(o.total)||0), 0);
  const orderCount = orders.length;
  const hasReturn = orders.some(o => o.status === 'returned');
  if (orderCount === 1) tags.push({ key:'new', label:'🆕 New', cls:'tag-new' });
  if (orderCount >= 2) tags.push({ key:'repeat', label:'🔁 Repeat', cls:'tag-repeat' });
  if (orderCount >= 5) tags.push({ key:'loyal', label:'❤️ Loyal', cls:'tag-loyal' });
  if (hasReturn) tags.push({ key:'returned', label:'↩️ Returned', cls:'tag-returned' });
  if (totalSpent >= 500) tags.push({ key:'bigspender', label:'💎 Big Spender', cls:'tag-bigspender' });
  const sorted = [...allCustomers].sort((a,b) => {
    const sa = (a.orders||[]).filter(o=>o.status==='delivered').reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    const sb = (b.orders||[]).filter(o=>o.status==='delivered').reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    return sb-sa;
  });
  const top5 = sorted.slice(0,5).map(c=>c.id);
  if (top5.includes(cust.id) && totalSpent > 0) tags.push({ key:'top5', label:'🏆 Top 5', cls:'tag-top5' });
  if (top5.includes(cust.id) && orderCount >= 2) tags.push({ key:'vip', label:'⭐ VIP', cls:'tag-vip' });
  return tags;
}

function renderCustomers() {
  const allCusts = getMergedCustomers();
  const search = (document.getElementById('custSearch')?.value||'').toLowerCase();
  const tagFilter = document.getElementById('custTagFilter')?.value||'';
  let filtered = allCusts.filter(c => {
    const m = !search || (c.name||'').toLowerCase().includes(search) || (c.phone||'').toLowerCase().includes(search) || (c.city||'').toLowerCase().includes(search);
    if (!m) return false;
    if (tagFilter) return getCustomerTags(c, allCusts).some(t => t.key === tagFilter);
    return true;
  }).sort((a,b) => {
    const sa = (a.orders||[]).filter(o=>o.status==='delivered').reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    const sb = (b.orders||[]).filter(o=>o.status==='delivered').reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    return sb-sa;
  });
  const totalRevenue = allCusts.reduce((s,c)=>s+(c.orders||[]).filter(o=>o.status==='delivered').reduce((ss,o)=>ss+(parseFloat(o.total)||0),0),0);
  const repeatCusts = allCusts.filter(c=>(c.orders||[]).length>=2).length;
  const vipCount = allCusts.filter(c=>getCustomerTags(c,allCusts).some(t=>t.key==='vip')).length;
  const totalExpenses = (typeof getExpenses==='function' ? getExpenses() : []).filter(e=>e.type==='expense').reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const cac = allCusts.length > 0 ? (totalExpenses / allCusts.length) : 0;
  const statsEl = document.getElementById('custStats');
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card c1"><div class="stat-icon" style="color:var(--primary)">👥</div><div class="stat-label">Total Customers</div><div class="stat-val">${allCusts.length}</div><div class="stat-sub">Unique</div></div>
    <div class="stat-card c2"><div class="stat-icon" style="color:var(--success)">🔁</div><div class="stat-label">Repeat</div><div class="stat-val">${repeatCusts}</div><div class="stat-sub">2+ orders</div></div>
    <div class="stat-card c3"><div class="stat-icon" style="color:var(--warning)">⭐</div><div class="stat-label">VIP</div><div class="stat-val">${vipCount}</div><div class="stat-sub">Top spenders</div></div>
    <div class="stat-card c5"><div class="stat-icon" style="color:var(--info)">💰</div><div class="stat-label">Total Revenue</div><div class="stat-val">AED ${fmt(totalRevenue)}</div><div class="stat-sub">All customers</div></div>
    <div class="stat-card c4"><div class="stat-icon" style="color:var(--danger)">🎯</div><div class="stat-label">Avg CAC</div><div class="stat-val">AED ${fmt(cac)}</div><div class="stat-sub">Cost per customer</div></div>
  `;
  const tbody = document.getElementById('custBody');
  if (!tbody) return;
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty">No customers found</div></td></tr>'; return; }
  tbody.innerHTML = filtered.map((c,i) => {
    const del = (c.orders||[]).filter(o=>o.status==='delivered');
    const spent = del.reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    const profit = del.reduce((s,o)=>s+(parseFloat(o.profit_per)||0)*(parseFloat(o.qty)||1),0);
    const avgOrder = del.length ? spent / del.length : 0;
    const clvScore = spent + (del.length * avgOrder * 0.3); // simple CLV estimate
    const clvCls = clvScore >= 500 ? 'clv-high' : clvScore >= 150 ? 'clv-mid' : 'clv-low';
    const clvLabel = clvScore >= 500 ? '⭐ High' : clvScore >= 150 ? '📈 Mid' : '📉 Low';
    const tags = getCustomerTags(c, allCusts);
    const tagsHtml = tags.map(t=>`<span class="cust-tag ${t.cls}">${t.label}</span>`).join(' ');
    const last = (c.orders||[]).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
    return `<tr style="cursor:pointer;" onclick="showCustomerDetail('${c.id}')">
      <td style="color:var(--muted)">${i+1}</td>
      <td><strong style="color:var(--text)">${c.name||'—'}</strong>${last?`<div style="font-size:0.75rem;color:var(--muted)">Last: ${last.date}</div>`:''}</td>
      <td style="color:var(--muted)">${c.city||'—'}</td>
      <td style="color:var(--muted)">${c.phone||'—'}</td>
      <td style="text-align:center;"><strong>${(c.orders||[]).length}</strong></td>
      <td style="color:var(--success);font-weight:600;">AED ${fmt(spent)}</td>
      <td style="color:var(--primary);font-weight:600;">AED ${fmt(profit)}</td>
      <td><span class="clv-badge ${clvCls}" title="CLV: AED ${fmt(clvScore)}">${clvLabel}</span><div style="font-size:0.7rem;color:var(--muted);margin-top:0.2rem;">AED ${fmt(clvScore)}</div></td>
      <td><div style="display:flex;flex-wrap:wrap;gap:0.3rem;">${tagsHtml||'<span style="color:var(--muted);font-size:0.75rem;">—</span>'}</div></td>
      <td onclick="event.stopPropagation()"><div style="display:flex;gap:0.4rem;">
        ${c.phone ? `<a href="https://wa.me/${c.phone.replace(/[^0-9]/g,'')}" target="_blank" class="btn btn-outline btn-sm" title="WhatsApp" style="color:#25d366;border-color:#25d366;">💬</a>` : ''}
        <button class="btn btn-outline btn-sm" onclick="openCustomerModal('${c.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

function showCustomerDetail(id) {
  const allCusts = getMergedCustomers();
  const c = allCusts.find(x => x.id === id);
  if (!c) return;
  const del = (c.orders||[]).filter(o=>o.status==='delivered');
  const spent = del.reduce((s,o)=>s+(parseFloat(o.total)||0),0);
  const profit = del.reduce((s,o)=>s+(parseFloat(o.profit_per)||0)*(parseFloat(o.qty)||1),0);
  const tags = getCustomerTags(c, allCusts);
  const sorted = [...(c.orders||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('customerDetailContent').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1rem;">${tags.map(t=>`<span class="cust-tag ${t.cls}">${t.label}</span>`).join(' ')}</div>
    <div class="order-detail-grid" style="margin-bottom:1.2rem;">
      <div class="detail-row"><div class="detail-label">Name</div><div class="detail-val">${c.name||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-val">${c.phone||'—'} ${c.phone?`<a href="https://wa.me/${c.phone.replace(/[^0-9]/g,'')}" target="_blank" style="color:#25d366;font-size:0.8rem;margin-left:0.4rem;">💬 WhatsApp</a>`:''}</div></div>
      <div class="detail-row"><div class="detail-label">City</div><div class="detail-val">${c.city||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">Email</div><div class="detail-val">${c.email||'—'}</div></div>
      <div class="detail-row"><div class="detail-label">Total Orders</div><div class="detail-val" style="color:var(--primary)">${(c.orders||[]).length}</div></div>
      <div class="detail-row"><div class="detail-label">Total Spent</div><div class="detail-val" style="color:var(--success)">AED ${fmt(spent)}</div></div>
      <div class="detail-row"><div class="detail-label">Total Profit</div><div class="detail-val" style="color:var(--primary)">AED ${fmt(profit)}</div></div>
      <div class="detail-row"><div class="detail-label">Address</div><div class="detail-val">${c.address||'—'}</div></div>
      ${c.notes?`<div class="detail-row" style="grid-column:1/-1"><div class="detail-label">Notes</div><div class="detail-val">${c.notes}</div></div>`:''}
    </div>
    <div style="font-size:0.8rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:0.6rem;">Order History</div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;max-height:220px;overflow-y:auto;">
      ${sorted.length?sorted.map(o=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.8rem;background:var(--surface2);border-radius:var(--radius-sm);font-size:0.85rem;">
        <div><strong>${o.product}</strong> <span style="color:var(--muted)">×${o.qty}</span><div style="font-size:0.75rem;color:var(--muted)">${o.date} · ${o.custom_id||''}</div></div>
        <div style="text-align:right;"><div style="color:var(--success);font-weight:600;">AED ${fmt(o.total)}</div><div>${badge(o.status)}</div></div>
      </div>`).join(''):'<div class="empty">No orders yet</div>'}
    </div>
    <div class="form-actions"><button class="btn btn-outline" onclick="openCustomerModal('${c.id}');closeModal('customerDetailModal')">✏️ Edit Profile</button></div>
  `;
  document.getElementById('customerDetailModal').classList.add('open');
}

function openCustomerModal(id) {
  const allCusts = getMergedCustomers();
  document.getElementById('custModalTitle').textContent = id ? '✏️ Edit Customer' : '👤 Add Customer';
  if (id) {
    const c = allCusts.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cm_name').value = c.name||'';
    document.getElementById('cm_phone').value = c.phone||'';
    document.getElementById('cm_city').value = c.city||'';
    document.getElementById('cm_address').value = c.address||'';
    document.getElementById('cm_email').value = c.email||'';
    document.getElementById('cm_notes').value = c.notes||'';
    document.getElementById('customerModal').dataset.editId = id;
  } else {
    ['cm_name','cm_phone','cm_city','cm_address','cm_email','cm_notes'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('customerModal').dataset.editId = '';
  }
  document.getElementById('customerModal').classList.add('open');
}

function saveCustomer() {
  const name = document.getElementById('cm_name').value.trim();
  const phone = document.getElementById('cm_phone').value.trim();
  if (!name||!phone) return toast('Name and phone required','error');
  const editId = document.getElementById('customerModal').dataset.editId;
  const data = { name, phone, city:document.getElementById('cm_city').value.trim(), address:document.getElementById('cm_address').value.trim(), email:document.getElementById('cm_email').value.trim(), notes:document.getElementById('cm_notes').value.trim(), updated_at:Date.now() };
  const docId = editId && !editId.startsWith('auto_') ? editId : 'c_'+Date.now();
  data.created_at = editId?(MANUAL_CUSTOMERS.find(c=>c.id===editId)?.created_at||Date.now()):Date.now();
  db.collection("customers").doc(docId).set(data)
    .then(()=>{
      closeModal('customerModal');
      toast(editId?'Updated!':'Added!','success');
      if (!editId) logActivity('customer_added', `${name} · ${phone} · ${data.city||'—'}`);
    })
    .catch(err=>toast('Error: '+err.message,'error'));
}

function deleteCustomer(id) {
  if (id.startsWith('auto_')) return toast('Delete their orders instead','warning');
  if (!confirm('Delete this customer?')) return;
  db.collection("customers").doc(id).delete()
    .then(()=>toast('Removed','success'))
    .catch(e=>toast('Error: '+e.message,'error'));
}

// ══════════════════════════════════════════════════════════════
// ── TASKS MODULE ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let GLOBAL_TASKS = [];
let currentEditingTaskId = null;
let taskStepCounter = 0;
let selectedTaskPerson = 'Ahmad'; // Default selected person

// Real-time Firestore sync for tasks
function startTasksSync() {
  db.collection("tasks").onSnapshot(snap => {
    GLOBAL_TASKS = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (document.getElementById('page-tasks')?.classList.contains('active')) {
      renderTasks();
    }
  });
}

function getTasks() {
  return GLOBAL_TASKS;
}

function selectTaskPerson(person) {
  selectedTaskPerson = person;
  
  // Update button styles
  document.getElementById('selectorAhmad').style.borderColor = person === 'Ahmad' ? 'var(--primary)' : 'var(--border)';
  document.getElementById('selectorAhmad').style.color = person === 'Ahmad' ? 'var(--primary)' : 'var(--text)';
  document.getElementById('selectorAhmad').style.borderWidth = person === 'Ahmad' ? '2px' : '1px';
  
  document.getElementById('selectorAli').style.borderColor = person === 'Ali' ? '#10b981' : 'var(--border)';
  document.getElementById('selectorAli').style.color = person === 'Ali' ? '#10b981' : 'var(--text)';
  document.getElementById('selectorAli').style.borderWidth = person === 'Ali' ? '2px' : '1px';
  
  // Re-render tasks for selected person
  renderTasks();
}

function openTaskModal(id) {
  currentEditingTaskId = id || null;
  taskStepCounter = 0;
  
  if (id) {
    const task = getTasks().find(t => t.id === id);
    if (!task) return;
    document.querySelector('#taskModal h3').textContent = '✏️ Edit Task';
    document.getElementById('t_person').value = task.person || '';
    document.getElementById('t_title').value = task.title || '';
    document.getElementById('t_desc').value = task.description || '';
    document.getElementById('t_status').value = task.status || 'pending';
    document.getElementById('t_duedate').value = task.due_date || '';
    
    // Render existing steps
    renderTaskSteps(task.steps || []);
  } else {
    document.querySelector('#taskModal h3').textContent = '📋 Add New Task';
    document.getElementById('t_person').value = '';
    document.getElementById('t_title').value = '';
    document.getElementById('t_desc').value = '';
    document.getElementById('t_status').value = 'pending';
    document.getElementById('t_duedate').value = '';
    renderTaskSteps([]);
    addTaskStep();
  }
  
  document.getElementById('taskModal').classList.add('open');
}

function renderTaskSteps(steps) {
  const container = document.getElementById('t_steps_container');
  container.innerHTML = '';
  taskStepCounter = steps.length;
  
  steps.forEach((step, idx) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'task-step-input';
    stepEl.style.cssText = 'display:flex; gap:0.6rem; align-items:center;';
    stepEl.innerHTML = `
      <span style="color:var(--muted); font-weight:600; font-size:0.85rem; min-width:20px;">${idx + 1}.</span>
      <input class="inp" placeholder="Step..." value="${step.text || ''}" style="flex:1; margin-bottom:0;" data-step-idx="${idx}">
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();" style="padding:0.35rem 0.6rem;">✕</button>
    `;
    container.appendChild(stepEl);
  });
}

function addTaskStep() {
  taskStepCounter++;
  const container = document.getElementById('t_steps_container');
  const stepEl = document.createElement('div');
  stepEl.className = 'task-step-input';
  stepEl.style.cssText = 'display:flex; gap:0.6rem; align-items:center;';
  stepEl.innerHTML = `
    <span style="color:var(--muted); font-weight:600; font-size:0.85rem; min-width:20px;">${taskStepCounter}.</span>
    <input class="inp" placeholder="Step..." style="flex:1; margin-bottom:0;">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();" style="padding:0.35rem 0.6rem;">✕</button>
  `;
  container.appendChild(stepEl);
}

function saveTask() {
  const person = document.getElementById('t_person').value.trim();
  const title = document.getElementById('t_title').value.trim();
  const desc = document.getElementById('t_desc').value.trim();
  const status = document.getElementById('t_status').value;
  const dueDate = document.getElementById('t_duedate').value;
  
  if (!person || !title) {
    return toast('Person and Title are required', 'error');
  }
  
  // Collect steps
  const stepInputs = document.querySelectorAll('.task-step-input input[class="inp"]');
  const steps = [];
  stepInputs.forEach((input, idx) => {
    const text = input.value.trim();
    if (text) {
      steps.push({ number: idx + 1, text, completed: false });
    }
  });
  
  if (steps.length === 0) {
    return toast('Add at least one task step', 'error');
  }
  
  const taskData = {
    person,
    title,
    description: desc,
    steps,
    status,
    due_date: dueDate,
    created_at: currentEditingTaskId ? (GLOBAL_TASKS.find(t => t.id === currentEditingTaskId)?.created_at) : Date.now(),
    updated_at: Date.now()
  };
  
  const docId = currentEditingTaskId || 't_' + Date.now();
  
  db.collection("tasks").doc(docId).set(taskData)
    .then(() => {
      closeModal('taskModal');
      toast(currentEditingTaskId ? 'Task updated!' : 'Task added!', 'success');
    })
    .catch(err => {
      toast('Error: ' + err.message, 'error');
    });
}

function renderTasks() {
  const tasks = getTasks();
  
  // Only show tasks for selected person
  let filtered = tasks.filter(t => t.person === selectedTaskPerson);
  
  // Sort by updated_at (newest first)
  filtered.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  
  const gridEl = document.getElementById('taskGrid');
  const emptyEl = document.getElementById('taskEmptyState');
  
  if (!filtered.length) {
    if (gridEl) gridEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    renderTaskStats([]);
    return;
  }
  
  if (emptyEl) emptyEl.style.display = 'none';
  
  if (gridEl) {
    gridEl.innerHTML = filtered.map(task => {
      const completedSteps = (task.steps || []).filter(s => s.completed).length;
      const totalSteps = (task.steps || []).length;
      const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
      const personColor = task.person === 'Ahmad' ? 'ahmad' : 'ali';
      
      return `
        <div class="task-card" onclick="showTaskDetail('${task.id}')">
          <div class="task-card-header">
            <div class="task-person-badge ${personColor}">${task.person}</div>
            <span class="task-status-badge ${task.status}">${task.status.replace('-', ' ')}</span>
          </div>
          
          <div class="task-title">${task.title}</div>
          ${task.description ? `<div class="task-desc">${task.description}</div>` : ''}
          
          <div class="task-progress">
            <div class="task-progress-bar">
              <div class="task-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="task-progress-text">${completedSteps}/${totalSteps}</div>
          </div>
          
          <div class="task-steps-preview">
            ${(task.steps || []).slice(0, 5).map(step => 
              `<div class="task-step-dot ${step.completed ? 'done' : 'pending'}"></div>`
            ).join('')}
            ${totalSteps > 5 ? `<span style="font-size:0.7rem; color:var(--muted);">+${totalSteps - 5}</span>` : ''}
          </div>
          
          <div class="task-footer">
            <div class="task-date">📅 ${task.due_date || 'No date'}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  renderTaskStats(filtered);
}

function renderTaskStats(tasks) {
  const statsEl = document.getElementById('taskStatsGrid');
  if (!statsEl) return;
  
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
  
  const completedStepsTotal = tasks.reduce((sum, t) => sum + (t.steps || []).filter(s => s.completed).length, 0);
  const totalStepsCount = tasks.reduce((sum, t) => sum + (t.steps || []).length, 0);
  const progressPercent = totalStepsCount > 0 ? Math.round((completedStepsTotal / totalStepsCount) * 100) : 0;
  
  statsEl.innerHTML = `
    <div class="task-stat-card">
      <h4>${selectedTaskPerson} Tasks</h4>
      <div class="task-stat-val">${totalTasks}</div>
    </div>
    <div class="task-stat-card">
      <h4>Completed ✅</h4>
      <div class="task-stat-val" style="color:var(--success)">${completedTasks}</div>
    </div>
    <div class="task-stat-card">
      <h4>Pending ⏳</h4>
      <div class="task-stat-val" style="color:var(--warning)">${pendingTasks}</div>
    </div>
    <div class="task-stat-card">
      <h4>In Progress 🔄</h4>
      <div class="task-stat-val" style="color:var(--info)">${inProgressTasks}</div>
    </div>
    <div class="task-stat-card">
      <h4>Overall Progress</h4>
      <div class="task-stat-val" style="color:var(--primary)">${progressPercent}%</div>
      <div class="task-stat-sub">${completedStepsTotal}/${totalStepsCount} steps</div>
    </div>
  `;
}

function showTaskDetail(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  
  const completedSteps = (task.steps || []).filter(s => s.completed).length;
  const totalSteps = (task.steps || []).length;
  const isCompleted = task.status === 'completed';
  
  const stepsHtml = (task.steps || []).map((step, idx) => `
    <div class="task-step-item">
      <div class="task-step-checkbox ${step.completed ? 'checked' : ''}" 
           onclick="toggleTaskStep('${taskId}', ${idx}); event.stopPropagation();" 
           title="Mark as ${step.completed ? 'incomplete' : 'complete'}"></div>
      <div class="task-step-text">
        <div class="task-step-number">Step ${step.number}</div>
        <div class="task-step-title" style="${step.completed ? 'text-decoration: line-through; color: var(--muted);' : ''}">${step.text}</div>
      </div>
    </div>
  `).join('');
  
  document.getElementById('taskDetailContent').innerHTML = `
    <div class="task-detail-grid">
      <div class="task-detail-section">
        <h4>Assigned To</h4>
        <p style="color: ${task.person === 'Ahmad' ? '#6366f1' : '#10b981'}; font-weight: 700; font-size: 1.1rem;">${task.person}</p>
      </div>
      
      <div class="task-detail-section">
        <h4>Status</h4>
        <p>${task.status.replace('-', ' ').toUpperCase()}</p>
      </div>
      
      <div class="task-detail-section">
        <h4>Due Date</h4>
        <p>${task.due_date || 'No date set'}</p>
      </div>
      
      <div class="task-detail-section">
        <h4>Progress</h4>
        <p>${completedSteps} of ${totalSteps} steps completed</p>
        <div class="task-progress" style="margin-top: 0.6rem;">
          <div class="task-progress-bar" style="flex: 1;">
            <div class="task-progress-fill" style="width: ${(completedSteps/totalSteps)*100}%"></div>
          </div>
          <div class="task-progress-text">${Math.round((completedSteps/totalSteps)*100)}%</div>
        </div>
      </div>
    </div>
    
    ${task.description ? `
      <div class="task-detail-section">
        <h4>Description</h4>
        <p>${task.description}</p>
      </div>
    ` : ''}
    
    <div class="task-detail-section">
      <h4>Task Steps</h4>
      <div class="task-steps-list">${stepsHtml}</div>
    </div>
    
    <div class="task-actions-bottom">
      <div class="task-action-group">
        <button class="btn btn-outline btn-sm" onclick="openTaskModal('${taskId}'); closeModal('taskDetailModal')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${taskId}'); closeModal('taskDetailModal')">🗑 Delete</button>
      </div>
      <button class="task-complete-btn" onclick="completeTask('${taskId}'); closeModal('taskDetailModal')" ${isCompleted ? 'disabled' : ''}>
        ${isCompleted ? '✓ Completed' : '✓ Mark Complete'}
      </button>
    </div>
  `;
  
  document.getElementById('taskDetailModal').classList.add('open');
}

function toggleTaskStep(taskId, stepIdx) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  
  const steps = task.steps || [];
  if (steps[stepIdx]) {
    steps[stepIdx].completed = !steps[stepIdx].completed;
  }
  
  db.collection("tasks").doc(taskId).update({ steps, updated_at: Date.now() })
    .catch(err => toast('Error: ' + err.message, 'error'));
}

function completeTask(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  
  // Mark all steps as completed
  const steps = (task.steps || []).map(step => ({ ...step, completed: true }));
  
  db.collection("tasks").doc(taskId).update({ 
    status: 'completed',
    steps,
    updated_at: Date.now(),
    completed_at: Date.now()
  })
    .then(() => toast('Task marked as complete! 🎉', 'success'))
    .catch(err => toast('Error: ' + err.message, 'error'));
}

function deleteTask(taskId) {
  if (!confirm('Delete this task permanently?')) return;
  
  db.collection("tasks").doc(taskId).delete()
    .then(() => {
      GLOBAL_TASKS = GLOBAL_TASKS.filter(t => t.id !== taskId);
      renderTasks();
      toast('Task deleted', 'success');
    })
    .catch(err => toast('Error: ' + err.message, 'error'));
}
