/**
 * working.js — Aezoon Dashboard Fixes
 * AI Goals system is now in index.html directly (no dependency issues)
 */

const KEYS = {
  orders: 'aezoon_orders',
  expenses: 'aezoon_expenses',
  goals: 'aezoon_goals'
};

// ── OTHER FIXES ───────────────────────────────────────────────

function renderSettings() {
  const storageEl = document.getElementById('storageInfo');
  if (storageEl) storageEl.innerHTML = `<strong>Count:</strong> ${getOrders().length} Orders | ${getExpenses().length} Entries | ${(window._AI_GOALS||[]).length} Goals`;
  applyAiConfigToUI();
}

function deleteExpense(id) {
  if (!confirm('Delete this entry?')) return;
  db.collection("expenses").doc(id).delete()
    .then(() => toast('Deleted', 'success'))
    .catch(e => toast('Error: ' + e.message, 'error'));
}

function confirmClearLocalData() {
  if (!confirm('Clear all LOCAL data?')) return;
  localStorage.setItem(KEYS.orders, '[]');
  localStorage.setItem(KEYS.expenses, '[]');
  toast('Local data cleared.', 'success');
  renderDashboard(); renderOrders(); renderExpenses(); renderPending(); renderSettings();
}

function exportBackup() {
  const b = new Blob([JSON.stringify({ v:'2.1_Cloud', date:new Date().toISOString(), orders:getOrders(), expenses:getExpenses(), goals:window._AI_GOALS||[] }, null, 2)], { type:'application/json' });
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
  if (!confirm('ARE YOU ABSOLUTELY SURE? This will wipe LOCAL and CLOUD data!')) return;
  localStorage.setItem(KEYS.orders, JSON.stringify([]));
  localStorage.setItem(KEYS.expenses, JSON.stringify([]));
  db.collection("orders").get().then(res => res.forEach(d => d.ref.delete()));
  db.collection("expenses").get().then(res => res.forEach(d => d.ref.delete()));
  db.collection("ai_goals").get().then(res => res.forEach(d => d.ref.delete()));
  toast('All Data Cleared.', 'success');
  renderDashboard(); renderOrders(); renderExpenses(); renderPending(); renderSettings();
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
    </div>
    <div style="display:flex;gap:0.8rem;align-items:center;margin-top:0.5rem;">
      <select class="inp" id="detail_status_${o.id}" style="flex:1;">
        ${['unfulfilled','processing','shipped','delivered','returned','cancel','fake'].map(s=>
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
  const statsEl = document.getElementById('custStats');
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card c1"><div class="stat-icon" style="color:var(--primary)">👥</div><div class="stat-label">Total Customers</div><div class="stat-val">${allCusts.length}</div><div class="stat-sub">Unique</div></div>
    <div class="stat-card c2"><div class="stat-icon" style="color:var(--success)">🔁</div><div class="stat-label">Repeat</div><div class="stat-val">${repeatCusts}</div><div class="stat-sub">2+ orders</div></div>
    <div class="stat-card c3"><div class="stat-icon" style="color:var(--warning)">⭐</div><div class="stat-label">VIP</div><div class="stat-val">${vipCount}</div><div class="stat-sub">Top spenders</div></div>
    <div class="stat-card c5"><div class="stat-icon" style="color:var(--info)">💰</div><div class="stat-label">Total Revenue</div><div class="stat-val">AED ${fmt(totalRevenue)}</div><div class="stat-sub">All customers</div></div>
  `;
  const tbody = document.getElementById('custBody');
  if (!tbody) return;
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty">No customers found</div></td></tr>'; return; }
  tbody.innerHTML = filtered.map((c,i) => {
    const del = (c.orders||[]).filter(o=>o.status==='delivered');
    const spent = del.reduce((s,o)=>s+(parseFloat(o.total)||0),0);
    const profit = del.reduce((s,o)=>s+(parseFloat(o.profit_per)||0)*(parseFloat(o.qty)||1),0);
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
      <td><div style="display:flex;flex-wrap:wrap;gap:0.3rem;">${tagsHtml||'<span style="color:var(--muted);font-size:0.75rem;">—</span>'}</div></td>
      <td onclick="event.stopPropagation()"><div style="display:flex;gap:0.4rem;">
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
      <div class="detail-row"><div class="detail-label">Phone</div><div class="detail-val">${c.phone||'—'}</div></div>
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
    .then(()=>{ closeModal('customerModal'); toast(editId?'Updated!':'Added!','success'); })
    .catch(err=>toast('Error: '+err.message,'error'));
}

function deleteCustomer(id) {
  if (id.startsWith('auto_')) return toast('Delete their orders instead','warning');
  if (!confirm('Delete this customer?')) return;
  db.collection("customers").doc(id).delete()
    .then(()=>toast('Removed','success'))
    .catch(e=>toast('Error: '+e.message,'error'));
}
