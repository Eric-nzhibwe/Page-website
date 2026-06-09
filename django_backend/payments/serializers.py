"""
Payment serializers — ARTX Platform
"""
from rest_framework import serializers
from .models import Payment, PaymentAllocation, Withdrawal, PaymentMethod, Wallet, Transaction, PaymentAuditLog


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Payment
        fields = ['id', 'provider', 'amount', 'currency', 'status',
                  'description', 'transaction_reference', 'created_at', 'completed_at']
        read_only_fields = fields


class PaymentStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Payment
        fields = ['id', 'status', 'amount', 'currency', 'provider',
                  'transaction_reference', 'created_at', 'completed_at']
        read_only_fields = fields


class PaymentAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PaymentAllocation
        fields = ['escrow_amount', 'prize_pool_amount', 'platform_fee']


class WithdrawalSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Withdrawal
        fields = ['id', 'amount', 'currency', 'provider', 'status',
                  'phone_number', 'bank_account', 'paypal_email',
                  'transaction_id', 'created_at', 'completed_at']
        read_only_fields = ['id', 'transaction_id', 'created_at', 'completed_at']


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PaymentMethod
        fields = ['id', 'method_type', 'provider', 'card_last_four',
                  'card_brand', 'phone_number', 'is_default', 'created_at']
        read_only_fields = ['id', 'created_at']


class WalletSerializer(serializers.ModelSerializer):
    total_balance = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    class Meta:
        model  = Wallet
        fields = ['id', 'available_balance', 'pending_balance', 'total_balance',
                  'total_deposited', 'total_withdrawn', 'total_earned',
                  'currency', 'is_active', 'is_locked', 'lock_reason',
                  'created_at', 'updated_at']
        read_only_fields = fields


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transaction
        fields = ['id', 'transaction_type', 'amount', 'balance_after',
                  'description', 'metadata', 'created_at']
        read_only_fields = fields


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PaymentAuditLog
        fields = ['id', 'action', 'previous_status', 'new_status',
                  'amount', 'currency', 'provider', 'note', 'metadata', 'created_at']
        read_only_fields = fields


# ── Input serializers ─────────────────────────────────────────────────────────

class DepositSerializer(serializers.Serializer):
    provider      = serializers.ChoiceField(choices=Payment.PROVIDER_CHOICES)
    amount        = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency      = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    phone_number  = serializers.CharField(max_length=20, required=False, allow_blank=True)
    correspondent = serializers.CharField(max_length=50, required=False, allow_blank=True)

    def validate(self, data):
        if data['provider'] == 'pawapay':
            if not data.get('phone_number'):
                raise serializers.ValidationError(
                    {'phone_number': 'Phone number is required for mobile money deposits.'})
            if not data.get('correspondent'):
                raise serializers.ValidationError(
                    {'correspondent': 'Correspondent is required (e.g. MTN_MOMO_ZMB).'})
        return data


class WithdrawalRequestSerializer(serializers.Serializer):
    provider      = serializers.ChoiceField(choices=Withdrawal.PROVIDER_CHOICES)
    amount        = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency      = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    phone_number  = serializers.CharField(max_length=20,  required=False, allow_blank=True)
    correspondent = serializers.CharField(max_length=50,  required=False, allow_blank=True)
    bank_account  = serializers.CharField(max_length=100, required=False, allow_blank=True)
    paypal_email  = serializers.EmailField(required=False, allow_blank=True)

    def validate(self, data):
        provider = data['provider']
        if provider in ('airtel', 'mtn', 'mpesa') and not data.get('phone_number'):
            raise serializers.ValidationError(
                {'phone_number': 'Phone number is required for mobile money withdrawals.'})
        if provider == 'bank' and not data.get('bank_account'):
            raise serializers.ValidationError(
                {'bank_account': 'Bank account is required for bank withdrawals.'})
        if provider == 'paypal' and not data.get('paypal_email'):
            raise serializers.ValidationError(
                {'paypal_email': 'PayPal email is required for PayPal withdrawals.'})
        return data


class PaymentInitiateSerializer(serializers.Serializer):
    """Legacy — kept for backwards compatibility."""
    provider      = serializers.ChoiceField(choices=Payment.PROVIDER_CHOICES)
    amount        = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0.01)
    currency      = serializers.ChoiceField(choices=Payment.CURRENCY_CHOICES, default='ZMW')
    phone_number  = serializers.CharField(max_length=20, required=False, allow_blank=True)
    correspondent = serializers.CharField(max_length=50, required=False, allow_blank=True)
