/**
 * ARTX Payment Page — payment.js
 * Deposit (PawaPay / Stripe / Paystack) + Withdrawal + Transactions + Chart
 */

'use strict';

// ── API base (avoids conflict with app.js which also declares API_BASE_URL) ──
const PAY_API = (typeof API_BASE_URL !== 'undefined')
    ? API_BASE_URL
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000/api'
        : `${window.location.origin}/api`;

// ── State ──
let _wallet       = null;
let _stripe       = null;
let _stripeCard   = null;
let _pollTimer    = null;
let _pendingPayId = null;
let _allTxs       = [];
let _txShown      = 15;
let _txFilter     = '';
let _txSearch     = '';

// ════════════════════════════════════════
// BOOT
// ════════════════════════════════════════
function initPaymentPage() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = 'auth.html'; return; }

    loadPaymentData();
    loadTxs();

    // Pill filter clicks
    document.getElementById('pTxPills')?.addEventListener('click', e => {
        const pill = e.target.closest('.p-pill');
        if (!pill) return;
        document.querySelectorAll('.p-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _txFilter = pill.dataset.filter;
        _txShown  = 15;
        renderTx();
    });

    // Backdrop close
    document.getElementById('depositModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('depositModal')) closeDeposit();
    });
    document.getElementById('withdrawModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('withdrawModal')) closeWithdraw();
    });

    // Esc key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeDeposit(); closeWithdraw(); }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPaymentPage);
} else {
    initPaymentPage();
}

// ════════════════════════════════════════
// API HELPERS
// ════════════════════════════════════════
function authHdr() {
    return {
        'Authorization': `Token ${localStorage.getItem('djangoAuthToken')}`,
        'Content-Type': 'application/json'
    };
}

async function api(path, opts = {}) {
    const res = await fetch(`${PAY_API}${path}`, {
        ...opts,
        headers: { ...authHdr(), ...(opts.headers || {}) }
    });
    if (res.status === 401) {
        localStorage.removeItem('djangoAuthToken');
        window.location.href = 'auth.html';
        throw new Error('Session expired');
    }
    return res;
}

// ════════════════════════════════════════
// LOAD WALLET BALANCE
// ════════════════════════════════════════
window.loadPaymentData = async function () {
    try {
        const res  = await api('/payments/wallet/');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        _wallet = data.wallet;
        renderBalance();
        buildChart();
    } catch (err) {
        pToast('Could not load wallet data.', 'error');
    }
};

function fmt(v) { return `K${parseFloat(v || 0).toFixed(2)}`; }

function renderBalance() {
    animateNum('pBalance', _wallet.available_balance);
    setTxt('pCurrency',  _wallet.currency || 'ZMW');
    setTxt('pDeposited', fmt(_wallet.total_deposited));
    setTxt('pEarned',    fmt(_wallet.total_earned));
    setTxt('pWithdrawn', fmt(_wallet.total_withdrawn));
    setTxt('pSpent',     fmt(_wallet.total_spent || 0));
    setTxt('wAvailLabel',   `Available: ${fmt(_wallet.available_balance)}`);
    setTxt('wAvailHint',    `Available: ${fmt(_wallet.available_balance)}`);
    const st = document.getElementById('pStatus');
    if (st) st.textContent = _wallet.is_locked ? '⚠ Locked' : 'Active';
    if (_wallet.is_locked) pToast(`Wallet locked: ${_wallet.lock_reason}`, 'warning');
}

function animateNum(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const end = parseFloat(target || 0), dur = 900, t0 = performance.now();
    const step = now => {
        const p = Math.min((now - t0) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = `K${(end * e).toFixed(2)}`;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function setTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ════════════════════════════════════════
// MINI CHART
// ════════════════════════════════════════
function buildChart() {
    const wrap = document.getElementById('pChart');
    if (!wrap) return;
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today = new Date(); today.setHours(0,0,0,0);
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - (6 - i));
        return { label: i === 6 ? 'Today' : DAYS[d.getDay()], date: d, in: 0, out: 0 };
    });
    _allTxs.forEach(tx => {
        const d = new Date(tx.created_at); d.setHours(0,0,0,0);
        const idx = days.findIndex(dd => dd.date.getTime() === d.getTime());
        if (idx < 0) return;
        const amt = Math.abs(parseFloat(tx.amount || 0));
        if (['deposit','earning','bonus','refund'].includes(tx.transaction_type)) days[idx].in += amt;
        else days[idx].out += amt;
    });
    const mx = Math.max(...days.map(d => Math.max(d.in, d.out)), 1);
    wrap.innerHTML = days.map(d => {
        const ih = Math.round((d.in  / mx) * 80);
        const oh = Math.round((d.out / mx) * 80);
        return `
        <div class="p-bar-group">
            <div class="p-bar in"  style="height:0" data-h="${ih}"></div>
            <div class="p-bar out" style="height:0" data-h="${oh}">
                <span class="p-bar-lbl">${d.label}</span>
            </div>
        </div>`;
    }).join('');
    requestAnimationFrame(() => setTimeout(() => {
        wrap.querySelectorAll('.p-bar').forEach(b => b.style.height = b.dataset.h + 'px');
    }, 80));
}

// ════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════
async function loadTxs() {
    const list = document.getElementById('pTxList');
    if (list) list.innerHTML = '<div class="p-tx-skeleton-wrap"><div class="p-tx-skeleton"><div class="p-sk"></div><div class="p-sk s"></div><div class="p-sk"></div><div class="p-sk s"></div></div></div>';
    try {
        const res  = await api('/payments/wallet/transactions/');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        _allTxs  = data.transactions || [];
        _txShown = 15;
        renderTx();
        buildChart();
    } catch {
        if (list) list.innerHTML = '<div class="p-tx-error"><i class="fas fa-triangle-exclamation"></i><span>Could not load transactions.</span></div>';
    }
}

window.searchTx = function () {
    _txSearch = (document.getElementById('pTxSearch')?.value || '').toLowerCase().trim();
    _txShown = 15;
    renderTx();
};

window.loadMoreTx = function () {
    _txShown += 15;
    renderTx();
};

function renderTx() {
    let items = _allTxs;
    if (_txFilter) items = items.filter(t => t.transaction_type === _txFilter);
    if (_txSearch) items = items.filter(t => (t.description || '').toLowerCase().includes(_txSearch));
    const list = document.getElementById('pTxList');
    if (!list) return;
    if (!items.length) {
        list.innerHTML = '<div class="p-tx-empty"><i class="fas fa-receipt"></i><span>No transactions found.</span></div>';
        document.getElementById('pLoadMore').style.display = 'none';
        return;
    }
    const ICONS = {
        deposit:    { ico:'fas fa-arrow-down',       bg:'linear-gradient(135deg,#16a34a,#4ade80)' },
        withdrawal: { ico:'fas fa-arrow-up',          bg:'linear-gradient(135deg,#dc2626,#f87171)' },
        earning:    { ico:'fas fa-trophy',            bg:'linear-gradient(135deg,#d97706,#fbbf24)' },
        payment:    { ico:'fas fa-shopping-cart',     bg:'linear-gradient(135deg,#7c3aed,#a78bfa)' },
        refund:     { ico:'fas fa-rotate-left',       bg:'linear-gradient(135deg,#0891b2,#22d3ee)' },
        bonus:      { ico:'fas fa-gift',              bg:'linear-gradient(135deg,#db2777,#f472b6)' },
        fee:        { ico:'fas fa-receipt',           bg:'linear-gradient(135deg,#374151,#6b7280)' },
        transfer:   { ico:'fas fa-arrows-left-right', bg:'linear-gradient(135deg,#0891b2,#38bdf8)' },
    };
    list.innerHTML = items.slice(0, _txShown).map((tx, i) => {
        const pos  = parseFloat(tx.amount) >= 0;
        const meta = ICONS[tx.transaction_type] || { ico:'fas fa-circle', bg:'linear-gradient(135deg,#6b7280,#9ca3af)' };
        const date = new Date(tx.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
        const status = tx.status || 'completed';
        return `
        <div class="p-tx-item" style="animation-delay:${i * .03}s">
            <div class="p-tx-icon" style="background:${meta.bg}"><i class="${meta.ico}" style="color:#fff"></i></div>
            <div class="p-tx-body">
                <div class="p-tx-desc">${tx.description || tx.transaction_type}</div>
                <div class="p-tx-meta">
                    <span>${date}</span>
                    <span class="p-tx-badge ${status}">${status}</span>
                </div>
            </div>
            <div class="p-tx-amt ${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}K${Math.abs(parseFloat(tx.amount)).toFixed(2)}</div>
        </div>`;
    }).join('');
    const btn = document.getElementById('pLoadMore');
    if (btn) btn.style.display = items.length > _txShown ? 'flex' : 'none';
}

// ════════════════════════════════════════
// DEPOSIT MODAL — open / close / steps
// ════════════════════════════════════════
window.openDeposit = function () {
    document.getElementById('depositModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setDStep(1);
};

window.closeDeposit = function () {
    document.getElementById('depositModal').classList.remove('open');
    document.body.style.overflow = '';
    document.getElementById('depositForm')?.reset();
    setTxt('dAmtDisplay', 'K0');
    hideDFields();
    resetBtn('dSubmitBtn', 'dSubmitTxt', 'Deposit Now');
    if (_stripeCard) { _stripeCard.unmount(); _stripeCard = null; }
};

function setDStep(n) {
    [1,2,3].forEach(i => {
        document.getElementById(`dp${i}`)?.classList.toggle('active', i === n);
        const s = document.getElementById(`ds${i}`);
        if (s) {
            s.classList.toggle('active', i === n);
            s.classList.toggle('done',   i < n);
        }
    });
}

window.dNext = function (cur) {
    if (cur === 1) {
        const amt = parseFloat(document.getElementById('dAmt')?.value || 0);
        if (!amt || amt < 1) { pToast('Enter a valid amount (min K1)', 'warning'); return; }
        setDStep(2);
    } else if (cur === 2) {
        const prov = document.querySelector('input[name="dProvider"]:checked')?.value;
        if (!prov) { pToast('Select a payment method', 'warning'); return; }
        const labels = { pawapay:'Mobile Money', stripe:'Card (Stripe)', paystack:'Paystack' };
        setTxt('dRevAmt',    `K${parseFloat(document.getElementById('dAmt').value).toFixed(2)}`);
        setTxt('dRevMethod', labels[prov] || prov);
        setTxt('dRevCur',    _wallet?.currency || 'ZMW');
        const ph = document.getElementById('dPhone')?.value.trim();
        const pr = document.getElementById('dRevPhoneRow');
        if (ph && pr) { pr.style.display = 'flex'; setTxt('dRevPhone', ph); }
        else if (pr) pr.style.display = 'none';
        setDStep(3);
    }
};

window.dBack = function (cur) { setDStep(cur - 1); };

// ════════════════════════════════════════
// DEPOSIT — method field toggling
// ════════════════════════════════════════
function hideDFields() {
    ['dPawapayFields','dStripeFields','dPaystackFields'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
}

window.dMethodChange = function () {
    hideDFields();
    const prov = document.querySelector('input[name="dProvider"]:checked')?.value;
    if (prov === 'pawapay')  document.getElementById('dPawapayFields').style.display  = 'block';
    if (prov === 'stripe')   { document.getElementById('dStripeFields').style.display = 'block'; mountStripe(); }
    if (prov === 'paystack') document.getElementById('dPaystackFields').style.display  = 'block';
};

// ════════════════════════════════════════
// STRIPE CARD MOUNT
// ════════════════════════════════════════
async function mountStripe() {
    if (!_stripe) {
        const pk = document.querySelector('meta[name="stripe-pk"]')?.content;
        if (!pk) {
            document.getElementById('dStripeEl').innerHTML =
                '<p style="font-size:12px;color:#9ca3af;padding:8px 0">Card details collected after clicking Deposit.</p>';
            return;
        }
        _stripe = Stripe(pk);
    }
    if (_stripeCard) _stripeCard.unmount();
    const elements = _stripe.elements();
    _stripeCard = elements.create('card', {
        style: { base: { fontSize:'15px', color:'#fff', '::placeholder':{ color:'#aab7c4' } }, invalid:{ color:'#ff6b6b' } }
    });
    _stripeCard.mount('#dStripeEl');
    _stripeCard.on('change', e => {
        const err = document.getElementById('dStripeErr');
        if (err) err.textContent = e.error ? e.error.message : '';
    });
}

// ════════════════════════════════════════
// AMOUNT SYNC HELPERS
// ════════════════════════════════════════
window.syncAmt = function (displayId, inputId) {
    const v = parseFloat(document.getElementById(inputId)?.value || 0);
    const el = document.getElementById(displayId);
    if (el) el.textContent = isNaN(v) ? 'K0' : `K${v % 1 === 0 ? v : v.toFixed(2)}`;
};

window.dPreset = function (v) {
    const el = document.getElementById('dAmt');
    if (el) { el.value = v; syncAmt('dAmtDisplay','dAmt'); }
};

window.wPreset = function (v) {
    const el = document.getElementById('wAmt');
    if (el) { el.value = v; syncAmt('wAmtDisplay','wAmt'); }
};

// ════════════════════════════════════════
// DEPOSIT — submit
// ════════════════════════════════════════
window.submitDeposit = async function (e) {
    e.preventDefault();
    const amtRaw = document.getElementById('dAmt')?.value.trim();
    const prov   = document.querySelector('input[name="dProvider"]:checked')?.value;
    const amt    = parseFloat(amtRaw);
    if (!amtRaw || isNaN(amt) || amt < 1) { pToast('Invalid amount', 'error'); return; }
    if (!prov) { pToast('No payment method selected', 'error'); return; }
    const currency = _wallet?.currency || 'ZMW';

    // ── PawaPay ──
    if (prov === 'pawapay') {
        const phone = document.getElementById('dPhone')?.value.trim().replace(/[\s\-()]/g,'');
        const corr  = document.getElementById('dNetwork')?.value;
        if (!phone) { pToast('Enter phone number', 'warning'); return; }
        if (!corr)  { pToast('Select mobile network', 'warning'); return; }
        if (!/^\+?[1-9]\d{6,14}$/.test(phone)) { pToast('Invalid phone number format', 'error'); return; }
        setLoadBtn('dSubmitBtn','dSubmitTxt','Sending to phone…');
        try {
            const res  = await api('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amtRaw, currency, provider:'pawapay', phone_number:phone, correspondent:corr }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Deposit failed');
            closeDeposit();
            pToast(`📱 Prompt sent to ${phone}. Enter your PIN.`, 'info');
            startPoll(data.payment_id);
        } catch (err) { pToast(err.message, 'error'); }
        finally { resetBtn('dSubmitBtn','dSubmitTxt','Deposit Now'); }
        return;
    }

    // ── Stripe ──
    if (prov === 'stripe') {
        setLoadBtn('dSubmitBtn','dSubmitTxt','Processing…');
        try {
            const res  = await api('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amtRaw, currency, provider:'stripe' }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not initiate Stripe');
            if (!_stripe && data.publishable_key) {
                _stripe = Stripe(data.publishable_key);
                const el = _stripe.elements().create('card', { style:{ base:{ fontSize:'15px', color:'#fff' } } });
                el.mount('#dStripeEl'); _stripeCard = el;
            }
            if (!_stripeCard) throw new Error('Card form not ready. Select Stripe again.');
            const { error, paymentIntent } = await _stripe.confirmCardPayment(data.client_secret, { payment_method:{ card:_stripeCard } });
            if (error) throw new Error(error.message);
            if (paymentIntent.status === 'succeeded') {
                closeDeposit();
                pToast('✅ Card payment successful! Wallet updating…', 'success');
                startPoll(data.payment_id);
            }
        } catch (err) {
            const errEl = document.getElementById('dStripeErr'); if (errEl) errEl.textContent = err.message;
            pToast(err.message, 'error');
        }
        finally { resetBtn('dSubmitBtn','dSubmitTxt','Deposit Now'); }
        return;
    }

    // ── Paystack ──
    if (prov === 'paystack') {
        setLoadBtn('dSubmitBtn','dSubmitTxt','Redirecting…');
        try {
            const res  = await api('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amtRaw, currency, provider:'paystack' }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Paystack initiation failed');
            window.location.href = data.authorization_url;
        } catch (err) { pToast(err.message, 'error'); resetBtn('dSubmitBtn','dSubmitTxt','Deposit Now'); }
    }
};

// ════════════════════════════════════════
// WITHDRAW MODAL — open / close / steps
// ════════════════════════════════════════
window.openWithdraw = function () {
    if (!_wallet || parseFloat(_wallet.available_balance) <= 0) {
        pToast('No available balance to withdraw.', 'warning'); return;
    }
    document.getElementById('withdrawModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setWStep(1);
};

window.closeWithdraw = function () {
    document.getElementById('withdrawModal').classList.remove('open');
    document.body.style.overflow = '';
    document.getElementById('withdrawForm')?.reset();
    setTxt('wAmtDisplay','K0');
    hideWFields();
    resetBtn('wSubmitBtn','wSubmitTxt','Withdraw Now');
};

function setWStep(n) {
    [1,2,3].forEach(i => {
        document.getElementById(`wp${i}`)?.classList.toggle('active', i === n);
        const s = document.getElementById(`ws${i}`);
        if (s) {
            s.classList.toggle('active', i === n);
            s.classList.toggle('done',   i < n);
        }
    });
}

window.wNext = function (cur) {
    if (cur === 1) {
        const amt   = parseFloat(document.getElementById('wAmt')?.value || 0);
        const avail = parseFloat(_wallet?.available_balance || 0);
        if (!amt || amt < 1)  { pToast('Enter a valid amount (min K1)', 'warning'); return; }
        if (amt > avail)      { pToast(`Exceeds available balance (${fmt(avail)})`, 'error'); return; }
        setWStep(2);
    } else if (cur === 2) {
        const prov = document.querySelector('input[name="wProvider"]:checked')?.value;
        if (!prov) { pToast('Select a withdrawal method', 'warning'); return; }
        const labels = { mtn:'MTN Mobile Money', airtel:'Airtel Money', mpesa:'M-Pesa', bank:'Bank Transfer', paypal:'PayPal' };
        setTxt('wRevAmt',    `K${parseFloat(document.getElementById('wAmt').value).toFixed(2)}`);
        setTxt('wRevMethod', labels[prov] || prov);
        setTxt('wRevCur',    _wallet?.currency || 'ZMW');
        const ph = document.getElementById('wPhone')?.value.trim();
        const pr = document.getElementById('wRevPhoneRow');
        if (ph && pr) { pr.style.display = 'flex'; setTxt('wRevPhone', ph); }
        else if (pr) pr.style.display = 'none';
        setWStep(3);
    }
};

window.wBack = function (cur) { setWStep(cur - 1); };

function hideWFields() {
    ['wMobileFields','wBankFields','wPaypalFields'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
}

window.wMethodChange = function () {
    hideWFields();
    const prov = document.querySelector('input[name="wProvider"]:checked')?.value;
    if (['mtn','airtel','mpesa'].includes(prov)) document.getElementById('wMobileFields').style.display = 'block';
    if (prov === 'bank')   document.getElementById('wBankFields').style.display   = 'block';
    if (prov === 'paypal') document.getElementById('wPaypalFields').style.display = 'block';
};

// ════════════════════════════════════════
// WITHDRAW — submit
// ════════════════════════════════════════
window.submitWithdraw = async function (e) {
    e.preventDefault();
    const amtRaw = document.getElementById('wAmt')?.value.trim();
    const prov   = document.querySelector('input[name="wProvider"]:checked')?.value;
    const amt    = parseFloat(amtRaw);
    if (!amtRaw || isNaN(amt) || amt < 1)  { pToast('Invalid amount', 'error'); return; }
    if (!prov)                              { pToast('No method selected', 'error'); return; }
    if (_wallet && amt > parseFloat(_wallet.available_balance)) {
        pToast(`Insufficient balance (${fmt(_wallet.available_balance)})`, 'error'); return;
    }
    const payload = { amount:amtRaw, currency: _wallet?.currency || 'ZMW', provider:prov };

    if (['mtn','airtel','mpesa'].includes(prov)) {
        const phone = document.getElementById('wPhone')?.value.trim().replace(/[\s\-()]/g,'');
        const corr  = document.getElementById('wNetwork')?.value;
        if (!phone) { pToast('Enter phone number', 'warning'); return; }
        if (!corr)  { pToast('Select network', 'warning'); return; }
        if (!/^\+?[1-9]\d{6,14}$/.test(phone)) { pToast('Invalid phone number format', 'error'); return; }
        payload.phone_number  = phone;
        payload.correspondent = corr;
    } else if (prov === 'bank') {
        const acc = document.getElementById('wBankAcc')?.value.trim();
        if (!acc) { pToast('Enter bank account number', 'warning'); return; }
        payload.bank_account = acc;
    } else if (prov === 'paypal') {
        const email = document.getElementById('wPaypalEmail')?.value.trim();
        if (!email) { pToast('Enter PayPal email', 'warning'); return; }
        payload.paypal_email = email;
    }

    setLoadBtn('wSubmitBtn','wSubmitTxt','Processing…');
    try {
        const res  = await api('/payments/wallet/withdraw/', { method:'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
        closeWithdraw();
        pToast('✅ Withdrawal submitted! Processing soon.', 'success');
        loadPaymentData();
        loadTxs();
    } catch (err) { pToast(err.message, 'error'); }
    finally { resetBtn('wSubmitBtn','wSubmitTxt','Withdraw Now'); }
};

// ════════════════════════════════════════
// POLLING — pending payment confirmation
// ════════════════════════════════════════
function startPoll(paymentId) {
    if (!paymentId) return;
    _pendingPayId = paymentId;
    const notice = document.getElementById('pPending');
    if (notice) notice.style.display = 'block';
    let attempts = 0;
    _pollTimer = setInterval(async () => {
        attempts++;
        try {
            const res  = await api(`/payments/status/${paymentId}/`);
            const data = await res.json();
            setTxt('pPendingMsg', `Waiting for confirmation… (${data.status})`);
            if (data.status === 'completed') {
                cancelPoll();
                pToast('✅ Deposit confirmed! Wallet credited.', 'success');
                loadPaymentData(); loadTxs();
            } else if (data.status === 'failed') {
                cancelPoll();
                pToast('❌ Deposit failed. Please try again.', 'error');
            }
        } catch { /* silent */ }
        if (attempts >= 24) {
            cancelPoll();
            pToast('Payment taking longer than expected. Balance updates once confirmed.', 'warning');
        }
    }, 5000);
}

window.cancelPoll = function () {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null; _pendingPayId = null;
    const n = document.getElementById('pPending'); if (n) n.style.display = 'none';
};

// ════════════════════════════════════════
// BUTTON STATE HELPERS
// ════════════════════════════════════════
function setLoadBtn(btnId, txtId, msg) {
    const b = document.getElementById(btnId); if (b) b.disabled = true;
    const t = document.getElementById(txtId); if (t) t.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
}

function resetBtn(btnId, txtId, label) {
    const b = document.getElementById(btnId); if (b) b.disabled = false;
    const t = document.getElementById(txtId); if (t) t.textContent = label;
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
window.pToast = function (msg, type = 'info') {
    const el = document.getElementById('pToastEl');
    if (!el) return;
    el.textContent = msg;
    el.className = `p-toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 4000);
};

// ════════════════════════════════════════
// RETURN-TO-CHALLENGE banner support
// ════════════════════════════════════════
(function checkReturnIntent() {
    const id = sessionStorage.getItem('pendingChallengeId');
    if (!id) return;
    const banner = document.createElement('div');
    banner.style.cssText = 'background:linear-gradient(135deg,#1a2e3a,#1a3a2e);border:1px solid rgba(76,175,80,.35);border-radius:16px;margin-bottom:16px;padding:16px 18px;display:flex;align-items:center;gap:14px;color:#fff;';
    banner.innerHTML = `
        <i class="fas fa-trophy" style="font-size:22px;color:#ffd700;flex-shrink:0"></i>
        <div style="flex:1">
            <strong style="display:block;font-size:13px;margin-bottom:2px">You were trying to enter a challenge</strong>
            <span style="font-size:12px;opacity:.55">Top up your wallet, then go back to continue.</span>
        </div>
        <button onclick="window.location.href='challenges.html'" style="background:linear-gradient(135deg,#4caf50,#8bc34a);border:none;color:#fff;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;margin-right:8px">
            <i class="fas fa-arrow-left"></i> Back to Challenge
        </button>
        <button onclick="this.parentElement.remove();sessionStorage.removeItem('pendingChallengeId')" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:18px;cursor:pointer;padding:4px">&times;</button>
    `;
    const page = document.querySelector('.ppage');
    if (page) page.insertBefore(banner, page.firstChild);
})();
