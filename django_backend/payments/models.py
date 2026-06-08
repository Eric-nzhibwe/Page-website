"""
Payment models for ARTX Platform
"""
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone
from decimal import Decimal


class Payment(models.Model):
    """Payment transactions"""
    
    PROVIDER_CHOICES = [
        ('stripe', 'Stripe'),
        ('paystack', 'Paystack'),
        ('tingg', 'Tingg/Cellulant'),
        ('lemonsqueezy', 'Lemonsqueezy'),
        ('paypal', 'PayPal'),
        ('pawapay', 'PawaPay'),
    ]
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
        ('refunded', 'Refunded'),
    ]
    
    CURRENCY_CHOICES = [
        ('USD', 'US Dollar'),
        ('KES', 'Kenyan Shilling'),
        ('UGX', 'Ugandan Shilling'),
        ('TZS', 'Tanzanian Shilling'),
        ('ZMW', 'Zambian Kwacha'),
        ('GHS', 'Ghanaian Cedi'),
        ('NGN', 'Nigerian Naira'),
        ('ZAR', 'South African Rand'),
    ]
    
    # Basic payment info
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payments')
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='ZMW')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Provider-specific IDs
    payment_intent_id = models.CharField(max_length=255, blank=True)  # Stripe payment intent
    transaction_reference = models.CharField(max_length=255, blank=True)  # Provider reference
    external_id = models.CharField(max_length=255, blank=True)  # External transaction ID
    
    # Payment details
    description = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    
    # URLs
    success_url = models.URLField(blank=True)
    cancel_url = models.URLField(blank=True)
    webhook_url = models.URLField(blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'payments'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['provider', 'status']),
            models.Index(fields=['transaction_reference']),
        ]
    
    def __str__(self):
        return f"{self.user.username}: {self.amount} {self.currency} ({self.status})"
    
    @property
    def is_successful(self):
        return self.status == 'completed'
    
    def mark_completed(self):
        """Mark payment as completed and update user earnings (idempotent)"""
        from django.db import transaction as db_transaction
        
        with db_transaction.atomic():
            # Lock the payment row to prevent concurrent updates
            payment = Payment.objects.select_for_update().get(id=self.id)
            
            if payment.status == 'completed':
                # Already completed, skip to prevent double processing
                return False
            
            from django.utils import timezone
            payment.status = 'completed'
            payment.completed_at = timezone.now()
            payment.save()
            
            # Create user activity
            try:
                from users.models import UserActivity
                UserActivity.objects.create(
                    user=payment.user,
                    activity_type='payment_made',
                    description=f"Payment completed: {payment.amount} {payment.currency}",
                    metadata={
                        'payment_id': payment.id,
                        'provider': payment.provider,
                        'amount': str(payment.amount),
                        'currency': payment.currency
                    }
                )
            except Exception:
                pass  # Don't fail payment if activity logging fails
            
            return True


class PaymentAllocation(models.Model):
    """Payment allocation breakdown"""
    
    payment = models.OneToOneField(Payment, on_delete=models.CASCADE, related_name='allocation')
    escrow_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    prize_pool_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    platform_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'payment_allocations'
    
    def __str__(self):
        return f"Allocation for Payment {self.payment.id}"
    
    def save(self, *args, **kwargs):
        """Auto-calculate allocation if not set"""
        if not self.escrow_amount and not self.prize_pool_amount and not self.platform_fee:
            total = self.payment.amount
            self.escrow_amount = total * Decimal('0.70')  # 70% to escrow
            self.prize_pool_amount = total * Decimal('0.20')  # 20% to prize pool
            self.platform_fee = total * Decimal('0.10')  # 10% platform fee
        
        super().save(*args, **kwargs)


class Withdrawal(models.Model):
    """Withdrawal requests"""
    
    PROVIDER_CHOICES = [
        ('airtel', 'Airtel Money'),
        ('mtn', 'MTN Mobile Money'),
        ('mpesa', 'M-Pesa'),
        ('bank', 'Bank Transfer'),
        ('paypal', 'PayPal'),
    ]
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
    ]
    
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='withdrawals')
    amount = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    currency = models.CharField(max_length=3, choices=Payment.CURRENCY_CHOICES, default='ZMW')
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Recipient details
    phone_number = models.CharField(max_length=20, blank=True)
    bank_account = models.CharField(max_length=50, blank=True)
    paypal_email = models.EmailField(blank=True)
    
    # Provider response
    transaction_id = models.CharField(max_length=255, blank=True)
    provider_response = models.JSONField(default=dict, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'withdrawals'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['provider', 'status']),
        ]
    
    def __str__(self):
        return f"{self.user.username}: -{self.amount} {self.currency} ({self.status})"
    
    def mark_completed(self):
        """Mark withdrawal as completed"""
        if self.status != 'completed':
            from django.utils import timezone
            self.status = 'completed'
            self.completed_at = timezone.now()
            self.save()
            
            # Deduct from user earnings
            self.user.total_earnings -= self.amount
            self.user.save()
            
            # Create user activity
            from users.models import UserActivity
            UserActivity.objects.create(
                user=self.user,
                activity_type='withdrawal_request',
                description=f"Withdrawal completed: {self.amount} {self.currency}",
                metadata={
                    'withdrawal_id': self.id,
                    'provider': self.provider,
                    'amount': str(self.amount),
                    'currency': self.currency
                }
            )


class PaymentMethod(models.Model):
    """Saved payment methods for users"""
    
    METHOD_TYPES = [
        ('card', 'Credit/Debit Card'),
        ('mobile_money', 'Mobile Money'),
        ('bank_account', 'Bank Account'),
    ]
    
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payment_methods')
    method_type = models.CharField(max_length=20, choices=METHOD_TYPES)
    provider = models.CharField(max_length=20)
    
    # Card details (encrypted/tokenized)
    card_last_four = models.CharField(max_length=4, blank=True)
    card_brand = models.CharField(max_length=20, blank=True)
    card_exp_month = models.IntegerField(null=True, blank=True)
    card_exp_year = models.IntegerField(null=True, blank=True)
    
    # Mobile money details
    phone_number = models.CharField(max_length=20, blank=True)
    
    # Provider tokens
    provider_token = models.CharField(max_length=255, blank=True)
    
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'payment_methods'
        ordering = ['-is_default', '-created_at']
    
    def __str__(self):
        if self.method_type == 'card':
            return f"{self.card_brand} ****{self.card_last_four}"
        elif self.method_type == 'mobile_money':
            return f"{self.provider} {self.phone_number}"
        else:
            return f"{self.provider} {self.method_type}"


class Wallet(models.Model):
    """User wallet for managing funds"""
    
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='wallet')
    
    # Balance fields
    available_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal('0.00'))])
    pending_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal('0.00'))])
    total_deposited = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal('0.00'))])
    total_withdrawn = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal('0.00'))])
    total_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(Decimal('0.00'))])
    
    # Currency
    currency = models.CharField(max_length=3, choices=Payment.CURRENCY_CHOICES, default='ZMW')
    
    # Status
    is_active = models.BooleanField(default=True)
    is_locked = models.BooleanField(default=False)
    lock_reason = models.CharField(max_length=255, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'wallets'
    
    def __str__(self):
        return f"{self.user.username}'s Wallet: {self.available_balance} {self.currency}"
    
    @property
    def total_balance(self):
        """Total balance including pending"""
        return self.available_balance + self.pending_balance
    
    def add_funds(self, amount, transaction_type='deposit', description='', metadata=None):
        """Add funds to wallet with atomic balance update"""
        from django.db import transaction as db_transaction
        from django.db.models import F
        
        if amount <= 0:
            raise ValueError("Amount must be positive")
        
        amount_decimal = Decimal(str(amount))
        
        with db_transaction.atomic():
            # Use F() expressions for atomic updates
            Wallet.objects.filter(id=self.id).update(
                available_balance=F('available_balance') + amount_decimal,
                total_deposited=F('total_deposited') + amount_decimal if transaction_type == 'deposit' else F('total_deposited'),
                total_earned=F('total_earned') + amount_decimal if transaction_type == 'earning' else F('total_earned')
            )
            
            # Refresh from database to get updated values
            self.refresh_from_db()
            
            # Create transaction record
            Transaction.objects.create(
                wallet=self,
                transaction_type=transaction_type,
                amount=amount_decimal,
                balance_after=self.available_balance,
                description=description,
                metadata=metadata or {}
            )
    
    def deduct_funds(self, amount, transaction_type='withdrawal', description='', metadata=None):
        """Deduct funds from wallet with atomic balance update"""
        from django.db import transaction as db_transaction
        from django.db.models import F
        
        if amount <= 0:
            raise ValueError("Amount must be positive")
        
        amount_decimal = Decimal(str(amount))
        
        with db_transaction.atomic():
            # Lock the row and check balance
            wallet = Wallet.objects.select_for_update().get(id=self.id)
            
            if wallet.available_balance < amount_decimal:
                raise ValueError("Insufficient balance")
            
            # Use F() expressions for atomic updates
            Wallet.objects.filter(id=self.id).update(
                available_balance=F('available_balance') - amount_decimal,
                total_withdrawn=F('total_withdrawn') + amount_decimal if transaction_type == 'withdrawal' else F('total_withdrawn')
            )
            
            # Refresh from database to get updated values
            self.refresh_from_db()
            
            # Create transaction record
            Transaction.objects.create(
                wallet=self,
                transaction_type=transaction_type,
                amount=-amount_decimal,
                balance_after=self.available_balance,
                description=description,
                metadata=metadata or {}
            )
    
    def lock_wallet(self, reason=''):
        """Lock wallet to prevent transactions"""
        self.is_locked = True
        self.lock_reason = reason
        self.save()
    
    def unlock_wallet(self):
        """Unlock wallet"""
        self.is_locked = False
        self.lock_reason = ''
        self.save()


class Transaction(models.Model):
    """Transaction history for wallet"""
    
    TRANSACTION_TYPES = [
        ('deposit', 'Deposit'),
        ('withdrawal', 'Withdrawal'),
        ('earning', 'Game Earning'),
        ('payment', 'Payment'),
        ('refund', 'Refund'),
        ('bonus', 'Bonus'),
        ('fee', 'Fee'),
        ('transfer', 'Transfer'),
    ]
    
    wallet = models.ForeignKey(Wallet, on_delete=models.CASCADE, related_name='transactions')
    transaction_type = models.CharField(max_length=20, choices=TRANSACTION_TYPES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.CharField(max_length=255)
    
    # Related records
    payment = models.ForeignKey(Payment, on_delete=models.SET_NULL, null=True, blank=True, related_name='wallet_transactions')
    withdrawal = models.ForeignKey(Withdrawal, on_delete=models.SET_NULL, null=True, blank=True, related_name='wallet_transactions')
    
    # Metadata
    metadata = models.JSONField(default=dict, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'transactions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['wallet', '-created_at']),
            models.Index(fields=['transaction_type']),
        ]
    
    def __str__(self):
        sign = '+' if self.amount >= 0 else ''
        return f"{self.wallet.user.username}: {sign}{self.amount} {self.wallet.currency} ({self.transaction_type})"