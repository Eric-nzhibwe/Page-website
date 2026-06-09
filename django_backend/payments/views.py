"""
Payment views — ARTX Platform
Views are thin HTTP wrappers. All logic lives in services.py.
"""
import json
import logging
import hmac
import hashlib

import stripe
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from decimal import Decimal

from .models import Payment, PaymentAllocation, Withdrawal, Wallet, Transaction, PaymentAuditLog
from .serializers import (
    PaymentSerializer, WithdrawalSerializer,
    WalletSerializer, TransactionSerializer,
    DepositSerializer, WithdrawalRequestSerializer,
    PaymentInitiateSerializer, PaymentStatusSerializer,
    AuditLogSerializer,
)
from . import services

logger = logging.getLogger(__name__)


# ── History & Status ──────────────────────────────────────────────────────────

class PaymentHistoryView(generics.ListAPIView):
    serializer_class   = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    def get_queryset(self):
        return Payment.objects.filter(user=self.request.user).order_by('-created_at')


class WithdrawalHistoryView(generics.ListAPIView):
    serializer_class   = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]
    def get_queryset(self):
        return Withdrawal.objects.filter(user=self.request.user).order_by('-created_at')


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def payment_status_view(request, payment_id):
    """Poll the status of a specific payment."""
    try:
        payment = Payment.objects.get(id=payment_id, user=request.user)
    except Payment.DoesNotExist:
        return Response({'error': 'Payment not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(PaymentStatusSerializer(payment).data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def withdrawal_status_view(request, withdrawal_id):
    try:
        withdrawal = Withdrawal.objects.get(id=withdrawal_id, user=request.user)
    except Withdrawal.DoesNotExist:
        return Response({'error': 'Withdrawal not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(WithdrawalSerializer(withdrawal).data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def payment_audit_log_view(request, payment_id):
    try:
        payment = Payment.objects.get(id=payment_id, user=request.user)
    except Payment.DoesNotExist:
        return Response({'error': 'Payment not found.'}, status=status.HTTP_404_NOT_FOUND)
    logs = payment.audit_logs.order_by('created_at')
    return Response(AuditLogSerializer(logs, many=True).data)


# ── Deposit ───────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def deposit_funds_view(request):
    """
    Initiate a wallet deposit.
    PawaPay: sends USSD push to phone — user approves with PIN.
    Stripe:  returns client_secret for frontend card confirmation.
    Paystack: returns authorization_url for redirect.
    """
    serializer = DepositSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {'error': 'Invalid request.', 'details': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST
        )

    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    if wallet.is_locked:
        return Response({'error': f'Wallet is locked: {wallet.lock_reason}'},
                        status=status.HTTP_403_FORBIDDEN)

    provider = serializer.validated_data['provider']
    amount   = serializer.validated_data['amount']
    currency = serializer.validated_data.get('currency', 'ZMW')

    payment = Payment.objects.create(
        user=request.user, provider=provider,
        amount=amount, currency=currency,
        description=f'Wallet deposit — {amount} {currency}',
        metadata={'deposit_type': 'wallet', 'wallet_id': wallet.id},
    )
    PaymentAllocation.objects.create(payment=payment)
    PaymentAuditLog.log(
        action='initiated', payment=payment,
        previous_status='', new_status='pending',
        amount=amount, currency=currency, provider=provider,
        ip_address=services._get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:512],
    )

    try:
        if provider == 'stripe':
            data, err = services.initiate_stripe_deposit(payment, request)
        elif provider == 'paystack':
            data, err = services.initiate_paystack_deposit(payment, request)
        elif provider == 'pawapay':
            data, err = services.initiate_pawapay_deposit(
                payment,
                phone_number=serializer.validated_data.get('phone_number', ''),
                correspondent=serializer.validated_data.get('correspondent', ''),
                request=request,
            )
        else:
            payment.status = 'failed'
            payment.save(update_fields=['status', 'updated_at'])
            return Response({'error': f'Provider "{provider}" not supported.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if err:
            payment.status = 'failed'
            payment.save(update_fields=['status', 'updated_at'])
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        return Response(data)

    except Exception as e:
        payment.status = 'failed'
        payment.save(update_fields=['status', 'updated_at'])
        logger.exception(f'Unhandled deposit error for payment {payment.id}')
        return Response({'error': 'Deposit failed. Please try again or contact support.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ── Withdrawal ────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def withdraw_funds_view(request):
    """
    Withdraw funds from wallet.
    Mobile money (mtn/airtel/mpesa): PawaPay payout pushed to phone.
    """
    serializer = WithdrawalRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'error': 'Invalid request.', 'details': serializer.errors},
                        status=status.HTTP_400_BAD_REQUEST)

    user   = request.user
    amount = serializer.validated_data['amount']

    try:
        wallet = Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Response({'error': 'Wallet not found. Please deposit first.'},
                        status=status.HTTP_404_NOT_FOUND)

    if wallet.is_locked:
        return Response({'error': f'Wallet is locked: {wallet.lock_reason}'},
                        status=status.HTTP_403_FORBIDDEN)

    if wallet.available_balance < amount:
        return Response(
            {'error': f'Insufficient balance. Available: {wallet.available_balance:.2f} {wallet.currency}'},
            status=status.HTTP_400_BAD_REQUEST
        )

    allowed, reason = services.check_withdrawal_limits(user, amount)
    if not allowed:
        return Response({'error': reason}, status=status.HTTP_400_BAD_REQUEST)

    provider     = serializer.validated_data['provider']
    correspondent = (
        serializer.validated_data.get('correspondent', '')
        or request.data.get('correspondent', '')
    )

    withdrawal = Withdrawal.objects.create(
        user=user, amount=amount,
        currency=serializer.validated_data.get('currency', wallet.currency),
        provider=provider,
        phone_number=serializer.validated_data.get('phone_number', ''),
        bank_account=serializer.validated_data.get('bank_account', ''),
        paypal_email=serializer.validated_data.get('paypal_email', ''),
        provider_response={'correspondent': correspondent} if correspondent else {},
    )
    PaymentAuditLog.log(
        action='initiated', withdrawal=withdrawal,
        previous_status='', new_status='pending',
        amount=amount, currency=withdrawal.currency, provider=provider,
        ip_address=services._get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:512],
    )

    try:
        wallet.deduct_funds(
            amount=amount, transaction_type='withdrawal',
            description=f'Withdrawal via {provider}',
            metadata={'withdrawal_id': withdrawal.id, 'provider': provider},
        )

        if provider in ('airtel', 'mtn', 'mpesa'):
            services.initiate_pawapay_payout(withdrawal)
        elif provider == 'bank':
            withdrawal.transaction_id = f'bank_{withdrawal.id}'
            withdrawal.status = 'processing'
            withdrawal.save(update_fields=['transaction_id', 'status', 'updated_at'])
        elif provider == 'paypal':
            withdrawal.transaction_id = f'paypal_{withdrawal.id}'
            withdrawal.status = 'processing'
            withdrawal.save(update_fields=['transaction_id', 'status', 'updated_at'])

        wallet.refresh_from_db()
        return Response({
            'withdrawal': WithdrawalSerializer(withdrawal).data,
            'wallet':     WalletSerializer(wallet).data,
            'message': (
                'Withdrawal submitted. Funds will arrive on your phone shortly.'
                if provider in ('airtel', 'mtn', 'mpesa')
                else 'Withdrawal submitted. Processing will complete soon.'
            ),
        })

    except ValueError as e:
        withdrawal.status = 'failed'
        withdrawal.save(update_fields=['status', 'updated_at'])
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        withdrawal.status = 'failed'
        withdrawal.save(update_fields=['status', 'updated_at'])
        services.refund_wallet_for_withdrawal(withdrawal, reason=str(e)[:200])
        return Response({'error': f'Withdrawal failed: {str(e)}'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Alias
request_withdrawal_view = withdraw_funds_view


# ── Wallet ────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def wallet_balance_view(request):
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    if wallet.total_earned != request.user.total_earnings:
        wallet.total_earned = request.user.total_earnings
        wallet.save(update_fields=['total_earned', 'updated_at'])
    return Response({
        'wallet': WalletSerializer(wallet).data,
        'user_earnings': str(request.user.total_earnings),
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def transaction_history_view(request):
    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    tx_type = request.query_params.get('type')
    limit   = min(int(request.query_params.get('limit', 50)), 200)
    qs      = wallet.transactions.all()
    if tx_type:
        qs = qs.filter(transaction_type=tx_type)
    total = qs.count()
    txs   = list(qs[:limit])
    return Response({'transactions': TransactionSerializer(txs, many=True).data, 'count': total})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def add_game_earnings_view(request):
    raw_amount = request.data.get('amount')
    game_type  = request.data.get('game_type', 'challenge')
    game_id    = request.data.get('game_id', '')
    if not raw_amount:
        return Response({'error': 'amount is required.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        amount = Decimal(str(raw_amount))
        if amount <= 0:
            raise ValueError()
    except Exception:
        return Response({'error': 'Invalid amount.'}, status=status.HTTP_400_BAD_REQUEST)

    wallet, _ = Wallet.objects.get_or_create(user=request.user)
    try:
        wallet.add_funds(amount=amount, transaction_type='earning',
                         description=f'Earnings from {game_type}',
                         metadata={'game_type': game_type, 'game_id': str(game_id)})
        request.user.total_earnings += amount
        request.user.save(update_fields=['total_earnings'])
        wallet.refresh_from_db()
        return Response({'wallet': WalletSerializer(wallet).data,
                         'message': f'Added {amount} {wallet.currency} to your wallet.'})
    except Exception as e:
        return Response({'error': f'Failed to add earnings: {str(e)}'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def withdrawal_limits_view(request):
    from django.db.models import Sum
    from django.utils import timezone as tz
    user  = request.user
    today = tz.now().date()
    now   = tz.now()
    daily_used = Withdrawal.objects.filter(
        user=user, status__in=['processing', 'completed'],
        created_at__date=today,
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    monthly_used = Withdrawal.objects.filter(
        user=user, status__in=['processing', 'completed'],
        created_at__year=now.year, created_at__month=now.month,
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    try:
        limit       = user.withdrawal_limit
        daily_max   = limit.daily_limit
        monthly_max = limit.monthly_limit
        currency    = limit.currency
    except Exception:
        daily_max   = services.DEFAULT_DAILY_WITHDRAWAL_LIMIT
        monthly_max = services.DEFAULT_MONTHLY_WITHDRAWAL_LIMIT
        currency    = 'ZMW'
    return Response({
        'daily_limit':       str(daily_max),
        'daily_used':        str(daily_used),
        'daily_remaining':   str(max(daily_max - daily_used, Decimal('0'))),
        'monthly_limit':     str(monthly_max),
        'monthly_used':      str(monthly_used),
        'monthly_remaining': str(max(monthly_max - monthly_used, Decimal('0'))),
        'currency':          currency,
        'min_withdrawal':    str(services.MIN_WITHDRAWAL_AMOUNT),
        'min_deposit':       str(services.MIN_DEPOSIT_AMOUNT),
    })


# ── Paystack callback ─────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([permissions.AllowAny])
def paystack_callback_view(request):
    return Response({'status': 'success',
                     'message': 'Payment received. Wallet will be credited once confirmed by Paystack.'})


# ── Webhooks ──────────────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def stripe_webhook(request):
    sig = request.META.get('HTTP_STRIPE_SIGNATURE', '')
    try:
        event = stripe.Webhook.construct_event(
            request.body, sig, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        return HttpResponse('Invalid payload', status=400)
    except stripe.error.SignatureVerificationError:
        return HttpResponse('Invalid signature', status=400)

    services.handle_stripe_webhook_event(event)
    return HttpResponse(status=200)


@csrf_exempt
@require_POST
def paystack_webhook(request):
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse('Invalid JSON', status=400)

    secret = getattr(settings, 'PAYSTACK_SECRET_KEY', '')
    if secret:
        expected = hmac.new(secret.encode(), request.body, hashlib.sha512).hexdigest()
        received = request.META.get('HTTP_X_PAYSTACK_SIGNATURE', '')
        if not hmac.compare_digest(expected, received):
            logger.warning("Paystack webhook: invalid signature")
            return HttpResponse('Invalid signature', status=401)

    services.handle_paystack_webhook_event(payload)
    return HttpResponse(status=200)


@csrf_exempt
@require_POST
def pawapay_webhook(request):
    secret = getattr(settings, 'PAWAPAY_WEBHOOK_SECRET', '')
    if secret:
        sig      = request.META.get('HTTP_X_PAWAPAY_SIGNATURE', '')
        expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            logger.warning("PawaPay webhook: invalid signature")
            return HttpResponse('Invalid signature', status=401)

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse('Invalid JSON', status=400)

    http_status, _ = services.handle_pawapay_webhook_event(payload)
    return HttpResponse(status=http_status)


@csrf_exempt
@require_POST
def tingg_webhook(request):
    try:
        logger.info(f"Tingg webhook: {json.loads(request.body)}")
    except Exception:
        pass
    return HttpResponse(status=200)


@csrf_exempt
@require_POST
def lemonsqueezy_webhook(request):
    try:
        logger.info(f"LemonSqueezy webhook: {json.loads(request.body)}")
    except Exception:
        pass
    return HttpResponse(status=200)


# Legacy alias
initiate_payment_view = deposit_funds_view
