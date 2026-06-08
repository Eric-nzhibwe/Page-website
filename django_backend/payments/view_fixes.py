"""
Key fixes for payments/views.py - Apply these changes

FIX #3: Withdrawal Balance Check (Line 374)
Current (WRONG):
    if user.total_earnings < amount:
        
Fixed (RIGHT):
    wallet = Wallet.objects.get(user=user)
    if wallet.available_balance < amount:

FIX #4: Transaction History QuerySet (Lines 898-907)
Current (WRONG):
    transactions = transactions[:limit]
    return Response({
        'transactions': TransactionSerializer(transactions, many=True).data,
        'count': transactions.count()  # ❌ CRASHES - list has no .count()
    })

Fixed (RIGHT):
    count = transactions.count()
    transactions = list(transactions[:limit])
    return Response({
        'transactions': TransactionSerializer(transactions, many=True).data,
        'count': count
    })

FIX #5: Currency Default (Line 989)
Current (WRONG):
    currency = serializer.validated_data.get('currency', 'USD')
    
Fixed (RIGHT):
    currency = serializer.validated_data.get('currency', 'ZMW')

FIX #6: Redundant Webhook Check (Line 747)
Current (WRONG):
    if deposit_id:
        if not deposit_id:  # ❌ IMPOSSIBLE - already checked above!
            logger.error("PawaPay webhook missing depositId")
            return HttpResponse(status=400)

Fixed (RIGHT):
    if deposit_id:
        try:
            with db_transaction.atomic():
                # Remove the redundant check - deposit_id definitely exists here
                payment = Payment.objects.select_for_update().get(transaction_reference=deposit_id)
                # ... rest of code

"""

# Below are the actual corrected function implementations

from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.db import transaction as db_transaction
from django.utils import timezone
from decimal import Decimal
import logging

from .models import Payment, Wallet, Withdrawal, Transaction
from .serializers import WithdrawalRequestSerializer, WalletSerializer, TransactionSerializer

logger = logging.getLogger(__name__)


# FIX #3: Corrected request_withdrawal_view
@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def request_withdrawal_view_FIXED(request):
    """Request withdrawal - FIXED VERSION"""
    serializer = WithdrawalRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    user = request.user
    amount = serializer.validated_data['amount']
    
    # FIX: Check wallet balance, not user.total_earnings
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
    
    # FIX: Check WALLET balance, not user.total_earnings
    if wallet.available_balance < amount:
        return Response({
            'error': f'Insufficient balance. Available: {wallet.available_balance} {wallet.currency}'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Create withdrawal request
    withdrawal = Withdrawal.objects.create(
        user=user,
        amount=amount,
        currency=serializer.validated_data.get('currency', wallet.currency),
        provider=serializer.validated_data['provider'],
        phone_number=serializer.validated_data.get('phone_number', ''),
        bank_account=serializer.validated_data.get('bank_account', ''),
        paypal_email=serializer.validated_data.get('paypal_email', '')
    )
    
    return Response({
        'withdrawal': WithdrawalSerializer(withdrawal).data,
        'message': 'Withdrawal request submitted successfully'
    })


# FIX #4: Corrected transaction_history_view
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def transaction_history_view_FIXED(request):
    """Get user transaction history - FIXED VERSION"""
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Get query parameters
    transaction_type = request.query_params.get('type', None)
    limit = int(request.query_params.get('limit', 50))
    
    # Filter transactions (keep as QuerySet)
    transactions = wallet.transactions.all()
    if transaction_type:
        transactions = transactions.filter(transaction_type=transaction_type)
    
    # FIX: Get count BEFORE slicing
    count = transactions.count()
    
    # FIX: Slice AFTER getting count
    transactions = list(transactions[:limit])
    
    return Response({
        'transactions': TransactionSerializer(transactions, many=True).data,
        'count': count
    })


# FIX #5 & #7: Corrected deposit_funds_view
@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def deposit_funds_view_FIXED(request):
    """
    Deposit funds to wallet - FIXED VERSION
    Fixes:
    - FIX #5: Currency default changed from USD to ZMW
    - FIX #7: Better wallet crediting
    """
    from .models import Payment
    from .serializers import DepositSerializer
    
    # Log authentication status
    logger.info(f"Deposit request from user: {request.user.id if request.user.is_authenticated else 'Anonymous'}")
    
    # Validate
    serializer = DepositSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except Exception as exc:
        logger.warning(f"Wallet deposit validation failed for user {request.user.id}: {exc}")
        return Response({
            'error': 'Invalid deposit request',
            'details': exc.detail if hasattr(exc, 'detail') else str(exc)
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Get or create wallet
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Check if wallet is locked
    if wallet.is_locked:
        return Response({
            'error': f'Wallet is locked: {wallet.lock_reason}'
        }, status=status.HTTP_403_FORBIDDEN)
    
    provider = serializer.validated_data['provider']
    amount = serializer.validated_data['amount']
    # FIX #5: Default to ZMW, not USD
    currency = serializer.validated_data.get('currency', 'ZMW')
    
    # Create payment record with wallet metadata
    payment = Payment.objects.create(
        user=request.user,
        provider=provider,
        amount=amount,
        currency=currency,
        description=f"Wallet Deposit - {amount} {currency}",
        metadata={
            'deposit_type': 'wallet',
            'wallet_id': wallet.id
        }
    )
    
    # FIX #7: Store payment ID for later wallet crediting
    logger.info(f"Created payment {payment.id} for wallet deposit by user {request.user.id}")
    
    return Response({
        'payment_id': payment.id,
        'status': 'pending',
        'message': f'Deposit of {amount} {currency} initiated. Please complete payment.'
    })
