# Deposit & Withdrawal System - Implementation Checklist

## ✅ Files Already Fixed & Committed

- [x] `django_backend/payments/urls.py` - Fixed import issues
- [x] `django_backend/artx_platform/settings.py` - Fixed API key defaults, CORS, logging
- [x] `django_backend/.env.example` - Updated with proper documentation

## 📋 Manual Changes Required

These fixes need to be manually applied to `django_backend/payments/views.py`:

### FIX #1: Withdrawal Balance Check (Line ~374)
```python
# FIND THIS:
if user.total_earnings < amount:
    return Response({
        'error': 'Insufficient balance for withdrawal'
    }, status=status.HTTP_400_BAD_REQUEST)

# REPLACE WITH:
try:
    wallet = Wallet.objects.get(user=user)
except Wallet.DoesNotExist:
    return Response({
        'error': 'Wallet not found. Please deposit funds first.'
    }, status=status.HTTP_404_NOT_FOUND)

if wallet.is_locked:
    return Response({
        'error': f'Wallet is locked: {wallet.lock_reason}'
    }, status=status.HTTP_403_FORBIDDEN)

if wallet.available_balance < amount:
    return Response({
        'error': f'Insufficient balance. Available: {wallet.available_balance} {wallet.currency}'
    }, status=status.HTTP_400_BAD_REQUEST)
```

### FIX #2: Transaction History QuerySet (Lines ~898-907)
```python
# FIND THIS:
transactions = wallet.transactions.all()
if transaction_type:
    transactions = transactions.filter(transaction_type=transaction_type)

transactions = transactions[:limit]

return Response({
    'transactions': TransactionSerializer(transactions, many=True).data,
    'count': transactions.count()
})

# REPLACE WITH:
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

### FIX #3: Currency Default (Line ~989)
```python
# FIND THIS:
currency = serializer.validated_data.get('currency', 'USD')

# REPLACE WITH:
currency = serializer.validated_data.get('currency', 'ZMW')
```

### FIX #4: Redundant Webhook Check (Line ~747)
```python
# FIND THIS:
if deposit_id:
    if not deposit_id:
        logger.error("PawaPay webhook missing depositId")
        return HttpResponse(status=400)

# REPLACE WITH:
if deposit_id:
    # Remove the redundant check - deposit_id definitely exists here
```

### FIX #5: Incomplete Wallet Crediting (Line ~509)
```python
# FIND THIS:
def credit_wallet_from_payment(payment):
    try:
        # Check if this is a wallet deposit
        if payment.metadata.get('deposit_type') == 'wallet':
            wallet_id = payment.metadata.get('wallet_id')
            # ... only credits wallet deposits
        return False

# REPLACE WITH:
def credit_wallet_from_payment(payment):
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

## 🔧 Environment Setup

### Step 1: Create `.env` file
```bash
cp django_backend/.env.example django_backend/.env
```

### Step 2: Get API Keys
1. **Stripe:** https://dashboard.stripe.com/apikeys
2. **Paystack:** https://dashboard.paystack.com/settings/developer
3. **PawaPay:** Your PawaPay merchant dashboard
4. **OpenAI:** https://platform.openai.com/api-keys (GET NEW ONE - OLD ONE IS EXPOSED)

### Step 3: Update `.env` with Real Keys
```bash
# Open django_backend/.env and update:
STRIPE_PUBLISHABLE_KEY=your_real_key
STRIPE_SECRET_KEY=your_real_key
STRIPE_WEBHOOK_SECRET=your_real_secret
# ... etc for all providers
```

⚠️ **NEVER COMMIT `.env` FILE!** It's in `.gitignore` for a reason.

## 🧪 Testing

### Before Testing
```bash
cd django_backend

# Check for errors
python manage.py check

# Run migrations (if any changes)
python manage.py migrate
```

### Test Wallet Operations
```bash
# Start server
python manage.py runserver
```

### Test Endpoints (via API client like Postman or curl)

**1. Get Wallet Balance**
```bash
curl -X GET http://localhost:8000/api/payments/wallet/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**2. View Transaction History**
```bash
curl -X GET http://localhost:8000/api/payments/wallet/transactions/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**3. Initiate Deposit**
```bash
curl -X POST http://localhost:8000/api/payments/wallet/deposit/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "100.00",
    "currency": "ZMW",
    "provider": "pawapay",
    "phone_number": "+260977123456",
    "correspondent": "MTN_MOMO_ZMB"
  }'
```

**4. Initiate Withdrawal**
```bash
curl -X POST http://localhost:8000/api/payments/wallet/withdraw/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "50.00",
    "currency": "ZMW",
    "provider": "mtn",
    "phone_number": "+260977123456"
  }'
```

## ✅ Verification Checklist

- [ ] `python manage.py check` passes with no errors
- [ ] Database migrations run successfully
- [ ] All payment provider API keys added to `.env`
- [ ] `.env` file is in `.gitignore` (should be by default)
- [ ] Frontend loads wallet page without 404s
- [ ] Can view wallet balance without errors
- [ ] Can view transaction history without crashing
- [ ] Deposit endpoint accepts requests (creates Payment record)
- [ ] Withdrawal endpoint accepts requests (with sufficient balance)
- [ ] Webhook endpoints respond to POST requests
- [ ] No console errors in browser dev tools
- [ ] No Django errors in server logs
- [ ] OpenAI API key has been revoked (OLD KEY IS EXPOSED)

## 🚀 Deployment

When deploying to production (Render/Railway):

1. Add all environment variables to your hosting platform's environment settings
2. Set `DEBUG=False`
3. Set production `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`
4. Ensure database migrations run during deployment
5. Test all payment flows in production environment

## 📞 Support

If you encounter issues:

1. Check logs: `django_backend/logs/artx.log`
2. Run `python manage.py check` for Django errors
3. Verify all `.env` variables are set correctly
4. Test API endpoints individually
5. Check payment provider dashboards for webhook events

---

**Last Updated:** 2026-05-15
**Status:** Ready for implementation
