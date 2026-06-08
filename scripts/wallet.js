// Wallet Management System - Django Backend Integration

const API_BASE_URL = 'http://localhost:8000/api';
let walletData = null;
let transactions = [];

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('djangoAuthToken');
    
    if (!token) {
        alert('Please login to access your wallet');
        window.location.href = 'auth.html';
        return;
    }
    
    loadWalletData();
    loadTransactions();
});

// Load wallet balance and stats
async function loadWalletData() {
    try {
        const token = localStorage.getItem('djangoAuthToken');
        const response = await fetch(`${API_BASE_URL}/payments/wallet/`, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load wallet data');
        }
        
        const data = await response.json();
        walletData = data.wallet;
        
        // Update UI
        document.getElementById('availableBalance').textContent = 
            `K${parseFloat(walletData.available_balance).toFixed(2)}`;
        document.getElementById('walletCurrency').textContent = walletData.currency;
        document.getElementById('totalDeposited').textContent = 
            `K${parseFloat(walletData.total_deposited).toFixed(2)}`;
        document.getElementById('totalEarned').textContent = 
            `K${parseFloat(walletData.total_earned).toFixed(2)}`;
        document.getElementById('totalWithdrawn').textContent = 
            `K${parseFloat(walletData.total_withdrawn).toFixed(2)}`;
        
        // Update withdraw max
        document.getElementById('withdrawMax').textContent = 
            `Maximum: K${parseFloat(walletData.available_balance).toFixed(2)}`;
        
        // Check if wallet is locked
        if (walletData.is_locked) {
            alert(`⚠️ Your wallet is locked: ${walletData.lock_reason}`);
        }
        
    } catch (error) {
        console.error('Error loading wallet:', error);
        alert('Failed to load wallet data');
    }
}

// Load transaction history
async function loadTransactions(type = '') {
    try {
        const token = localStorage.getItem('djangoAuthToken');
        let url = `${API_BASE_URL}/payments/wallet/transactions/`;
        
        if (type) {
            url += `?type=${type}`;
        }
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load transactions');
        }
        
        const data = await response.json();
        transactions = data.transactions;
        
        renderTransactions();
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        document.getElementById('transactionList').innerHTML = 
            '<p class="error-message">Failed to load transactions</p>';
    }
}

// Render transactions
function renderTransactions() {
    const container = document.getElementById('transactionList');
    
    if (transactions.length === 0) {
        container.innerHTML = '<p class="empty-message">No transactions yet</p>';
        return;
    }
    
    container.innerHTML = transactions.map(tx => {
        const isPositive = parseFloat(tx.amount) >= 0;
        const icon = getTransactionIcon(tx.transaction_type);
        const date = new Date(tx.created_at).toLocaleString();
        
        return `
            <div class="transaction-item ${isPositive ? 'positive' : 'negative'}">
                <div class="transaction-icon">
                    <i class="${icon}"></i>
                </div>
                <div class="transaction-details">
                    <div class="transaction-desc">${tx.description}</div>
                    <div class="transaction-date">${date}</div>
                </div>
                <div class="transaction-amount ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '+' : ''}K${Math.abs(parseFloat(tx.amount)).toFixed(2)}
                </div>
            </div>
        `;
    }).join('');
}

// Get transaction icon
function getTransactionIcon(type) {
    const icons = {
        'deposit': 'fas fa-arrow-down',
        'withdrawal': 'fas fa-arrow-up',
        'earning': 'fas fa-trophy',
        'payment': 'fas fa-shopping-cart',
        'refund': 'fas fa-undo',
        'bonus': 'fas fa-gift',
        'fee': 'fas fa-receipt',
        'transfer': 'fas fa-exchange-alt'
    };
    return icons[type] || 'fas fa-circle';
}

// Filter transactions
function filterTransactions() {
    const type = document.getElementById('transactionFilter').value;
    loadTransactions(type);
}

// Show deposit modal
function showDepositModal() {
    document.getElementById('depositModal').style.display = 'block';
}

// Close deposit modal
function closeDepositModal() {
    document.getElementById('depositModal').style.display = 'none';
    document.getElementById('depositForm').reset();
    document.getElementById('depositPawapayFields').style.display = 'none';
}

// Show withdraw modal
function showWithdrawModal() {
    if (!walletData || parseFloat(walletData.available_balance) <= 0) {
        alert('Insufficient balance for withdrawal');
        return;
    }
    document.getElementById('withdrawModal').style.display = 'block';
}

// Close withdraw modal
function closeWithdrawModal() {
    document.getElementById('withdrawModal').style.display = 'none';
    document.getElementById('withdrawForm').reset();
    hideAllWithdrawFields();
}

// Handle provider change
function handleProviderChange(formType) {
    if (formType === 'deposit') {
        const provider = document.getElementById('depositProvider').value;
        const pawapayFields = document.getElementById('depositPawapayFields');
        
        if (provider === 'pawapay') {
            pawapayFields.style.display = 'block';
            populateCorrespondents();
        } else {
            pawapayFields.style.display = 'none';
        }
    } else if (formType === 'withdraw') {
        const provider = document.getElementById('withdrawProvider').value;
        hideAllWithdrawFields();
        
        if (['mtn', 'airtel', 'mpesa'].includes(provider)) {
            document.getElementById('withdrawMobileFields').style.display = 'block';
        } else if (provider === 'bank') {
            document.getElementById('withdrawBankFields').style.display = 'block';
        } else if (provider === 'paypal') {
            document.getElementById('withdrawPaypalFields').style.display = 'block';
        }
    }
}

// Hide all withdraw fields
function hideAllWithdrawFields() {
    document.getElementById('withdrawMobileFields').style.display = 'none';
    document.getElementById('withdrawBankFields').style.display = 'none';
    document.getElementById('withdrawPaypalFields').style.display = 'none';
}

// Populate correspondents based on phone number
function populateCorrespondents() {
    const correspondents = [
        { value: 'MTN_MOMO_ZMB', label: 'MTN Mobile Money (Zambia)' },
        { value: 'AIRTEL_OAPI_ZMB', label: 'Airtel Money (Zambia)' },
        { value: 'VODACOM_MPESA_TZA', label: 'M-Pesa (Tanzania)' },
        { value: 'SAFARICOM_MPESA_KEN', label: 'M-Pesa (Kenya)' },
        { value: 'MTN_MOMO_UGA', label: 'MTN Mobile Money (Uganda)' },
        { value: 'MTN_MOMO_GHA', label: 'MTN Mobile Money (Ghana)' },
        { value: 'MTN_MOMO_NGA', label: 'MTN Mobile Money (Nigeria)' }
    ];
    
    const select = document.getElementById('depositCorrespondent');
    select.innerHTML = '<option value="">Select provider</option>' +
        correspondents.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
}

// Handle deposit
async function handleDeposit(event) {
    event.preventDefault();
    
    const amountValue = document.getElementById('depositAmount').value.trim();
    const provider = document.getElementById('depositProvider').value;
    
    if (!amountValue) {
        alert('Please enter an amount');
        return;
    }
    
    // Use string to preserve decimal precision
    const amount = parseFloat(amountValue);
    if (Number.isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount greater than zero');
        return;
    }
    
    // Validate minimum and maximum amounts
    if (amount < 1) {
        alert('Minimum deposit amount is K1.00');
        return;
    }
    
    if (amount > 1000000) {
        alert('Maximum deposit amount is K1,000,000.00');
        return;
    }
    
    if (!provider) {
        alert('Please select a payment method');
        return;
    }
    
    // Always use a valid currency - default to ZMW if not set
    const validCurrencies = ['USD', 'KES', 'UGX', 'TZS', 'ZMW', 'GHS', 'NGN', 'ZAR'];
    const walletCurrency = walletData?.currency || 'ZMW';
    const currency = validCurrencies.includes(walletCurrency) ? walletCurrency : 'ZMW';
    
    const depositData = {
        amount: amountValue,  // Send as string to preserve precision
        currency: currency,
        provider: provider
    };
    
    // Add PawaPay fields if needed
    if (provider === 'pawapay') {
        const phone = document.getElementById('depositPhone').value.trim();
        const correspondent = document.getElementById('depositCorrespondent').value;
        
        if (!phone || !correspondent) {
            alert('Please fill in all PawaPay fields');
            return;
        }
        
        // Validate phone number format
        const phonePattern = /^\+?[1-9]\d{1,14}$/;
        const cleanPhone = phone.replace(/[\s-]/g, '');
        if (!phonePattern.test(cleanPhone)) {
            alert('Invalid phone number format. Use international format (e.g., +260977123456)');
            return;
        }
        
        depositData.phone_number = cleanPhone;
        depositData.correspondent = correspondent;
    }
    
    console.log('Sending deposit request:', depositData);
    
    try {
        const token = localStorage.getItem('djangoAuthToken');
        
        // Check if token exists
        if (!token) {
            alert('Authentication error: Please log in again');
            window.location.href = 'pages/auth.html';
            return;
        }
        
        console.log('Token status:', token ? 'Present' : 'Missing');
        
        const response = await fetch(`${API_BASE_URL}/payments/wallet/deposit/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(depositData)
        });
        
        const data = await response.json();
        console.log('Deposit response:', data);
        
        if (!response.ok) {
            // Handle authentication errors
            if (response.status === 401 || response.status === 403) {
                alert('Authentication error: Your session has expired. Please log in again.');
                localStorage.removeItem('djangoAuthToken');
                window.location.href = 'pages/auth.html';
                return;
            }
            
            // Show detailed error message
            let errorMessage = data.error || 'Deposit failed';
            if (data.details) {
                // Format the details nicely
                const details = typeof data.details === 'object' 
                    ? JSON.stringify(data.details, null, 2) 
                    : data.details;
                errorMessage += `\n\nDetails: ${details}`;
            }
            if (data.hint) {
                errorMessage += `\n\nHint: ${data.hint}`;
            }
            throw new Error(errorMessage);
        }
        
        if (provider === 'pawapay') {
            alert(`✅ Deposit initiated!\n\nCheck your phone to complete the payment.\n\nDeposit ID: ${data.deposit_id}`);
        } else if (data.payment_url || data.authorization_url) {
            window.location.href = data.payment_url || data.authorization_url;
            return;
        } else if (data.client_secret) {
            alert('✅ Deposit initiated. Complete the Stripe payment flow in your browser.');
        } else {
            alert('Deposit initiated successfully!');
        }
        
        closeDepositModal();
        loadWalletData();
        loadTransactions();
        
    } catch (error) {
        console.error('Deposit error:', error);
        alert(`Deposit failed: ${error.message}`);
    }
}

// Handle withdraw
async function handleWithdraw(event) {
    event.preventDefault();
    
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const provider = document.getElementById('withdrawProvider').value;
    
    // Validate amount
    if (amount > parseFloat(walletData.available_balance)) {
        alert('Insufficient balance');
        return;
    }
    
    const withdrawData = {
        amount: amount,
        currency: walletData.currency,
        provider: provider
    };
    
    // Add provider-specific fields
    if (['mtn', 'airtel', 'mpesa'].includes(provider)) {
        const phone = document.getElementById('withdrawPhone').value;
        if (!phone) {
            alert('Please enter phone number');
            return;
        }
        withdrawData.phone_number = phone;
    } else if (provider === 'bank') {
        const account = document.getElementById('withdrawBank').value;
        if (!account) {
            alert('Please enter bank account number');
            return;
        }
        withdrawData.bank_account = account;
    } else if (provider === 'paypal') {
        const email = document.getElementById('withdrawPaypal').value;
        if (!email) {
            alert('Please enter PayPal email');
            return;
        }
        withdrawData.paypal_email = email;
    }
    
    try {
        const token = localStorage.getItem('djangoAuthToken');
        const response = await fetch(`${API_BASE_URL}/payments/wallet/withdraw/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(withdrawData)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Withdrawal failed');
        }
        
        alert(`✅ Withdrawal request submitted!\n\nAmount: K${amount}\nMethod: ${provider}\n\nYour funds will be processed shortly.`);
        
        closeWithdrawModal();
        loadWalletData();
        loadTransactions();
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        alert(`Withdrawal failed: ${error.message}`);
    }
}

// Close modals when clicking outside
window.onclick = function(event) {
    const depositModal = document.getElementById('depositModal');
    const withdrawModal = document.getElementById('withdrawModal');
    
    if (event.target === depositModal) {
        closeDepositModal();
    }
    if (event.target === withdrawModal) {
        closeWithdrawModal();
    }
}
