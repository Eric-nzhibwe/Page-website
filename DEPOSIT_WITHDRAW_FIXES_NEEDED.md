# Complete Deposit & Withdrawal System - All Fixes Needed

## 🔴 **CRITICAL ISSUES (System Won't Work)**

### **1. SYNTAX ERROR: payments/urls.py**
**Status:** 🔴 CRITICAL - Will crash on startup

**File:** `django_backend/payments/urls.py` (Lines 17-34)

**Problem:** References `views.` prefix on functions that aren't imported
```python
# WRONG:
path('history/', views.payment_history_view, ...)  # ❌ 'views' not imported
path('initiate/', views.initiate_payment_view, ...)  # ❌ NOT imported
```

**Fix:**
```python
# django_backend/payments/urls.py
from django.urls import path
from . import views  # ADD THIS LINE
from .views import (
    wallet_balance_view,
    deposit_funds_view,
    withdraw_funds_view,
    transaction_history_view,
    PaymentHistoryView,
    WithdrawalHistoryView
)

app_name = 'payments'

urlpatterns = [
    # Payment endpoints
    path('history/', PaymentHistoryView.as_view(), name='payment_history'),
    path('initiate/', views.initiate_payment_view, name='initiate_payment'),
    
    # Withdrawal endpoints
    path('withdrawals/', WithdrawalHistoryView.as_view(), name='withdrawal_history'),
    path('withdraw/', views.request_withdrawal_view, name='request_withdrawal'),
    
    # Wallet endpoints
    path('wallet/', wallet_balance_view, name='wallet_balance'),
    path('wallet/transactions/', transaction_history_view, name='transaction_history'),
    path('wallet/deposit/', deposit_funds_view, name='deposit_funds'),
    path('wallet/withdraw/', withdraw_funds_view, name='withdraw_funds'),
    path('wallet/add-earnings/', views.add_game_earnings_view, name='add_earnings'),
    path('paystack/callback/', views.paystack_callback_view, name='paystack_callback'),
    
    # Webhook endpoints
    path('webhooks/stripe/', views.stripe_webhook_view, name='stripe_webhook'),
    path('webhooks/paystack/', views.paystack_webhook_view, name='paystack_webhook'),
    path('webhooks/tingg/', views.tingg_webhook, name='tingg_webhook'),
    path('webhooks/lemonsqueezy/', views.lemonsqueezy_webhook, name='lemonsqueezy_webhook'),
    path('webhooks/pawapay/', views.pawapay_webhook, name='pawapay_webhook'),
]
```

---

### **2. MISSING CONFIGURATION: Payment Provider API Keys**
**Status:** 🔴 CRITICAL - All payments will fail

**Files:** 
- `django_backend/.env`
- `django_backend/artx_platform/settings.py` (Lines 210-214)

**Problem:** Settings file has placeholder API keys that will fail in production
```python
PAWAPAY_API_KEY = config('PAWAPAY_API_KEY', default='eyJraWQiOiIx...')  # ❌ FAKE KEY
OPENAI_API_KEY = config('OPENAI_API_KEY', default='sk-proj-win9drRopZs...')  # ❌ EXPOSED!
```

**Fix - Create/Update `.env` file with real values:**
```env
# Payment Provider Keys (GET FROM YOUR PROVIDER DASHBOARDS)
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_ACTUAL_SECRET

PAYSTACK_PUBLIC_KEY=pk_test_YOUR_ACTUAL_KEY
PAYSTACK_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY

PAWAPAY_API_KEY=YOUR_ACTUAL_PAWAPAY_JWT_TOKEN
PAWAPAY_API_URL=https://api.pawapay.cloud
PAWAPAY_WEBHOOK_SECRET=your_webhook_secret_from_pawapay

# OpenAI (REMOVE FROM REPO - USE .env ONLY!)
OPENAI_API_KEY=sk-proj-YOUR_NEW_KEY_HERE_NOT_EXPOSED
```

**⚠️ SECURITY:** The settings.py file contains exposed OpenAI API keys that must be revoked immediately!

---

### **3. LOGIC ERROR: Withdrawal Balance Check**
**Status:** 🔴 CRITICAL - Withdrawals will always fail

**File:** `django_backend/payments/views.py` (Line 374)

**Problem:** Checking wrong field for balance
```python
def request_withdrawal_view(request):
    # ...
    if user.total_earnings < amount:  # ❌ WRONG - should check wallet.available_balance
        return Response({
            'error': 'Insufficient balance for withdrawal'
        }, status=status.HTTP_400_BAD_REQUEST)
```

**Fix:**
```python
@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def request_withdrawal_view(request):
    """Request withdrawal"""
    serializer = WithdrawalRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    user = request.user
    amount = serializer.validated_data['amount']
    
    # Get wallet and check balance
    try:
        wallet = Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Response({
            'error': 'Wallet not found. Please deposit funds first.'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Check if wallet is locked
    if wallet.is_locked:
        return Response({
            'error': f'Wallet is locked: {wallet.lock_reason}'
        }, status=status.HTTP_403_FORBIDDEN)
    
    # Check balance on WALLET, not user
    if wallet.available_balance < amount:
        return Response({
            'error': f'Insufficient balance. Available: {wallet.available_balance} {wallet.currency}'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # ... rest of the code
```

---

### **4. LOGIC ERROR: Transaction History Queryset Conversion**
**Status:** 🔴 CRITICAL - Transaction list will crash

**File:** `django_backend/payments/views.py` (Lines 898-907)

**Problem:** Slicing queryset converts to list, then calling `.count()` on list fails
```python
transactions = wallet.transactions.all()
if transaction_type:
    transactions = transactions.filter(transaction_type=transaction_type)

transactions = transactions[:limit]  # ❌ Converts to list/tuple

return Response({
    'transactions': TransactionSerializer(transactions, many=True).data,
    'count': transactions.count()  # ❌ CRASHES - list has no .count()
})
```

**Fix:**
```python
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def transaction_history_view(request):
    """Get user transaction history"""
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Get query parameters
    transaction_type = request.query_params.get('type', None)
    limit = int(request.query_params.get('limit', 50))
    
    # Filter transactions (keep as QuerySet)
    transactions = wallet.transactions.all()
    if transaction_type:
        transactions = transactions.filter(transaction_type=transaction_type)
    
    # Get count BEFORE slicing
    count = transactions.count()
    
    # Now slice
    transactions = list(transactions[:limit])
    
    return Response({
        'transactions': TransactionSerializer(transactions, many=True).data,
        'count': count
    })
```

---

### **5. MISSING VIEWS: PaymentHistoryView and WithdrawalHistoryView**
**Status:** 🔴 CRITICAL - URLs reference non-existent classes

**File:** `django_backend/payments/views.py`

**Problem:** `urls.py` references class-based views that don't exist
```python
# In urls.py:
path('history/', PaymentHistoryView.as_view(), name='payment_history'),  # ❌ NOT DEFINED
path('withdrawals/', WithdrawalHistoryView.as_view(), name='withdrawal_history'),  # ❌ NOT DEFINED
```

**Current Code (Lines 29-44):**
```python
class PaymentHistoryView(generics.ListAPIView):  # ✅ EXISTS
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Payment.objects.filter(user=self.request.user)


class WithdrawalHistoryView(generics.ListAPIView):  # ✅ EXISTS
    serializer_class = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Withdrawal.objects.filter(user=self.request.user)
```

**Status:** Actually these DO exist, but they're named with `View` suffix. URLs are trying to use them correctly, so this is fine. The issue is the payments app name spacing.

---

## ⚠️ **HIGH PRIORITY ISSUES**

### **6. INCOMPLETE WEBHOOK PROCESSING: Redundant Check**
**Status:** ⚠️ HIGH - Won't crash but won't work properly

**File:** `django_backend/payments/views.py` (Line 747)

**Problem:** Redundant check that will never execute
```python
if deposit_id:
    if not deposit_id:  # ❌ IMPOSSIBLE - already checked above!
        logger.error("PawaPay webhook missing depositId")
        return HttpResponse(status=400)
```

**Fix:**
```python
if deposit_id:
    # Remove the redundant check - deposit_id exists here
    try:
        with db_transaction.atomic():
            payment = Payment.objects.select_for_update().get(transaction_reference=deposit_id)
            # ... rest of code
```

---

### **7. FRONTEND-BACKEND CURRENCY MISMATCH**
**Status:** ⚠️ HIGH - Deposits may fail with currency errors

**Frontend:** `scripts/wallet.js` (Line 264-266)
```javascript
const validCurrencies = ['USD', 'KES', 'UGX', 'TZS', 'ZMW', 'GHS', 'NGN', 'ZAR'];
const walletCurrency = walletData?.currency || 'ZMW';
const currency = validCurrencies.includes(walletCurrency) ? walletCurrency : 'ZMW';
```

**Backend:** `django_backend/payments/views.py` (Line 989)
```python
currency = serializer.validated_data.get('currency', 'USD')  # ❌ DEFAULTS TO USD, NOT ZMW!
```

**Fix:** Make backend default match frontend
```python
currency = serializer.validated_data.get('currency', 'ZMW')  # Default to ZMW
```

---

### **8. INCOMPLETE DEPOSIT TYPE VALIDATION**
**Status:** ⚠️ HIGH - Non-wallet deposits won't work

**File:** `django_backend/payments/views.py` (Line 509)

**Problem:** Only wallet deposits are credited
```python
def credit_wallet_from_payment(payment):
    # Check if this is a wallet deposit
    if payment.metadata.get('deposit_type') == 'wallet':  # ❌ Only wallets
        # ... credit wallet
    return False  # ❌ Always returns False for non-wallet payments
```

**Fix:** Handle all deposit types
```python
def credit_wallet_from_payment(payment):
    """
    Credit user wallet when payment is completed (idempotent)
    Used for deposits
    """
    from django.db import transaction as db_transaction
    
    try:
        wallet, created = Wallet.objects.get_or_create(user=payment.user)
        
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(id=wallet.id, user=payment.user)
            
            # Check if already credited (idempotency check)
            existing_transaction = Transaction.objects.filter(
                wallet=wallet,
                metadata__payment_id=payment.id,
                transaction_type='deposit'
            ).exists()
            
            if existing_transaction:
                logger.warning(f"Wallet {wallet.id} already credited for payment {payment.id}")
                return True
            
            # Add funds to wallet
            wallet.add_funds(
                amount=payment.amount,
                transaction_type='deposit',
                description=f'Deposit via {payment.provider}',
                metadata={
                    'payment_id': payment.id,
                    'provider': payment.provider
                }
            )
            
            logger.info(f"Credited wallet {wallet.id} with {payment.amount} {payment.currency}")
            return True
        
    except Exception as e:
        logger.error(f"Failed to credit wallet: {str(e)}")
        return False
```

---

### **9. MISSING PAWAPAY_WEBHOOK_SECRET CONFIGURATION**
**Status:** ⚠️ HIGH - Webhook signature verification will fail

**File:** `django_backend/payments/views.py` (Line 727)

**Problem:** Code checks for webhook secret but it might not be set
```python
if hasattr(settings, 'PAWAPAY_WEBHOOK_SECRET') and settings.PAWAPAY_WEBHOOK_SECRET:
    # Verify signature
```

**Settings Missing:** Add to `settings.py`:
```python
# Line 212 (after PAWAPAY_API_URL)
PAWAPAY_WEBHOOK_SECRET = config('PAWAPAY_WEBHOOK_SECRET', default='')
```

**Add to `.env`:**
```env
PAWAPAY_WEBHOOK_SECRET=your_webhook_secret_from_pawapay_dashboard
```

---

### **10. INCOMPLETE WALLET BALANCE SYNC**
**Status:** ⚠️ HIGH - User earnings and wallet balance can diverge

**File:** `django_backend/payments/views.py` (Line 877-879)

**Problem:** One-way sync only
```python
def wallet_balance_view(request):
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Sync with user earnings
    if created or wallet.total_earned != request.user.total_earnings:
        wallet.total_earned = request.user.total_earnings  # ❌ Only syncs one direction
        wallet.save()
```

**Fix:** Two-way sync
```python
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def wallet_balance_view(request):
    """Get user wallet balance"""
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Sync both directions
    if wallet.total_earned != request.user.total_earnings:
        # Use the maximum of both to avoid losing money
        max_earned = max(wallet.total_earned, request.user.total_earnings)
        wallet.total_earned = max_earned
        request.user.total_earnings = max_earned
        wallet.save()
        request.user.save()
    
    return Response({
        'wallet': WalletSerializer(wallet).data,
        'user_earnings': str(request.user.total_earnings)
    })
```

---

## 📋 **MEDIUM PRIORITY ISSUES**

### **11. FRONTEND BUG: Transaction Type Filter Names Mismatch**
**Status:** 📋 MEDIUM - Filtering won't work

**File:** `pages/wallet.html` (Line 66)
```html
<option value="withdrawal">Withdrawals</option>
```

**File:** `django_backend/payments/models.py` (Line 389)
```python
TRANSACTION_TYPES = [
    ('withdrawal', 'Withdrawal'),  # ❌ Singular!
```

**But Frontend Sends:** `'withdrawal'` ✅ This actually matches

**However, check models.py for transaction types:**
```python
('deposit', 'Deposit'),
('withdrawal', 'Withdrawal'),  # Singular in DB
```

**Fix if needed:** Keep consistent (currently OK)

---

### **12. MISSING ENVIRONMENT VARIABLES IN SETTINGS**
**Status:** 📋 MEDIUM - Settings hard-code test values

**File:** `django_backend/artx_platform/settings.py` (Lines 210-214)

**Problem:** Settings has real test keys and incomplete config
```python
PAWAPAY_API_KEY = config('PAWAPAY_API_KEY', default='eyJraWQiOiIx...')  # Has default!
OPENAI_API_KEY = config('OPENAI_API_KEY', default='sk-proj-win9drRopZs...')  # EXPOSED!
```

**Fix:** Add to settings but DON'T include defaults for sensitive keys
```python
# PawaPay Configuration (African Mobile Money)
PAWAPAY_API_KEY = config('PAWAPAY_API_KEY', default='')
PAWAPAY_API_URL = config('PAWAPAY_API_URL', default='https://api.pawapay.cloud')
PAWAPAY_WEBHOOK_SECRET = config('PAWAPAY_WEBHOOK_SECRET', default='')

# OpenAI Configuration
OPENAI_API_KEY = config('OPENAI_API_KEY', default='')
```

---

### **13. CORS CONFIGURATION INCOMPLETE FOR PRODUCTION**
**Status:** 📋 MEDIUM - Deployments to production will have CORS issues

**File:** `django_backend/artx_platform/settings.py` (Lines 168-175)

**Problem:** Only localhost allowed
```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
```

**Fix:** Add environment variable for production domains
```python
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000',
    cast=lambda v: [s.strip() for s in v.split(',')]
)
```

**Add to `.env`:**
```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://yourdomain.com
```

---

### **14. MISSING LOGGING DIRECTORY CREATION IN PRODUCTION**
**Status:** 📋 MEDIUM - Logs might fail in deployed environment

**File:** `django_backend/artx_platform/settings.py` (Line 234)

**Problem:** Creates logs directory, but this runs at import time
```python
LOGGING = {
    'handlers': {
        'file': {
            'filename': BASE_DIR / 'logs' / 'artx.log',
```

**And later:**
```python
os.makedirs(BASE_DIR / 'logs', exist_ok=True)
```

**Fix:** Create with proper permissions
```python
# At the end of settings.py
LOGS_DIR = BASE_DIR / 'logs'
if not LOGS_DIR.exists():
    try:
        LOGS_DIR.mkdir(parents=True, mode=0o755, exist_ok=True)
    except Exception as e:
        import warnings
        warnings.warn(f"Could not create logs directory: {e}")
```

---

## 🧪 **TESTING & VALIDATION ISSUES**

### **15. NO RATE LIMITING IMPLEMENTED**
**Status:** 🧪 TESTING - System is vulnerable to abuse

**Problem:** No rate limiting on deposits despite being mentioned in docs

**Fix:** Add rate limiter middleware
```python
# In settings.py
INSTALLED_APPS += ['django_ratelimit']

# In payments/views.py
from django_ratelimit.decorators import ratelimit

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@ratelimit(key='user', rate='10/h', method='POST')  # 10 deposits per hour
def deposit_funds_view(request):
    # ... existing code
```

---

### **16. NO ERROR HANDLING FOR NETWORK TIMEOUTS**
**Status:** 🧪 TESTING - Can hang on API failures

**File:** `django_backend/payments/views.py` (Line 324)

**Problem:** API calls have 30s timeout but no connection pooling
```python
response = requests.post(url, headers=headers, json=data, timeout=30)
```

**Fix:** Add connection pooling and better error handling
```python
# Add to settings.py
import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

def requests_retry_session(
    retries=3,
    backoff_factor=0.3,
    status_forcelist=(500, 502, 504),
    session=None,
):
    session = session or requests.Session()
    retry = Retry(
        total=retries,
        read=retries,
        connect=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session
```

---

## 📊 **PRIORITY FIX ORDER**

1. **FIRST (Today):** Fix #1 (urls.py syntax)
2. **SECOND (Today):** Fix #2 (API keys in .env)
3. **THIRD (Today):** Fix #3 (Withdrawal balance check)
4. **FOURTH (Today):** Fix #4 (Transaction history)
5. **FIFTH (Today):** Fix #7 (Currency default)
6. **SIXTH (Today):** Fix #9 (Webhook secret)
7. **Later:** Fix #6, #8, #10, #12-16

---

## ✅ **VERIFICATION CHECKLIST**

After applying all fixes:

- [ ] `python manage.py check` - No errors
- [ ] `python manage.py migrate` - All migrations applied
- [ ] Frontend loads wallet page without 404s
- [ ] Can view wallet balance
- [ ] Can initiate deposit (creates Payment record)
- [ ] Can view transaction history
- [ ] Can initiate withdrawal (with sufficient balance)
- [ ] Webhook endpoints respond to POST requests
- [ ] No console errors in browser
- [ ] No Django errors in server logs

