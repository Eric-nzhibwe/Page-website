"""
Payment serializers for ARTX Platform
"""
from rest_framework import serializers
from .models import Payment, PaymentAllocation, Withdrawal, PaymentMethod, Wallet, Transaction


class PaymentSerializer(serializers.ModelSerializer):
    """Payment serializer"""
    
    class Meta:
        model = Payment
        fields = [
            'id', 'provider', 'amount', 'currency', 'status',
            'description', 'transaction_reference', 'created_at',
            'completed_at'
        ]
        read_only_fields = ['id', 'created_at', 'completed_at']


class PaymentAllocationSerializer(serializers.ModelSerializer):
    """Payment allocation serializer"""
    
    class Meta:
        model = PaymentAllocation
        fields = [
            'escrow_amount', 'prize_pool_amount', 'platform_fee'
        ]


class WithdrawalSerializer(serializers.ModelSerializer):
    """Withdrawal serializer"""
    
    class Meta:
        model = Withdrawal
        fields = [
            'id', 'amount', 'currency', 'provider', 'status',
            'phone_number', 'bank_account', 'paypal_email',
            'transaction_id', 'created_at', 'completed_at'
        ]
        read_only_fields = ['id', 'transaction_id', 'created_at', 'completed_at']


class PaymentMethodSerializer(serializers.ModelSerializer):
    """Payment method serializer"""
    
    class Meta:
        model = PaymentMethod
        fields = [
            'id', 'method_type', 'provider', 'card_last_four',
            'card_brand', 'phone_number', 'is_default', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class PaymentInitiateSerializer(serializers.Serializer):
    """Payment initiation serializer"""
    provider = serializers.ChoiceField(choices=Payment.PROVIDER_CHOICES)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    
    # PawaPay mobile money fields
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    correspondent = serializers.CharField(max_length=50, required=False, allow_blank=True)
    
    def validate(self, data):
        """Validate PawaPay requires phone_number and correspondent"""
        if data['provider'] == 'pawapay':
            if not data.get('phone_number'):
                raise serializers.ValidationError("Phone number is required for PawaPay payments")
            if not data.get('correspondent'):
                raise serializers.ValidationError("Correspondent (e.g., MTN_MOMO_ZMB) is required for PawaPay payments")
        return data


class WithdrawalRequestSerializer(serializers.Serializer):
    """Withdrawal request serializer"""
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    provider = serializers.ChoiceField(choices=Withdrawal.PROVIDER_CHOICES)
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    bank_account = serializers.CharField(max_length=50, required=False, allow_blank=True)
    paypal_email = serializers.EmailField(required=False, allow_blank=True)
    
    def validate(self, data):
        provider = data['provider']
        
        if provider in ['airtel', 'mtn', 'mpesa'] and not data.get('phone_number'):
            raise serializers.ValidationError("Phone number is required for mobile money withdrawals")
        
        if provider == 'bank' and not data.get('bank_account'):
            raise serializers.ValidationError("Bank account is required for bank withdrawals")
        
        if provider == 'paypal' and not data.get('paypal_email'):
            raise serializers.ValidationError("PayPal email is required for PayPal withdrawals")
        
        return data



class WalletSerializer(serializers.ModelSerializer):
    """Wallet serializer"""
    total_balance = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    
    class Meta:
        model = Wallet
        fields = [
            'id', 'available_balance', 'pending_balance', 'total_balance',
            'total_deposited', 'total_withdrawn', 'total_earned',
            'currency', 'is_active', 'is_locked', 'lock_reason',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'total_balance', 'created_at', 'updated_at']


class TransactionSerializer(serializers.ModelSerializer):
    """Transaction serializer"""
    
    class Meta:
        model = Transaction
        fields = [
            'id', 'transaction_type', 'amount', 'balance_after',
            'description', 'metadata', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class DepositSerializer(serializers.Serializer):
    """Deposit request serializer"""
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    provider = serializers.ChoiceField(choices=Payment.PROVIDER_CHOICES)
    
    # PawaPay fields
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    correspondent = serializers.CharField(max_length=50, required=False, allow_blank=True)
    
    def validate(self, data):
        """Validate deposit request"""
        if data['provider'] == 'pawapay':
            if not data.get('phone_number'):
                raise serializers.ValidationError("Phone number is required for PawaPay deposits")
            if not data.get('correspondent'):
                raise serializers.ValidationError("Correspondent is required for PawaPay deposits")
        return data
