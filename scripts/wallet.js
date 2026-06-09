/**
 * Wallet — ARTX Platform
 * Handles deposit (PawaPay, Stripe, Paystack) and withdrawal flows.
 */

// Auto-detect API base: works on localhost AND on HTTPS production
const API_BASE_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'https://artx-website.onrender.com/pages/wallet.html' : `${window.location.origin}/api`;

let walletData       = null;
let stripeInstance   = null;   // Stripe.js instance
let stripeCard       = null;   // Stripe card Element
let pollInterval     = null;   // PawaPay status poll timer
let pendingPaymentId = null;   // payment being polled

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) {
        alert('Please log in to access your wallet.');
        window.location.href = 'auth.html';
        return;
    }
    loadWalletData();
    loadTransactions();
});

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

function authHeaders() {
    return {
        'Authorization': `Token ${localStorage.getItem('djangoAuthToken')}`,
        'Content-Type': 'application/json',
    };
}

async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { ...authHeaders(), ...(options.headers || {}) },
    });

    if (response.status === 401) {
        localStorage.removeItem('djangoAuthToken');
        alert('Your session has expired. Please log in again.');
        window.location.href = 'auth.html';
        throw new Error('Session expired');
    }

    return response;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load wallet data
// ─────────────────────────────────────────────────────────────────────────────

async function loadWalletData() {
    try {
        const res  = await apiFetch('/payments/wallet/');
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to load wallet');

        walletData = data.wallet;
        renderWalletBalance();

        if (walletData.is_locked) {
            showNotice(`⚠️ Wallet locked: ${walletData.lock_reason}`, 'warning');
        }
    } catch (err) {
        console.error('loadWalletData:', err);
        showNotice('Failed to load wallet data.', 'error');
    }
}

function renderWalletBalance() {
    const fmt = v => `K${parseFloat(v).toFixed(2)}`;
    document.getElementById('availableBalance').textContent = fmt(walletData.available_balance);
    document.getElementById('walletCurrency').textContent   = walletData.currency;
    document.getElementById('totalDeposited').textContent   = fmt(walletData.total_deposited);
    document.getElementById('totalEarned').textContent      = fmt(walletData.total_earned);
    document.getElementById('totalWithdrawn').textContent   = fmt(walletData.total_withdrawn);
    document.getElementById('withdrawMax').textContent =
        `Available: K${parseFloat(walletData.available_balance).toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load transactions
// ─────────────────────────────────────────────────────────────────────────────

async function loadTransactions(type = '') {
    const list = document.getElementById('transactionList');
    list.innerHTML = '<p class="loading-message"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';

    try {
        const qs  = type ? `?type=${type}` : '';
        const res  = await apiFetch(`/payments/wallet/transactions/${qs}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to load transactions');

        renderTransactions(data.transactions);
    } catch (err) {
        console.error('loadTransactions:', err);
        list.innerHTML = '<p class="error-message">Failed to load transactions.</p>';
    }
}

function renderTransactions(txs) {
    const list = document.getElementById('transactionList');
    if (!txs || txs.length === 0) {
        list.innerHTML = '<p class="empty-message">No transactions yet.</p>';
        return;
    }

    const icons = {
        deposit:    'fas fa-arrow-down',
        withdrawal: 'fas fa-arrow-up',
        earning:    'fas fa-trophy',
        payment:    'fas fa-shopping-cart',
        refund:     'fas fa-undo',
        bonus:      'fas fa-gift',
        fee:        'fas fa-receipt',
        transfer:   'fas fa-exchange-alt',
    };

    list.innerHTML = txs.map(tx => {
        const positive = parseFloat(tx.amount) >= 0;
        const icon     = icons[tx.transaction_type] || 'fas fa-circle';
        const date     = new Date(tx.created_at).toLocaleString();
        return `
        <div class="transaction-item ${positive ? 'positive' : 'negative'}">
            <div class="transaction-icon"><i class="${icon}"></i></div>
            <div class="transaction-details">
                <div class="transaction-desc">${tx.description}</div>
                <div class="transaction-date">${date}</div>
            </div>
            <div class="transaction-amount ${positive ? 'positive' : 'negative'}">
                ${positive ? '+' : ''}K${Math.abs(parseFloat(tx.amount)).toFixed(2)}
            </div>
        </div>`;
    }).join('');
}

function filterTransactions() {
    loadTransactions(document.getElementById('transactionFilter').value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal helpers
// ─────────────────────────────────────────────────────────────────────────────

function showDepositModal() {
    document.getElementById('depositModal').style.display = 'flex';
}

function closeDepositModal() {
    document.getElementById('depositModal').style.display = 'none';
    document.getElementById('depositForm').reset();
    hideDepositProviderFields();
    resetBtn('depositSubmitBtn', 'depositBtnText', 'Deposit Now');

    // Unmount Stripe card if mounted
    if (stripeCard) { stripeCard.unmount(); stripeCard = null; }
}

function showWithdrawModal() {
    if (!walletData || parseFloat(walletData.available_balance) <= 0) {
        alert('You have no available balance to withdraw.');
        return;
    }
    document.getElementById('withdrawModal').style.display = 'flex';
}

function closeWithdrawModal() {
    document.getElementById('withdrawModal').style.display = 'none';
    document.getElementById('withdrawForm').reset();
    hideWithdrawProviderFields();
    resetBtn('withdrawSubmitBtn', 'withdrawBtnText', 'Withdraw Now');
}

// Close on backdrop click
window.addEventListener('click', e => {
    if (e.target === document.getElementById('depositModal'))  closeDepositModal();
    if (e.target === document.getElementById('withdrawModal')) closeWithdrawModal();
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider field visibility
// ─────────────────────────────────────────────────────────────────────────────

function hideDepositProviderFields() {
    ['depositPawapayFields', 'depositStripeFields', 'depositPaystackFields']
        .forEach(id => document.getElementById(id).style.display = 'none');
}

function hideWithdrawProviderFields() {
    ['withdrawMobileFields', 'withdrawBankFields', 'withdrawPaypalFields']
        .forEach(id => document.getElementById(id).style.display = 'none');
}

function handleDepositProviderChange() {
    hideDepositProviderFields();
    const provider = document.getElementById('depositProvider').value;

    if (provider === 'pawapay') {
        document.getElementById('depositPawapayFields').style.display = 'block';
    } else if (provider === 'stripe') {
        document.getElementById('depositStripeFields').style.display = 'block';
        mountStripeCard();
    } else if (provider === 'paystack') {
        document.getElementById('depositPaystackFields').style.display = 'block';
    }
}

function handleWithdrawProviderChange() {
    hideWithdrawProviderFields();
    const provider = document.getElementById('withdrawProvider').value;

    if (['mtn', 'airtel', 'mpesa'].includes(provider)) {
        document.getElementById('withdrawMobileFields').style.display = 'block';
    } else if (provider === 'bank') {
        document.getElementById('withdrawBankFields').style.display = 'block';
    } else if (provider === 'paypal') {
        document.getElementById('withdrawPaypalFields').style.display = 'block';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe card element
// ─────────────────────────────────────────────────────────────────────────────

async function mountStripeCard() {
    // Fetch publishable key from backend if we don't have it
    if (!stripeInstance) {
        try {
            // We get the publishable key from the deposit initiation response.
            // For the card form, we first need to know the key — fetch wallet
            // settings or hardcode it here if it's a public key.
            // For now we'll mount with a placeholder and replace after initiation.
            const pkMeta = document.querySelector('meta[name="stripe-pk"]');
            const pk = pkMeta ? pkMeta.content : null;
            if (!pk) {
                // Mount a placeholder message; key will be fetched on submit
                document.getElementById('stripeCardElement').innerHTML =
                    '<p class="provider-info"><i class="fas fa-credit-card"></i> Card details will be collected securely after you click Deposit.</p>';
                return;
            }
            stripeInstance = Stripe(pk);
        } catch (e) {
            console.warn('Stripe not loaded yet:', e);
            return;
        }
    }

    if (stripeCard) stripeCard.unmount();
    const elements = stripeInstance.elements();
    stripeCard = elements.create('card', {
        style: {
            base: {
                fontSize: '16px',
                color: '#ffffff',
                '::placeholder': { color: '#aab7c4' },
            },
            invalid: { color: '#ff6b6b' },
        },
    });
    stripeCard.mount('#stripeCardElement');
    stripeCard.on('change', e => {
        document.getElementById('stripeCardErrors').textContent =
            e.error ? e.error.message : '';
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Button loading state helpers
// ─────────────────────────────────────────────────────────────────────────────

function setLoadingBtn(btnId, textId, loadingText) {
    const btn  = document.getElementById(btnId);
    const span = document.getElementById(textId);
    btn.disabled = true;
    span.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
}

function resetBtn(btnId, textId, defaultText) {
    const btn  = document.getElementById(btnId);
    const span = document.getElementById(textId);
    btn.disabled = false;
    span.textContent = defaultText;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deposit handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleDeposit(event) {
    event.preventDefault();

    const amountRaw = document.getElementById('depositAmount').value.trim();
    const provider  = document.getElementById('depositProvider').value;

    // Client-side validation
    const amount = parseFloat(amountRaw);
    if (!amountRaw || isNaN(amount) || amount < 1) {
        return alert('Please enter a valid amount (minimum K1.00).');
    }
    if (amount > 1_000_000) {
        return alert('Maximum deposit is K1,000,000.00.');
    }
    if (!provider) {
        return alert('Please select a payment method.');
    }

    const currency = (walletData?.currency) || 'ZMW';

    // ── PawaPay ──────────────────────────────────────────────────────────────
    if (provider === 'pawapay') {
        const phone       = document.getElementById('depositPhone').value.trim();
        const correspondent = document.getElementById('depositCorrespondent').value;

        if (!phone)        return alert('Please enter your phone number.');
        if (!correspondent) return alert('Please select your mobile network.');

        const cleanPhone = phone.replace(/[\s\-()]/g, '');
        if (!/^\+?[1-9]\d{6,14}$/.test(cleanPhone)) {
            return alert('Invalid phone number. Use international format, e.g. +260977123456');
        }

        setLoadingBtn('depositSubmitBtn', 'depositBtnText', 'Sending prompt to phone…');

        try {
            const res  = await apiFetch('/payments/wallet/deposit/', {
                method: 'POST',
                body: JSON.stringify({
                    amount: amountRaw,
                    currency,
                    provider: 'pawapay',
                    phone_number: cleanPhone,
                    correspondent,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Deposit failed.');
            }

            closeDepositModal();
            showNotice(
                `📱 A payment prompt has been sent to ${cleanPhone}. Enter your PIN to confirm the deposit.`,
                'info'
            );

            // Start polling for completion
            startPolling(data.payment_id);

        } catch (err) {
            console.error('PawaPay deposit:', err);
            alert(`Deposit failed: ${err.message}`);
        } finally {
            resetBtn('depositSubmitBtn', 'depositBtnText', 'Deposit Now');
        }
        return;
    }

    // ── Stripe ───────────────────────────────────────────────────────────────
    if (provider === 'stripe') {
        setLoadingBtn('depositSubmitBtn', 'depositBtnText', 'Processing…');

        try {
            // Step 1 — create PaymentIntent on server
            const res  = await apiFetch('/payments/wallet/deposit/', {
                method: 'POST',
                body: JSON.stringify({ amount: amountRaw, currency, provider: 'stripe' }),
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Could not initiate Stripe payment.');

            const { client_secret, publishable_key } = data;

            // Step 2 — mount Stripe with real publishable key if not done yet
            if (!stripeInstance && publishable_key) {
                stripeInstance = Stripe(publishable_key);
                const elements = stripeInstance.elements();
                stripeCard = elements.create('card', {
                    style: {
                        base: { fontSize: '16px', color: '#ffffff',
                                '::placeholder': { color: '#aab7c4' } },
                        invalid: { color: '#ff6b6b' },
                    },
                });
                stripeCard.mount('#stripeCardElement');
            }

            if (!stripeCard) throw new Error('Card form not ready. Please select Stripe again.');

            // Step 3 — confirm card payment
            const { error, paymentIntent } = await stripeInstance.confirmCardPayment(
                client_secret,
                { payment_method: { card: stripeCard } }
            );

            if (error) throw new Error(error.message);

            if (paymentIntent.status === 'succeeded') {
                closeDepositModal();
                showNotice('✅ Card payment successful! Your wallet will be updated shortly.', 'success');
                // Poll until wallet is credited
                startPolling(data.payment_id);
            } else {
                throw new Error(`Unexpected payment status: ${paymentIntent.status}`);
            }

        } catch (err) {
            console.error('Stripe deposit:', err);
            document.getElementById('stripeCardErrors').textContent = err.message;
        } finally {
            resetBtn('depositSubmitBtn', 'depositBtnText', 'Deposit Now');
        }
        return;
    }

    // ── Paystack ─────────────────────────────────────────────────────────────
    if (provider === 'paystack') {
        setLoadingBtn('depositSubmitBtn', 'depositBtnText', 'Redirecting…');

        try {
            const res  = await apiFetch('/payments/wallet/deposit/', {
                method: 'POST',
                body: JSON.stringify({ amount: amountRaw, currency, provider: 'paystack' }),
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Could not initiate Paystack payment.');

            // Redirect to Paystack checkout
            window.location.href = data.authorization_url;

        } catch (err) {
            console.error('Paystack deposit:', err);
            alert(`Deposit failed: ${err.message}`);
            resetBtn('depositSubmitBtn', 'depositBtnText', 'Deposit Now');
        }
        return;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Withdrawal handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleWithdraw(event) {
    event.preventDefault();

    const amountRaw = document.getElementById('withdrawAmount').value.trim();
    const provider  = document.getElementById('withdrawProvider').value;
    const amount    = parseFloat(amountRaw);

    if (!amountRaw || isNaN(amount) || amount < 1) {
        return alert('Please enter a valid amount (minimum K1.00).');
    }
    if (!provider) {
        return alert('Please select a withdrawal method.');
    }
    if (walletData && amount > parseFloat(walletData.available_balance)) {
        return alert(`Insufficient balance. Available: K${parseFloat(walletData.available_balance).toFixed(2)}`);
    }

    const withdrawData = {
        amount: amountRaw,
        currency: walletData?.currency || 'ZMW',
        provider,
    };

    // Provider-specific fields
    if (['mtn', 'airtel', 'mpesa'].includes(provider)) {
        const phone = document.getElementById('withdrawPhone').value.trim();
        const correspondent = document.getElementById('withdrawCorrespondent').value;

        if (!phone) return alert('Please enter your phone number.');
        if (!correspondent) return alert('Please select your mobile network.');

        const cleanPhone = phone.replace(/[\s\-()]/g, '');
        if (!/^\+?[1-9]\d{6,14}$/.test(cleanPhone)) {
            return alert('Invalid phone number. Use international format, e.g. +260977123456');
        }

        withdrawData.phone_number  = cleanPhone;
        withdrawData.correspondent = correspondent;

    } else if (provider === 'bank') {
        const account = document.getElementById('withdrawBank').value.trim();
        if (!account) return alert('Please enter your bank account number.');
        withdrawData.bank_account = account;

    } else if (provider === 'paypal') {
        const email = document.getElementById('withdrawPaypal').value.trim();
        if (!email) return alert('Please enter your PayPal email.');
        withdrawData.paypal_email = email;
    }

    setLoadingBtn('withdrawSubmitBtn', 'withdrawBtnText', 'Processing…');

    try {
        const res  = await apiFetch('/payments/wallet/withdraw/', {
            method: 'POST',
            body: JSON.stringify(withdrawData),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Withdrawal failed.');

        closeWithdrawModal();

        const msg = ['mtn', 'airtel', 'mpesa'].includes(provider)
            ? `✅ Withdrawal submitted! Funds will arrive on your phone shortly.`
            : `✅ Withdrawal request submitted. Processing will complete soon.`;
        showNotice(msg, 'success');

        loadWalletData();
        loadTransactions();

    } catch (err) {
        console.error('Withdrawal error:', err);
        alert(`Withdrawal failed: ${err.message}`);
    } finally {
        resetBtn('withdrawSubmitBtn', 'withdrawBtnText', 'Withdraw Now');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PawaPay / Stripe status polling
// ─────────────────────────────────────────────────────────────────────────────

function startPolling(paymentId) {
    if (!paymentId) return;
    pendingPaymentId = paymentId;

    const notice = document.getElementById('pendingDepositNotice');
    notice.style.display = 'flex';

    let attempts = 0;
    const MAX_ATTEMPTS = 24;   // 2 minutes at 5s intervals

    pollInterval = setInterval(async () => {
        attempts++;
        try {
            const res  = await apiFetch(`/payments/status/${paymentId}/`);
            const data = await res.json();

            document.getElementById('pendingDepositMsg').textContent =
                `Waiting for payment confirmation… (${data.status})`;

            if (data.status === 'completed') {
                cancelPolling();
                showNotice('✅ Deposit confirmed! Your wallet has been credited.', 'success');
                loadWalletData();
                loadTransactions();
            } else if (data.status === 'failed') {
                cancelPolling();
                showNotice('❌ Deposit failed. Please try again.', 'error');
            }
        } catch (e) {
            console.warn('Poll error:', e);
        }

        if (attempts >= MAX_ATTEMPTS) {
            cancelPolling();
            showNotice(
                'Payment is taking longer than expected. Your balance will update once confirmed.',
                'warning'
            );
        }
    }, 5000);
}

function cancelPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    pendingPaymentId = null;
    document.getElementById('pendingDepositNotice').style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline notice banner (replaces alert() for non-critical messages)
// ─────────────────────────────────────────────────────────────────────────────

function showNotice(message, type = 'info') {
    let banner = document.getElementById('walletNoticeBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'walletNoticeBanner';
        banner.style.cssText = [
            'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
            'max-width:480px', 'width:90%', 'padding:14px 20px', 'border-radius:10px',
            'font-size:15px', 'z-index:9999', 'text-align:center',
            'box-shadow:0 4px 16px rgba(0,0,0,.3)', 'cursor:pointer',
        ].join(';');
        banner.addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
    }

    const colours = {
        success: { bg: '#1a7a4a', border: '#27ae60' },
        error:   { bg: '#7a1a1a', border: '#e74c3c' },
        warning: { bg: '#7a5c1a', border: '#f39c12' },
        info:    { bg: '#1a3a7a', border: '#3498db' },
    };
    const c = colours[type] || colours.info;
    banner.style.background    = c.bg;
    banner.style.border        = `2px solid ${c.border}`;
    banner.style.color         = '#fff';
    banner.textContent         = message;

    // Auto-dismiss after 6 seconds
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.remove(), 6000);
}
