/**
 * ARTX Wallet — wallet.js
 * Deposit (PawaPay / Stripe / Paystack), Withdrawal, Transactions,
 * Mini chart, Stepper modals, Search & filter.
 */

const API_BASE_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

let walletData       = null;
let stripeInstance   = null;
let stripeCard       = null;
let pollInterval     = null;
let pendingPaymentId = null;

let _allTxs      = [];
let _txShown     = 15;
let _txFilter    = '';
let _txSearch    = '';

// ─────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = 'auth.html'; return; }
    loadWalletData();
    loadTransactions();

    // Filter pill clicks
    document.getElementById('txFilterPills')?.addEventListener('click', e => {
        const pill = e.target.closest('.wtx-pill');
        if (!pill) return;
        document.querySelectorAll('.wtx-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _txFilter = pill.dataset.filter;
        _txShown  = 15;
        renderFilteredTx();
    });
});

// ─────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────
function authHeaders() {
    return { 'Authorization': `Token ${localStorage.getItem('djangoAuthToken')}`, 'Content-Type': 'application/json' };
}
async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    if (res.status === 401) {
        localStorage.removeItem('djangoAuthToken');
        window.location.href = 'auth.html';
        throw new Error('Session expired');
    }
    return res;
}

// ─────────────────────────────────────────────────────
// LOAD WALLET
// ─────────────────────────────────────────────────────
async function loadWalletData() {
    try {
        const res  = await apiFetch('/payments/wallet/');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        walletData = data.wallet;
        renderWalletBalance();
        buildMiniChart();
    } catch (err) {
        showNotice('Failed to load wallet data.', 'error');
    }
}

function fmt(v) { return `K${parseFloat(v || 0).toFixed(2)}`; }

function renderWalletBalance() {
    animateCount('availableBalance', walletData.available_balance);
    setText('walletCurrency',  walletData.currency || 'ZMW');
    setText('totalDeposited',  fmt(walletData.total_deposited));
    setText('totalEarned',     fmt(walletData.total_earned));
    setText('totalWithdrawn',  fmt(walletData.total_withdrawn));
    setText('totalSpent',      fmt(walletData.total_spent || 0));
    setText('withdrawAvailLabel', `Available: ${fmt(walletData.available_balance)}`);
    setText('withdrawMax',     `Available: ${fmt(walletData.available_balance)}`);
    // Status badge
    const statusEl = document.getElementById('walletStatus');
    if (statusEl) statusEl.textContent = walletData.is_locked ? '⚠ Locked' : 'Active';
    if (walletData.is_locked) showNotice(`Wallet locked: ${walletData.lock_reason}`, 'warning');
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = 0, end = parseFloat(target || 0), duration = 900;
    const startTime = performance.now();
    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = `K${(start + (end - start) * eased).toFixed(2)}`;
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─────────────────────────────────────────────────────
// MINI CHART (7-day in/out bars)
// ─────────────────────────────────────────────────────
function buildMiniChart() {
    const wrap = document.getElementById('miniChart');
    if (!wrap || !_allTxs.length) { buildMiniChartFromTxs(wrap); return; }
    buildMiniChartFromTxs(wrap);
}

function buildMiniChartFromTxs(wrap) {
    if (!wrap) return;
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today = new Date(); today.setHours(0,0,0,0);
    const days  = Array.from({ length: 7 }, (_, i) => {
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
    const maxVal = Math.max(...days.map(d => Math.max(d.in, d.out)), 1);
    wrap.innerHTML = days.map(d => {
        const inH  = Math.round((d.in  / maxVal) * 80);
        const outH = Math.round((d.out / maxVal) * 80);
        return `
        <div class="wbar-group">
            <div class="wbar in-bar"  style="height:0px" data-h="${inH}"></div>
            <div class="wbar out-bar" style="height:0px" data-h="${outH}">
                <span class="wbar-label">${d.label}</span>
            </div>
        </div>`;
    }).join('');
    // Animate bars
    requestAnimationFrame(() => setTimeout(() => {
        wrap.querySelectorAll('.wbar').forEach(b => b.style.height = b.dataset.h + 'px');
    }, 80));
}

// ─────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────
async function loadTransactions() {
    const list = document.getElementById('transactionList');
    if (list) list.innerHTML = '<div class="wtx-skeleton"><div class="wtx-sk"></div><div class="wtx-sk short"></div><div class="wtx-sk"></div><div class="wtx-sk short"></div></div>';
    try {
        const res  = await apiFetch('/payments/wallet/transactions/');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        _allTxs  = data.transactions || [];
        _txShown = 15;
        renderFilteredTx();
        buildMiniChart(); // rebuild chart after txs load
    } catch {
        if (list) list.innerHTML = '<div class="wtx-error"><i class="fas fa-triangle-exclamation"></i><span>Could not load transactions.</span></div>';
    }
}

function searchTransactions() {
    _txSearch = (document.getElementById('txSearch')?.value || '').toLowerCase().trim();
    _txShown  = 15;
    renderFilteredTx();
}

function renderFilteredTx() {
    let items = _allTxs;
    if (_txFilter) items = items.filter(t => t.transaction_type === _txFilter);
    if (_txSearch) items = items.filter(t => (t.description || '').toLowerCase().includes(_txSearch));
    renderTransactions(items.slice(0, _txShown));
    const btn = document.getElementById('txLoadMore');
    if (btn) btn.style.display = items.length > _txShown ? 'flex' : 'none';
}

window.loadMoreTransactions = function() {
    _txShown += 15;
    renderFilteredTx();
};

const TX_ICONS = {
    deposit:    { icon:'fas fa-arrow-down',    bg:'linear-gradient(135deg,#16a34a,#4ade80)' },
    withdrawal: { icon:'fas fa-arrow-up',       bg:'linear-gradient(135deg,#dc2626,#f87171)' },
    earning:    { icon:'fas fa-trophy',         bg:'linear-gradient(135deg,#d97706,#fbbf24)' },
    payment:    { icon:'fas fa-shopping-cart',  bg:'linear-gradient(135deg,#7c3aed,#a78bfa)' },
    refund:     { icon:'fas fa-rotate-left',    bg:'linear-gradient(135deg,#0891b2,#22d3ee)' },
    bonus:      { icon:'fas fa-gift',           bg:'linear-gradient(135deg,#db2777,#f472b6)' },
    fee:        { icon:'fas fa-receipt',        bg:'linear-gradient(135deg,#374151,#6b7280)' },
    transfer:   { icon:'fas fa-arrows-left-right',bg:'linear-gradient(135deg,#0891b2,#38bdf8)'},
};

function renderTransactions(txs) {
    const list = document.getElementById('transactionList');
    if (!list) return;
    if (!txs.length) {
        list.innerHTML = '<div class="wtx-empty"><i class="fas fa-receipt"></i><span>No transactions found.</span></div>';
        return;
    }
    list.innerHTML = txs.map((tx, i) => {
        const pos  = parseFloat(tx.amount) >= 0;
        const meta = TX_ICONS[tx.transaction_type] || { icon:'fas fa-circle', bg:'linear-gradient(135deg,#6b7280,#9ca3af)' };
        const date = new Date(tx.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
        const status = tx.status || 'completed';
        return `
        <div class="wtx-item" style="animation-delay:${i*0.03}s">
            <div class="wtx-icon" style="background:${meta.bg}"><i class="${meta.icon}" style="color:#fff"></i></div>
            <div class="wtx-body">
                <div class="wtx-desc">${tx.description || tx.transaction_type}</div>
                <div class="wtx-meta">
                    <span>${date}</span>
                    <span class="wtx-status ${status}">${status}</span>
                </div>
            </div>
            <div class="wtx-amount ${pos ? 'positive' : 'negative'}">
                ${pos ? '+' : ''}K${Math.abs(parseFloat(tx.amount)).toFixed(2)}
            </div>
        </div>`;
    }).join('');
}

// Expose for old HTML select (kept for compatibility)
window.filterTransactions = function() {
    _txFilter = document.getElementById('transactionFilter')?.value || '';
    _txShown  = 15;
    renderFilteredTx();
};

// ─────────────────────────────────────────────────────
// AMOUNT DISPLAY HELPER
// ─────────────────────────────────────────────────────
window.updateAmountDisplay = function(displayId, inputId) {
    const val = parseFloat(document.getElementById(inputId)?.value || 0);
    const el  = document.getElementById(displayId);
    if (el) el.textContent = isNaN(val) ? 'K0' : `K${val % 1 === 0 ? val : val.toFixed(2)}`;
};
window.setDepositPreset  = function(v) { const el = document.getElementById('depositAmount');  if (el) { el.value = v; updateAmountDisplay('dAmountDisplay','depositAmount'); } };
window.setWithdrawPreset = function(v) { const el = document.getElementById('withdrawAmount'); if (el) { el.value = v; updateAmountDisplay('wAmountDisplay','withdrawAmount'); } };

// ─────────────────────────────────────────────────────
// DEPOSIT MODAL — STEPPER
// ─────────────────────────────────────────────────────
window.showDepositModal = function() {
    const m = document.getElementById('depositModal');
    if (m) m.classList.add('open');
    setDepositStep(1);
};
window.closeDepositModal = function() {
    const m = document.getElementById('depositModal');
    if (m) m.classList.remove('open');
    document.getElementById('depositForm')?.reset();
    setText('dAmountDisplay','K0');
    hideDepositProviderFields();
    resetBtn('depositSubmitBtn','depositBtnText','Deposit Now');
    if (stripeCard) { stripeCard.unmount(); stripeCard = null; }
};

function setDepositStep(n) {
    [1,2,3].forEach(i => {
        const panel = document.getElementById(`dpanel${i}`);
        const step  = document.getElementById(`dstep${i}`);
        if (panel) panel.classList.toggle('active', i === n);
        if (step)  { step.classList.toggle('active', i === n); step.classList.toggle('done', i < n); }
    });
}

window.depositNextStep = function(current) {
    if (current === 1) {
        const amt = parseFloat(document.getElementById('depositAmount')?.value || 0);
        if (!amt || amt < 1) { showNotice('Enter a valid amount (min K1)','warning'); return; }
        setDepositStep(2);
    } else if (current === 2) {
        const provider = document.querySelector('input[name="depositProvider"]:checked')?.value;
        if (!provider) { showNotice('Select a payment method','warning'); return; }
        // Populate review
        const methodLabels = { pawapay:'Mobile Money', stripe:'Card (Stripe)', paystack:'Paystack' };
        setText('dReviewAmount',   `K${parseFloat(document.getElementById('depositAmount').value).toFixed(2)}`);
        setText('dReviewMethod',   methodLabels[provider] || provider);
        setText('dReviewCurrency', walletData?.currency || 'ZMW');
        const phone = document.getElementById('depositPhone')?.value.trim();
        const phoneRow = document.getElementById('dReviewPhoneRow');
        if (phone && phoneRow) { phoneRow.style.display = 'flex'; setText('dReviewPhone', phone); }
        else if (phoneRow)    { phoneRow.style.display = 'none'; }
        setDepositStep(3);
    }
};
window.depositGoBack = function(current) { setDepositStep(current - 1); };

// ─────────────────────────────────────────────────────
// WITHDRAW MODAL — STEPPER
// ─────────────────────────────────────────────────────
window.showWithdrawModal = function() {
    if (!walletData || parseFloat(walletData.available_balance) <= 0) {
        showNotice('No available balance to withdraw.','warning'); return;
    }
    const m = document.getElementById('withdrawModal');
    if (m) m.classList.add('open');
    setWithdrawStep(1);
};
window.closeWithdrawModal = function() {
    const m = document.getElementById('withdrawModal');
    if (m) m.classList.remove('open');
    document.getElementById('withdrawForm')?.reset();
    setText('wAmountDisplay','K0');
    hideWithdrawProviderFields();
    resetBtn('withdrawSubmitBtn','withdrawBtnText','Withdraw Now');
};

function setWithdrawStep(n) {
    [1,2,3].forEach(i => {
        const panel = document.getElementById(`wpanel${i}`);
        const step  = document.getElementById(`wstep${i}`);
        if (panel) panel.classList.toggle('active', i === n);
        if (step)  { step.classList.toggle('active', i === n); step.classList.toggle('done', i < n); }
    });
}

window.withdrawNextStep = function(current) {
    if (current === 1) {
        const amt  = parseFloat(document.getElementById('withdrawAmount')?.value || 0);
        const avail = parseFloat(walletData?.available_balance || 0);
        if (!amt || amt < 1)     { showNotice('Enter a valid amount (min K1)','warning'); return; }
        if (amt > avail)         { showNotice(`Exceeds available balance (${fmt(avail)})`,'error'); return; }
        setWithdrawStep(2);
    } else if (current === 2) {
        const provider = document.querySelector('input[name="withdrawProvider"]:checked')?.value;
        if (!provider) { showNotice('Select a withdrawal method','warning'); return; }
        const labelMap = { mtn:'MTN Mobile Money', airtel:'Airtel Money', mpesa:'M-Pesa', bank:'Bank Transfer', paypal:'PayPal' };
        setText('wReviewAmount',   `K${parseFloat(document.getElementById('withdrawAmount').value).toFixed(2)}`);
        setText('wReviewMethod',   labelMap[provider] || provider);
        setText('wReviewCurrency', walletData?.currency || 'ZMW');
        const phone = document.getElementById('withdrawPhone')?.value.trim();
        const phoneRow = document.getElementById('wReviewPhoneRow');
        if (phone && phoneRow) { phoneRow.style.display = 'flex'; setText('wReviewPhone', phone); }
        else if (phoneRow)     { phoneRow.style.display = 'none'; }
        setWithdrawStep(3);
    }
};
window.withdrawGoBack = function(current) { setWithdrawStep(current - 1); };

// Close modals on backdrop click
window.addEventListener('click', e => {
    if (e.target === document.getElementById('depositModal'))  window.closeDepositModal();
    if (e.target === document.getElementById('withdrawModal')) window.closeWithdrawModal();
});

// ─────────────────────────────────────────────────────
// PROVIDER FIELD VISIBILITY
// ─────────────────────────────────────────────────────
function hideDepositProviderFields() {
    ['depositPawapayFields','depositStripeFields','depositPaystackFields'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
}
function hideWithdrawProviderFields() {
    ['withdrawMobileFields','withdrawBankFields','withdrawPaypalFields'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
}
window.handleDepositProviderChange = function() {
    hideDepositProviderFields();
    const p = document.querySelector('input[name="depositProvider"]:checked')?.value;
    if (p === 'pawapay') document.getElementById('depositPawapayFields').style.display = 'block';
    else if (p === 'stripe')   { document.getElementById('depositStripeFields').style.display = 'block'; mountStripeCard(); }
    else if (p === 'paystack') document.getElementById('depositPaystackFields').style.display = 'block';
};
window.handleWithdrawProviderChange = function() {
    hideWithdrawProviderFields();
    const p = document.querySelector('input[name="withdrawProvider"]:checked')?.value;
    if (['mtn','airtel','mpesa'].includes(p)) document.getElementById('withdrawMobileFields').style.display = 'block';
    else if (p === 'bank')   document.getElementById('withdrawBankFields').style.display = 'block';
    else if (p === 'paypal') document.getElementById('withdrawPaypalFields').style.display = 'block';
};

// ─────────────────────────────────────────────────────
// STRIPE
// ─────────────────────────────────────────────────────
async function mountStripeCard() {
    if (!stripeInstance) {
        const pkMeta = document.querySelector('meta[name="stripe-pk"]');
        const pk = pkMeta?.content;
        if (!pk) {
            document.getElementById('stripeCardElement').innerHTML =
                '<p style="font-size:12px;color:#9ca3af;padding:8px 0">Card details collected after clicking Deposit.</p>';
            return;
        }
        stripeInstance = Stripe(pk);
    }
    if (stripeCard) stripeCard.unmount();
    const elements = stripeInstance.elements();
    stripeCard = elements.create('card', {
        style: { base: { fontSize:'15px', color:'#ffffff', '::placeholder':{ color:'#aab7c4' } }, invalid:{ color:'#ff6b6b' } }
    });
    stripeCard.mount('#stripeCardElement');
    stripeCard.on('change', e => {
        const err = document.getElementById('stripeCardErrors');
        if (err) err.textContent = e.error ? e.error.message : '';
    });
}

// ─────────────────────────────────────────────────────
// BUTTON STATE
// ─────────────────────────────────────────────────────
function setLoadingBtn(btnId, textId, msg) {
    const btn = document.getElementById(btnId); if (btn) btn.disabled = true;
    const sp  = document.getElementById(textId); if (sp) sp.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`;
}
function resetBtn(btnId, textId, label) {
    const btn = document.getElementById(btnId); if (btn) btn.disabled = false;
    const sp  = document.getElementById(textId); if (sp) sp.textContent = label;
}

// ─────────────────────────────────────────────────────
// DEPOSIT HANDLER
// ─────────────────────────────────────────────────────
window.handleDeposit = async function(event) {
    event.preventDefault();
    const amountRaw = document.getElementById('depositAmount')?.value.trim();
    const provider  = document.querySelector('input[name="depositProvider"]:checked')?.value;
    const amount    = parseFloat(amountRaw);
    if (!amountRaw || isNaN(amount) || amount < 1) { showNotice('Invalid amount','error'); return; }
    if (!provider) { showNotice('No payment method selected','error'); return; }
    const currency = walletData?.currency || 'ZMW';

    if (provider === 'pawapay') {
        const phone = document.getElementById('depositPhone')?.value.trim().replace(/[\s\-()]/g,'');
        const corr  = document.getElementById('depositCorrespondent')?.value;
        if (!phone) { showNotice('Enter phone number','warning'); return; }
        if (!corr)  { showNotice('Select mobile network','warning'); return; }
        if (!/^\+?[1-9]\d{6,14}$/.test(phone)) { showNotice('Invalid phone number','error'); return; }
        setLoadingBtn('depositSubmitBtn','depositBtnText','Sending to phone…');
        try {
            const res  = await apiFetch('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amountRaw, currency, provider:'pawapay', phone_number:phone, correspondent:corr }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Deposit failed');
            window.closeDepositModal();
            showNotice(`📱 Prompt sent to ${phone}. Enter your PIN to confirm.`,'info');
            startPolling(data.payment_id);
        } catch (err) { showNotice(err.message,'error'); }
        finally { resetBtn('depositSubmitBtn','depositBtnText','Deposit Now'); }
        return;
    }

    if (provider === 'stripe') {
        setLoadingBtn('depositSubmitBtn','depositBtnText','Processing…');
        try {
            const res  = await apiFetch('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amountRaw, currency, provider:'stripe' }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not initiate Stripe');
            if (!stripeInstance && data.publishable_key) {
                stripeInstance = Stripe(data.publishable_key);
                const el = stripeInstance.elements().create('card', { style:{ base:{ fontSize:'15px', color:'#fff' } } });
                el.mount('#stripeCardElement'); stripeCard = el;
            }
            if (!stripeCard) throw new Error('Card form not ready. Please select Stripe again.');
            const { error, paymentIntent } = await stripeInstance.confirmCardPayment(data.client_secret, { payment_method:{ card: stripeCard } });
            if (error) throw new Error(error.message);
            if (paymentIntent.status === 'succeeded') {
                window.closeDepositModal();
                showNotice('✅ Card payment successful! Wallet updating shortly.','success');
                startPolling(data.payment_id);
            }
        } catch (err) {
            const errEl = document.getElementById('stripeCardErrors'); if (errEl) errEl.textContent = err.message;
            showNotice(err.message,'error');
        }
        finally { resetBtn('depositSubmitBtn','depositBtnText','Deposit Now'); }
        return;
    }

    if (provider === 'paystack') {
        setLoadingBtn('depositSubmitBtn','depositBtnText','Redirecting…');
        try {
            const res  = await apiFetch('/payments/wallet/deposit/', { method:'POST', body: JSON.stringify({ amount:amountRaw, currency, provider:'paystack' }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Paystack initiation failed');
            window.location.href = data.authorization_url;
        } catch (err) { showNotice(err.message,'error'); resetBtn('depositSubmitBtn','depositBtnText','Deposit Now'); }
        return;
    }
};

// ─────────────────────────────────────────────────────
// WITHDRAW HANDLER
// ─────────────────────────────────────────────────────
window.handleWithdraw = async function(event) {
    event.preventDefault();
    const amountRaw = document.getElementById('withdrawAmount')?.value.trim();
    const provider  = document.querySelector('input[name="withdrawProvider"]:checked')?.value;
    const amount    = parseFloat(amountRaw);
    if (!amountRaw || isNaN(amount) || amount < 1) { showNotice('Invalid amount','error'); return; }
    if (!provider) { showNotice('No method selected','error'); return; }
    if (walletData && amount > parseFloat(walletData.available_balance)) {
        showNotice(`Insufficient balance (${fmt(walletData.available_balance)})`,'error'); return;
    }
    const payload = { amount:amountRaw, currency: walletData?.currency || 'ZMW', provider };

    if (['mtn','airtel','mpesa'].includes(provider)) {
        const phone = document.getElementById('withdrawPhone')?.value.trim().replace(/[\s\-()]/g,'');
        const corr  = document.getElementById('withdrawCorrespondent')?.value;
        if (!phone) { showNotice('Enter phone number','warning'); return; }
        if (!corr)  { showNotice('Select network','warning'); return; }
        if (!/^\+?[1-9]\d{6,14}$/.test(phone)) { showNotice('Invalid phone number','error'); return; }
        payload.phone_number = phone; payload.correspondent = corr;
    } else if (provider === 'bank') {
        const acc = document.getElementById('withdrawBank')?.value.trim();
        if (!acc) { showNotice('Enter bank account number','warning'); return; }
        payload.bank_account = acc;
    } else if (provider === 'paypal') {
        const email = document.getElementById('withdrawPaypal')?.value.trim();
        if (!email) { showNotice('Enter PayPal email','warning'); return; }
        payload.paypal_email = email;
    }

    setLoadingBtn('withdrawSubmitBtn','withdrawBtnText','Processing…');
    try {
        const res  = await apiFetch('/payments/wallet/withdraw/', { method:'POST', body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
        window.closeWithdrawModal();
        showNotice('✅ Withdrawal submitted! Processing soon.','success');
        loadWalletData();
        loadTransactions();
    } catch (err) { showNotice(err.message,'error'); }
    finally { resetBtn('withdrawSubmitBtn','withdrawBtnText','Withdraw Now'); }
};

// ─────────────────────────────────────────────────────
// POLLING
// ─────────────────────────────────────────────────────
function startPolling(paymentId) {
    if (!paymentId) return;
    pendingPaymentId = paymentId;
    const notice = document.getElementById('pendingDepositNotice');
    if (notice) notice.style.display = 'block';
    let attempts = 0;
    pollInterval = setInterval(async () => {
        attempts++;
        try {
            const res  = await apiFetch(`/payments/status/${paymentId}/`);
            const data = await res.json();
            setText('pendingDepositMsg', `Waiting for confirmation… (${data.status})`);
            if (data.status === 'completed') {
                cancelPolling();
                showNotice('✅ Deposit confirmed! Wallet credited.','success');
                loadWalletData(); loadTransactions();
            } else if (data.status === 'failed') {
                cancelPolling(); showNotice('❌ Deposit failed. Please try again.','error');
            }
        } catch { /* silent */ }
        if (attempts >= 24) { cancelPolling(); showNotice('Payment taking longer than expected. Balance will update once confirmed.','warning'); }
    }, 5000);
}

window.cancelPolling = function() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null; pendingPaymentId = null;
    const n = document.getElementById('pendingDepositNotice'); if (n) n.style.display = 'none';
};

// ─────────────────────────────────────────────────────
// TOAST / NOTICE
// ─────────────────────────────────────────────────────
window.showNotice = function(message, type = 'info') {
    const toast = document.getElementById('wtoast');
    if (!toast) return;
    const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    toast.textContent = `${icons[type] || ''} ${message}`;
    toast.className = `wtoast show wtoast-${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 4000);
};
