"""
Payment Service Layer — ARTX Platform

All payment business logic lives here.
Views are thin HTTP wrappers that call these functions.
"""
import re
import uuid
import logging
import hashlib
import hmac

import requests
import stripe
from decimal import Decimal
from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone

from .models import (
    Payment, PaymentAllocation, Withdrawal,
    Wallet, Transaction, PaymentAuditLog, WithdrawalLimit,
)

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_DAILY_WITHDRAWAL_LIMIT   = Decimal(getattr(settings, 'DEFAULT_DAILY_WITHDRAWAL_LIMIT',   '5000.00'))
DEFAULT_MONTHLY_WITHDRAWAL_LIMIT = Decimal(getattr(settings, 'DEFAULT_MONTHLY_WITHDRAWAL_LIMIT', '50000.00'))
MIN_DEPOSIT_AMOUNT    = Decimal(getattr(settings, 'MIN_DEPOSIT_AMOUNT',    '1.00'))
MIN_WITHDRAWAL_AMOUNT = Decimal(getattr(settings, 'MIN_WITHDRAWAL_AMOUNT', '5.00'))

PAWAPAY_COUNTRY_PREFIXES = {
    'ZMB': ['+260'], 'KEN': ['+254'], 'TZA': ['+255'], 'UGA': ['+256'],
    'GHA': ['+233'], 'NGA': ['+234'], 'CMR': ['+237'], 'CIV': ['+225'],
    'SEN': ['+221'], 'BFA': ['+226'], 'MLI': ['+223'], 'MDG': ['+261'],
    'RWA': ['+250'], 'ZWE': ['+263'], 'MOZ': ['+258'], 'TGO': ['+228'],
    'BEN': ['+229'],
}

PROVIDER_CORRESPONDENT_MAP = {
    'mtn':    'MTN_MOMO_ZMB',
    'airtel': 'AIRTEL_OAPI_ZMB',
    'mpesa':  'VODACOM_MPESA_TZA',
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    return xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR', '')


def validate_pawapay_phone(phone_number: str, correspondent: str):
    """
    Clean and validate a phone number for PawaPay.
    Returns (cleaned_phone, error_message). error_message is None if valid.
    """
    cleaned = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

    if not re.match(r'^\+?[1-9]\d{6,14}$', cleaned):
        return None, 'Invalid phone number. Use international format, e.g. +260977123456'

    if not cleaned.startswith('+'):
        cleaned = '+' + cleaned

    country_code = correspondent.upper().split('_')[-1] if '_' in correspondent else ''
    if country_code in PAWAPAY_COUNTRY_PREFIXES:
        valid = PAWAPAY_COUNTRY_PREFIXES[country_code]
        if not any(cleaned.startswith(p) for p in valid):
            return None, (
                f'Phone number does not match the selected network ({country_code}). '
                f'Expected prefix: {", ".join(valid)}'
            )
    return cleaned, None


def _pawapay_headers():
    return {
        'Authorization': f'Bearer {settings.PAWAPAY_API_KEY}',
        'Content-Type': 'application/json',
    }


# ── Deposit services ──────────────────────────────────────────────────────────

def initiate_stripe_deposit(payment: Payment, request):
    """Create Stripe PaymentIntent. Returns (data_dict, error_str)."""
    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        intent = stripe.PaymentIntent.create(
            amount=int(payment.amount * 100),
            currency=payment.currency.lower(),
            description=payment.description,
            receipt_email=payment.user.email,
            metadata={
                'payment_id': str(payment.id),
                'user_id':    str(payment.user.id),
                'user_email': payment.user.email,
                'platform':   'artx',
            },
        )
        payment.payment_intent_id = intent.id
        payment.external_id       = intent.id
        payment.status            = 'processing'
        payment.save(update_fields=['payment_intent_id', 'external_id', 'status', 'updated_at'])

        _audit(action='processing', payment=payment,
               prev='pending', new='processing',
               amount=payment.amount, currency=payment.currency,
               provider='stripe', ip=_get_client_ip(request),
               meta={'intent_id': intent.id})

        logger.info(f"Stripe PaymentIntent {intent.id} created for payment {payment.id}")
        return {
            'payment_id':      payment.id,
            'client_secret':   intent.client_secret,
            'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            'provider':        'stripe',
            'amount':          str(payment.amount),
            'currency':        payment.currency,
        }, None

    except stripe.error.CardError as e:
        return None, f'Card declined: {e.user_message or str(e)}'
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error for payment {payment.id}: {e}")
        return None, 'Payment provider error. Please try again.'


def initiate_paystack_deposit(payment: Payment, request):
    """Initialize Paystack transaction. Returns (data_dict, error_str)."""
    reference = f'artx_{payment.id}_{int(timezone.now().timestamp())}'
    headers   = {
        'Authorization': f'Bearer {settings.PAYSTACK_SECRET_KEY}',
        'Content-Type':  'application/json',
    }
    body = {
        'email':        payment.user.email,
        'amount':       int(payment.amount * 100),
        'currency':     payment.currency,
        'reference':    reference,
        'callback_url': request.build_absolute_uri('/api/payments/paystack/callback/'),
        'metadata': {
            'payment_id': str(payment.id),
            'user_id':    str(payment.user.id),
            'custom_fields': [
                {'display_name': 'Platform', 'variable_name': 'platform', 'value': 'ARTX'},
                {'display_name': 'User', 'variable_name': 'username', 'value': payment.user.username},
            ],
        },
    }
    try:
        resp   = requests.post('https://api.paystack.co/transaction/initialize',
                               headers=headers, json=body, timeout=30)
        result = resp.json()
    except requests.exceptions.Timeout:
        return None, 'Paystack timed out. Please try again.'
    except requests.exceptions.RequestException as e:
        logger.error(f"Paystack connection error: {e}")
        return None, 'Could not reach payment provider.'

    if not result.get('status'):
        return None, result.get('message', 'Paystack initialization failed.')

    payment.transaction_reference = reference
    payment.external_id           = reference
    payment.status                = 'processing'
    payment.save(update_fields=['transaction_reference', 'external_id', 'status', 'updated_at'])

    _audit(action='processing', payment=payment,
           prev='pending', new='processing',
           amount=payment.amount, currency=payment.currency,
           provider='paystack', ip=_get_client_ip(request),
           meta={'reference': reference})

    return {
        'payment_id':       payment.id,
        'authorization_url': result['data']['authorization_url'],
        'access_code':       result['data']['access_code'],
        'reference':         reference,
        'provider':          'paystack',
    }, None


def _pawapay_timestamp(dt) -> str:
    """
    Format a datetime as RFC 3339 / ISO 8601 with second precision and UTC 'Z'.
    PawaPay rejects microseconds and timezone offsets like +00:00.
    Correct: '2026-07-10T22:34:12Z'   Wrong: '2026-07-10T22:34:12.060123+00:00'
    """
    import datetime
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _pawapay_amount(amount: Decimal) -> str:
    """
    Format a Decimal for PawaPay: always use fixed-point notation with 2 dp.
    Python's str(Decimal('1E+3')) → '1E+3' which PawaPay rejects.
    """
    return f'{amount:.2f}'


def _pawapay_description(amount: Decimal, currency: str) -> str:
    """
    Build a statementDescription that:
    - Contains only alphanumeric chars and spaces (PawaPay requirement)
    - Is at most 22 characters long
    """
    desc = f'ARTX {amount:.0f} {currency}'
    return desc[:22]


def initiate_pawapay_deposit(payment: Payment, phone_number: str,
                             correspondent: str, request=None):
    """
    Send USSD push deposit to PawaPay.
    User receives a prompt on their phone to enter PIN.
    Returns (data_dict, error_str).
    """
    if not phone_number:
        return None, 'Phone number is required for mobile money deposits.'
    if not correspondent:
        return None, 'Network/correspondent is required (e.g. MTN_MOMO_ZMB).'

    cleaned_phone, err = validate_pawapay_phone(phone_number, correspondent)
    if err:
        return None, err

    if payment.amount < MIN_DEPOSIT_AMOUNT:
        return None, f'Minimum deposit is {MIN_DEPOSIT_AMOUNT} {payment.currency}.'

    deposit_id = f'artxd{payment.id}{uuid.uuid4().hex[:6]}'
    # PawaPay depositId: alphanumeric only, max 36 chars
    deposit_id = re.sub(r'[^a-zA-Z0-9]', '', deposit_id)[:36]

    payload = {
        'depositId':            deposit_id,
        # amount must be a plain decimal string — never scientific notation
        'amount':               _pawapay_amount(payment.amount),
        'currency':             payment.currency,
        'correspondent':        correspondent.upper(),
        'payer': {
            'type':    'MSISDN',
            'address': {'value': cleaned_phone},
        },
        # RFC 3339 with second precision, UTC 'Z' suffix — no microseconds
        'customerTimestamp':    _pawapay_timestamp(payment.created_at),
        # alphanumeric + spaces only, max 22 chars
        'statementDescription': _pawapay_description(payment.amount, payment.currency),
        # NOTE: PawaPay does NOT accept a top-level 'metadata' field —
        # store internal data in payment.metadata instead (done below)
    }

    try:
        resp   = requests.post(f'{settings.PAWAPAY_API_URL}/deposits',
                               headers=_pawapay_headers(), json=payload, timeout=30)
        result = resp.json()
    except requests.exceptions.Timeout:
        payment.status = 'failed'; payment.save(update_fields=['status', 'updated_at'])
        return None, 'Mobile money network timed out. Please try again.'
    except requests.exceptions.RequestException as e:
        payment.status = 'failed'; payment.save(update_fields=['status', 'updated_at'])
        return None, f'Could not reach mobile money provider: {str(e)}'

    if resp.status_code not in (200, 201, 202):
        err_msg = result.get('errorMessage') or result.get('message', 'Unknown PawaPay error')
        payment.status = 'failed'; payment.save(update_fields=['status', 'updated_at'])
        logger.error(f"PawaPay deposit API error for payment {payment.id}: {result}")
        return None, f'Mobile money error: {err_msg}'

    payment.transaction_reference = deposit_id
    payment.external_id           = deposit_id
    payment.status                = 'processing'
    payment.metadata.update({
        'phone_number':  cleaned_phone,
        'correspondent': correspondent.upper(),
        'deposit_id':    deposit_id,
    })
    payment.save(update_fields=['transaction_reference', 'external_id',
                                'status', 'metadata', 'updated_at'])

    _audit(action='processing', payment=payment,
           prev='pending', new='processing',
           amount=payment.amount, currency=payment.currency,
           provider='pawapay',
           ip=_get_client_ip(request) if request else None,
           meta={'deposit_id': deposit_id, 'correspondent': correspondent.upper()})

    logger.info(f"PawaPay deposit {deposit_id} initiated for user {payment.user.id}")
    return {
        'payment_id':    payment.id,
        'deposit_id':    deposit_id,
        'pawapay_status': result.get('status', 'SUBMITTED'),
        'correspondent': correspondent.upper(),
        'phone_number':  cleaned_phone,
        'amount':        str(payment.amount),
        'currency':      payment.currency,
        'provider':      'pawapay',
        'message': (
            'A payment prompt has been sent to your phone. '
            'Please enter your mobile money PIN to complete the deposit.'
        ),
    }, None


# ── Withdrawal services ───────────────────────────────────────────────────────

def check_withdrawal_limits(user, amount: Decimal) -> tuple:
    """Check daily/monthly limits. Returns (allowed, reason)."""
    amount = Decimal(str(amount))
    if amount < MIN_WITHDRAWAL_AMOUNT:
        return False, f'Minimum withdrawal is {MIN_WITHDRAWAL_AMOUNT}.'

    try:
        limit = user.withdrawal_limit
        return limit.check_limit(amount)
    except Exception:
        from django.db.models import Sum
        today = timezone.now().date()
        now   = timezone.now()

        daily = Withdrawal.objects.filter(
            user=user, status__in=['processing', 'completed'],
            created_at__date=today,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

        monthly = Withdrawal.objects.filter(
            user=user, status__in=['processing', 'completed'],
            created_at__year=now.year, created_at__month=now.month,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

        if daily + amount > DEFAULT_DAILY_WITHDRAWAL_LIMIT:
            remaining = max(DEFAULT_DAILY_WITHDRAWAL_LIMIT - daily, Decimal('0'))
            return False, f'Daily limit reached. Remaining today: {remaining:.2f}'
        if monthly + amount > DEFAULT_MONTHLY_WITHDRAWAL_LIMIT:
            remaining = max(DEFAULT_MONTHLY_WITHDRAWAL_LIMIT - monthly, Decimal('0'))
            return False, f'Monthly limit reached. Remaining this month: {remaining:.2f}'
    return True, ''


def initiate_pawapay_payout(withdrawal: Withdrawal):
    """
    Send PawaPay payout — money pushed directly to user's phone.
    Raises ValueError on validation failure, Exception on API failure.
    """
    correspondent = (
        withdrawal.provider_response.get('correspondent')
        or PROVIDER_CORRESPONDENT_MAP.get(withdrawal.provider, 'MTN_MOMO_ZMB')
    )

    cleaned_phone, err = validate_pawapay_phone(withdrawal.phone_number, correspondent)
    if err:
        raise ValueError(err)

    payout_id = f'artxp{withdrawal.id}{uuid.uuid4().hex[:6]}'
    payout_id = re.sub(r'[^a-zA-Z0-9]', '', payout_id)[:36]

    payload = {
        'payoutId':             payout_id,
        'amount':               _pawapay_amount(withdrawal.amount),
        'currency':             withdrawal.currency,
        'correspondent':        correspondent.upper(),
        'recipient': {
            'type':    'MSISDN',
            'address': {'value': cleaned_phone},
        },
        'customerTimestamp':    _pawapay_timestamp(withdrawal.created_at),
        'statementDescription': _pawapay_description(withdrawal.amount, withdrawal.currency),
        # No top-level 'metadata' field — PawaPay rejects it
    }

    try:
        resp   = requests.post(f'{settings.PAWAPAY_API_URL}/payouts',
                               headers=_pawapay_headers(), json=payload, timeout=30)
        result = resp.json()
    except requests.exceptions.Timeout:
        withdrawal.status = 'failed'
        withdrawal.save(update_fields=['status', 'updated_at'])
        raise Exception('Mobile money network timed out. Please retry.')
    except requests.exceptions.RequestException as e:
        withdrawal.status = 'failed'
        withdrawal.provider_response = {'error': str(e)}
        withdrawal.save(update_fields=['status', 'provider_response', 'updated_at'])
        raise Exception(f'Could not reach mobile money provider: {str(e)}')

    if resp.status_code not in (200, 201, 202):
        err_msg = result.get('errorMessage') or result.get('message', 'Unknown error')
        withdrawal.status = 'failed'
        withdrawal.provider_response = result
        withdrawal.save(update_fields=['status', 'provider_response', 'updated_at'])
        raise Exception(f'Mobile money payout failed: {err_msg}')

    withdrawal.transaction_id    = payout_id
    withdrawal.status            = 'processing'
    withdrawal.provider_response = result
    withdrawal.save(update_fields=['transaction_id', 'status', 'provider_response', 'updated_at'])

    _audit(action='processing', withdrawal=withdrawal,
           prev='pending', new='processing',
           amount=withdrawal.amount, currency=withdrawal.currency,
           provider=withdrawal.provider,
           meta={'payout_id': payout_id, 'correspondent': correspondent.upper()})

    logger.info(f"PawaPay payout {payout_id} initiated for user {withdrawal.user.id}")


# ── Wallet credit / refund ────────────────────────────────────────────────────

def credit_wallet_from_payment(payment: Payment) -> bool:
    """Credit wallet from completed deposit. Idempotent."""
    if payment.metadata.get('deposit_type') != 'wallet':
        return False
    wallet_id = payment.metadata.get('wallet_id')
    if not wallet_id:
        logger.error(f"credit_wallet: no wallet_id in payment {payment.id}")
        return False

    try:
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(id=wallet_id, user=payment.user)

            already = Transaction.objects.filter(
                wallet=wallet,
                metadata__payment_id=str(payment.id),
                transaction_type='deposit',
            ).exists()
            if already:
                logger.info(f"Wallet {wallet.id} already credited for payment {payment.id}")
                return True

            wallet.add_funds(
                amount=payment.amount,
                transaction_type='deposit',
                description=f'Deposit via {payment.get_provider_display()}',
                metadata={'payment_id': str(payment.id), 'provider': payment.provider},
            )
            _audit(action='wallet_credited', payment=payment,
                   amount=payment.amount, currency=payment.currency,
                   provider=payment.provider, meta={'wallet_id': wallet.id})
            logger.info(f"Wallet {wallet.id} credited {payment.amount} {payment.currency} "
                        f"from payment {payment.id}")
            return True

    except Wallet.DoesNotExist:
        logger.error(f"credit_wallet: wallet {wallet_id} not found for payment {payment.id}")
        return False
    except Exception as e:
        logger.error(f"credit_wallet failed for payment {payment.id}: {e}")
        return False


def refund_wallet_for_withdrawal(withdrawal: Withdrawal, reason: str = '') -> bool:
    """Refund a failed withdrawal back to wallet. Idempotent."""
    try:
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(user=withdrawal.user)

            already = Transaction.objects.filter(
                wallet=wallet,
                metadata__withdrawal_id=str(withdrawal.id),
                transaction_type='refund',
            ).exists()
            if already:
                logger.info(f"Wallet already refunded for withdrawal {withdrawal.id}")
                return True

            wallet.add_funds(
                amount=withdrawal.amount,
                transaction_type='refund',
                description=f'Refund: {withdrawal.provider} withdrawal failed',
                metadata={'withdrawal_id': str(withdrawal.id), 'reason': reason},
            )
            _audit(action='refund_issued', withdrawal=withdrawal,
                   amount=withdrawal.amount, currency=withdrawal.currency,
                   provider=withdrawal.provider, note=reason)
            logger.info(f"Refunded {withdrawal.amount} to wallet for withdrawal {withdrawal.id}")
            return True
    except Exception as e:
        logger.error(f"CRITICAL: refund failed for withdrawal {withdrawal.id}: {e}")
        return False


# ── Webhook event handlers ────────────────────────────────────────────────────

def handle_stripe_webhook_event(event: dict) -> bool:
    event_type = event.get('type', '')
    logger.info(f"Stripe webhook: {event_type}")

    if event_type == 'payment_intent.succeeded':
        pi         = event['data']['object']
        payment_id = pi.get('metadata', {}).get('payment_id')
        if not payment_id:
            return True
        try:
            payment   = Payment.objects.get(id=payment_id)
            prev      = payment.status
            completed = payment.mark_completed()
            if completed:
                credit_wallet_from_payment(payment)
                _audit(action='completed', payment=payment,
                       prev=prev, new='completed',
                       amount=payment.amount, currency=payment.currency,
                       provider='stripe', meta={'intent_id': pi['id']})
        except Payment.DoesNotExist:
            logger.warning(f"Stripe webhook: payment {payment_id} not found")

    elif event_type == 'payment_intent.payment_failed':
        pi         = event['data']['object']
        payment_id = pi.get('metadata', {}).get('payment_id')
        if payment_id:
            try:
                payment = Payment.objects.get(id=payment_id)
                if payment.status not in ('failed', 'completed'):
                    prev           = payment.status
                    payment.status = 'failed'
                    payment.save(update_fields=['status', 'updated_at'])
                    _audit(action='failed', payment=payment,
                           prev=prev, new='failed', provider='stripe',
                           meta={'error': pi.get('last_payment_error', {})})
            except Payment.DoesNotExist:
                pass
    return True


def handle_paystack_webhook_event(payload: dict) -> bool:
    event = payload.get('event', '')
    logger.info(f"Paystack webhook: {event}")

    if event == 'charge.success':
        ref = payload.get('data', {}).get('reference', '')
        try:
            payment   = Payment.objects.get(transaction_reference=ref)
            prev      = payment.status
            completed = payment.mark_completed()
            if completed:
                credit_wallet_from_payment(payment)
                _audit(action='completed', payment=payment,
                       prev=prev, new='completed',
                       provider='paystack', meta={'reference': ref})
        except Payment.DoesNotExist:
            logger.warning(f"Paystack webhook: no payment for ref {ref}")

    elif event == 'charge.failed':
        ref = payload.get('data', {}).get('reference', '')
        try:
            payment = Payment.objects.get(transaction_reference=ref)
            if payment.status not in ('failed', 'completed'):
                prev           = payment.status
                payment.status = 'failed'
                payment.save(update_fields=['status', 'updated_at'])
                _audit(action='failed', payment=payment,
                       prev=prev, new='failed', provider='paystack')
        except Payment.DoesNotExist:
            pass
    return True


def handle_pawapay_webhook_event(payload: dict) -> tuple:
    """Returns (http_status, message)."""
    deposit_id   = payload.get('depositId')
    payout_id    = payload.get('payoutId')
    pawa_status  = payload.get('status', '').upper()

    _audit(action='webhook_received', meta={
        'depositId': deposit_id, 'payoutId': payout_id, 'status': pawa_status,
    })

    # ── Deposit ───────────────────────────────────────────────────────────────
    if deposit_id:
        try:
            with db_transaction.atomic():
                payment = Payment.objects.select_for_update().get(
                    transaction_reference=deposit_id
                )
                prev = payment.status
                payment.metadata['pawapay_callback'] = payload

                if pawa_status == 'COMPLETED':
                    if payment.status == 'completed':
                        return 200, 'already completed'
                    payment.status        = 'completed'
                    payment.completed_at  = timezone.now()
                    payment.save(update_fields=['status', 'completed_at', 'metadata', 'updated_at'])
                    credit_wallet_from_payment(payment)
                    _audit(action='completed', payment=payment,
                           prev=prev, new='completed',
                           amount=payment.amount, currency=payment.currency,
                           provider='pawapay')

                elif pawa_status in ('FAILED', 'REJECTED'):
                    payment.status = 'failed'
                    payment.metadata['failure_reason'] = payload.get('failureReason', {})
                    payment.save(update_fields=['status', 'metadata', 'updated_at'])
                    _audit(action='failed', payment=payment,
                           prev=prev, new='failed', provider='pawapay',
                           meta={'reason': payload.get('failureReason', {})})

                elif pawa_status in ('SUBMITTED', 'ACCEPTED', 'DUPLICATE_IGNORED'):
                    payment.status = 'processing'
                    payment.save(update_fields=['status', 'metadata', 'updated_at'])

        except Payment.DoesNotExist:
            logger.error(f"PawaPay webhook: no payment for depositId={deposit_id}")
            return 404, 'payment not found'

    # ── Payout ────────────────────────────────────────────────────────────────
    elif payout_id:
        try:
            with db_transaction.atomic():
                withdrawal = Withdrawal.objects.select_for_update().get(
                    transaction_id=payout_id
                )
                prev = withdrawal.status
                if not withdrawal.provider_response:
                    withdrawal.provider_response = {}
                withdrawal.provider_response['pawapay_callback'] = payload

                if pawa_status == 'COMPLETED':
                    if withdrawal.status == 'completed':
                        return 200, 'already completed'
                    withdrawal.status       = 'completed'
                    withdrawal.completed_at = timezone.now()
                    withdrawal.save(update_fields=['status', 'completed_at',
                                                   'provider_response', 'updated_at'])
                    _audit(action='completed', withdrawal=withdrawal,
                           prev=prev, new='completed',
                           amount=withdrawal.amount, currency=withdrawal.currency,
                           provider=withdrawal.provider)

                elif pawa_status in ('FAILED', 'REJECTED'):
                    withdrawal.status = 'failed'
                    withdrawal.provider_response['failure_reason'] = payload.get('failureReason', {})
                    withdrawal.save(update_fields=['status', 'provider_response', 'updated_at'])
                    reason = str(payload.get('failureReason', {}).get('failureCode', pawa_status))
                    refund_wallet_for_withdrawal(withdrawal, reason=reason)
                    _audit(action='refund_issued', withdrawal=withdrawal,
                           prev=prev, new='failed',
                           amount=withdrawal.amount, currency=withdrawal.currency,
                           provider=withdrawal.provider,
                           meta={'reason': payload.get('failureReason', {})})

                elif pawa_status in ('SUBMITTED', 'ACCEPTED'):
                    withdrawal.status = 'processing'
                    withdrawal.save(update_fields=['status', 'provider_response', 'updated_at'])

        except Withdrawal.DoesNotExist:
            logger.error(f"PawaPay webhook: no withdrawal for payoutId={payout_id}")
            return 404, 'withdrawal not found'

    return 200, 'ok'


# ── Audit helper ──────────────────────────────────────────────────────────────

def _audit(*, action, payment=None, withdrawal=None, prev='', new='',
           amount=None, currency='', provider='', ip=None, ua='',
           meta=None, note=''):
    """Write a PaymentAuditLog entry. Never raises."""
    try:
        PaymentAuditLog.log(
            action=action, payment=payment, withdrawal=withdrawal,
            previous_status=prev, new_status=new,
            amount=amount, currency=currency, provider=provider,
            ip_address=ip, user_agent=ua,
            metadata=meta or {}, note=note,
        )
    except Exception:
        pass
