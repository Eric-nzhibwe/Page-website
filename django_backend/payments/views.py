"""
Payment views for ARTX Platform API
"""
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.utils import timezone
from decimal import Decimal
import stripe
import requests
import json
import logging

from .models import Payment, PaymentAllocation, Withdrawal, PaymentMethod, Wallet, Transaction
from .serializers import (
    PaymentSerializer, WithdrawalSerializer, PaymentMethodSerializer,
    PaymentInitiateSerializer, WithdrawalRequestSerializer,
    WalletSerializer, TransactionSerializer, DepositSerializer
)

logger = logging.getLogger(__name__)


class PaymentHistoryView(generics.ListAPIView):
    """Get user payment history"""
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Payment.objects.filter(user=self.request.user)


class WithdrawalHistoryView(generics.ListAPIView):
    """Get user withdrawal history"""
    serializer_class = WithdrawalSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Withdrawal.objects.filter(user=self.request.user)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def initiate_payment_view(request):
    """Initiate payment with selected provider"""
    serializer = PaymentInitiateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    provider = serializer.validated_data['provider']
    amount = serializer.validated_data['amount']
    currency = serializer.validated_data.get('currency', 'USD')
    
    # Create payment record
    payment = Payment.objects.create(
        user=request.user,
        provider=provider,
        amount=amount,
        currency=currency,
        description=f"ARTX Platform Payment - {amount} {currency}",
        metadata={'initiated_from': 'web_app'}
    )
    
    # Create allocation
    PaymentAllocation.objects.create(payment=payment)
    
    try:
        if provider == 'stripe':
            return handle_stripe_payment(payment, request)
        elif provider == 'paystack':
            return handle_paystack_payment(payment, request)
        elif provider == 'tingg':
            return handle_tingg_payment(payment, request)
        elif provider == 'lemonsqueezy':
            return handle_lemonsqueezy_payment(payment, request)
        elif provider == 'pawapay':
            return handle_pawapay_payment(payment, request)
        else:
            return Response({
                'error': f'Provider {provider} not supported'
            }, status=status.HTTP_400_BAD_REQUEST)
            
    except Exception as e:
        payment.status = 'failed'
        payment.save()
        return Response({
            'error': f'Payment initiation failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def handle_stripe_payment(payment, request):
    """Handle Stripe payment"""
    stripe.api_key = settings.STRIPE_SECRET_KEY
    
    try:
        # Create payment intent
        intent = stripe.PaymentIntent.create(
            amount=int(payment.amount * 100),  # Convert to cents
            currency=payment.currency.lower(),
            metadata={
                'payment_id': payment.id,
                'user_id': payment.user.id,
                'user_email': payment.user.email
            }
        )
        
        payment.payment_intent_id = intent.id
        payment.external_id = intent.id
        payment.status = 'processing'
        payment.save()
        
        return Response({
            'payment_id': payment.id,
            'client_secret': intent.client_secret,
            'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            'provider': 'stripe',
            'amount': payment.amount,
            'currency': payment.currency
        })
        
    except stripe.error.StripeError as e:
        return Response({
            'error': f'Stripe error: {str(e)}'
        }, status=status.HTTP_400_BAD_REQUEST)


def handle_paystack_payment(payment, request):
    """Handle Paystack payment"""
    url = "https://api.paystack.co/transaction/initialize"
    
    headers = {
        'Authorization': f'Bearer {settings.PAYSTACK_SECRET_KEY}',
        'Content-Type': 'application/json'
    }
    
    data = {
        'email': payment.user.email,
        'amount': int(payment.amount * 100),  # Convert to kobo
        'currency': payment.currency,
        'reference': f'artx_payment_{payment.id}',
        'callback_url': f'{request.build_absolute_uri("/")}/api/payments/paystack/callback/',
        'metadata': {
            'payment_id': payment.id,
            'user_id': payment.user.id
        }
    }
    
    response = requests.post(url, headers=headers, json=data)
    result = response.json()
    
    if result.get('status'):
        payment.transaction_reference = result['data']['reference']
        payment.external_id = result['data']['reference']
        payment.status = 'processing'
        payment.save()
        
        return Response({
            'payment_id': payment.id,
            'payment_url': result['data']['authorization_url'],
            'authorization_url': result['data']['authorization_url'],
            'access_code': result['data']['access_code'],
            'reference': result['data']['reference'],
            'provider': 'paystack'
        })
    else:
        return Response({
            'error': f'Paystack error: {result.get("message", "Unknown error")}'
        }, status=status.HTTP_400_BAD_REQUEST)


def handle_tingg_payment(payment, request):
    """Handle Tingg/Cellulant payment"""
    # Tingg API implementation
    url = "https://api.tingg.africa/v1/payments/initialize"
    
    headers = {
        'Authorization': f'Bearer {settings.TINGG_SECRET_KEY}',
        'Content-Type': 'application/json'
    }
    
    data = {
        'amount': str(payment.amount),
        'currency': payment.currency,
        'customer_email': payment.user.email,
        'customer_name': payment.user.display_name or payment.user.username,
        'reference': f'artx_tingg_{payment.id}',
        'callback_url': f'{request.build_absolute_uri("/")}/api/payments/tingg/callback/',
        'metadata': {
            'payment_id': payment.id,
            'user_id': payment.user.id
        }
    }
    
    # Note: This is a mock implementation - replace with actual Tingg API
    payment.transaction_reference = f'tingg_ref_{payment.id}'
    payment.status = 'processing'
    payment.save()
    
    return Response({
        'payment_id': payment.id,
        'checkout_url': f'https://checkout.tingg.africa/pay/{payment.transaction_reference}',
        'reference': payment.transaction_reference,
        'provider': 'tingg',
        'message': 'Redirect to Tingg checkout page'
    })


def handle_lemonsqueezy_payment(payment, request):
    """Handle Lemonsqueezy payment"""
    # Lemonsqueezy API implementation
    headers = {
        'Authorization': f'Bearer {settings.LEMONSQUEEZY_API_KEY}',
        'Content-Type': 'application/json'
    }
    
    data = {
        'data': {
            'type': 'checkouts',
            'attributes': {
                'checkout_data': {
                    'email': payment.user.email,
                    'name': payment.user.display_name or payment.user.username
                },
                'custom_price': int(payment.amount * 100),
                'product_options': {
                    'name': f'ARTX Platform Payment - {payment.amount} {payment.currency}',
                    'description': 'Gaming platform payment'
                }
            },
            'relationships': {
                'store': {
                    'data': {
                        'type': 'stores',
                        'id': settings.LEMONSQUEEZY_STORE_ID
                    }
                }
            }
        }
    }
    
    # Mock implementation - replace with actual Lemonsqueezy API
    payment.transaction_reference = f'ls_ref_{payment.id}'
    payment.status = 'processing'
    payment.save()
    
    return Response({
        'payment_id': payment.id,
        'checkout_url': f'https://checkout.lemonsqueezy.com/{payment.transaction_reference}',
        'reference': payment.transaction_reference,
        'provider': 'lemonsqueezy'
    })


def handle_pawapay_payment(payment, phone_number='', correspondent='MTN_MOMO_ZMB'):
    """Handle PawaPay payment (African Mobile Money)"""
    import re
    
    url = f"{settings.PAWAPAY_API_URL}/deposits"
    
    headers = {
        'Authorization': f'Bearer {settings.PAWAPAY_API_KEY}',
        'Content-Type': 'application/json'
    }
    
    phone_number = phone_number or ''
    correspondent = correspondent or 'MTN_MOMO_ZMB'
    
    if not phone_number:
        return Response({
            'error': 'Phone number is required for PawaPay payments'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate phone number format (international format)
    phone_pattern = re.compile(r'^\+?[1-9]\d{1,14}$')
    if not phone_pattern.match(phone_number.replace(' ', '').replace('-', '')):
        return Response({
            'error': 'Invalid phone number format. Use international format (e.g., +260977123456)'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate correspondent matches phone number country
    country_map = {
        'ZMB': ['+260'],
        'KEN': ['+254'],
        'TZA': ['+255'],
        'UGA': ['+256'],
        'GHA': ['+233'],
        'NGA': ['+234']
    }
    
    correspondent_country = correspondent.split('_')[-1] if '_' in correspondent else ''
    if correspondent_country in country_map:
        valid_prefixes = country_map[correspondent_country]
        if not any(phone_number.startswith(prefix) for prefix in valid_prefixes):
            return Response({
                'error': f'Phone number does not match selected provider country'
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # PawaPay deposit request
    data = {
        'depositId': f'artx_deposit_{payment.id}',
        'amount': str(payment.amount),
        'currency': payment.currency,
        'correspondent': correspondent,  # e.g., MTN_MOMO_ZMB, AIRTEL_OAPI_ZMB, VODACOM_MPESA_TZA
        'payer': {
            'type': 'MSISDN',
            'address': {
                'value': phone_number
            }
        },
        'customerTimestamp': payment.created_at.isoformat(),
        'statementDescription': f'ARTX Platform - {payment.amount} {payment.currency}',
        'metadata': {
            'payment_id': str(payment.id),
            'user_id': str(payment.user.id),
            'username': payment.user.username
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=data, timeout=30)
        result = response.json()
        
        if response.status_code in [200, 201, 202]:
            payment.transaction_reference = data['depositId']
            payment.external_id = data['depositId']
            payment.status = 'processing'
            payment.metadata['phone_number'] = phone_number
            payment.metadata['correspondent'] = correspondent
            payment.save()
            
            return Response({
                'payment_id': payment.id,
                'deposit_id': data['depositId'],
                'status': result.get('status', 'SUBMITTED'),
                'correspondent': correspondent,
                'phone_number': phone_number,
                'amount': payment.amount,
                'currency': payment.currency,
                'provider': 'pawapay',
                'message': 'Payment initiated. Please check your phone to complete the transaction.'
            })
        else:
            error_message = result.get('message', 'Unknown error')
            return Response({
                'error': f'PawaPay error: {error_message}',
                'details': result
            }, status=status.HTTP_400_BAD_REQUEST)
            
    except requests.exceptions.RequestException as e:
        return Response({
            'error': f'PawaPay connection error: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        return Response({
            'error': f'PawaPay error: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def request_withdrawal_view(request):
    """Request withdrawal"""
    serializer = WithdrawalRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    user = request.user
    amount = serializer.validated_data['amount']
    
    # Check if user has sufficient balance
    if user.total_earnings < amount:
        return Response({
            'error': 'Insufficient balance for withdrawal'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Create withdrawal request
    withdrawal = Withdrawal.objects.create(
        user=user,
        amount=amount,
        currency=serializer.validated_data.get('currency', 'USD'),
        provider=serializer.validated_data['provider'],
        phone_number=serializer.validated_data.get('phone_number', ''),
        bank_account=serializer.validated_data.get('bank_account', ''),
        paypal_email=serializer.validated_data.get('paypal_email', '')
    )
    
    # Process withdrawal based on provider
    try:
        if withdrawal.provider in ['airtel', 'mtn', 'mpesa']:
            process_mobile_money_withdrawal(withdrawal)
        elif withdrawal.provider == 'bank':
            process_bank_withdrawal(withdrawal)
        elif withdrawal.provider == 'paypal':
            process_paypal_withdrawal(withdrawal)
        
        return Response({
            'withdrawal': WithdrawalSerializer(withdrawal).data,
            'message': 'Withdrawal request submitted successfully'
        })
        
    except Exception as e:
        withdrawal.status = 'failed'
        withdrawal.save()
        return Response({
            'error': f'Withdrawal processing failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def process_mobile_money_withdrawal(withdrawal):
    """Process mobile money withdrawal via PawaPay"""
    try:
        # Map provider to PawaPay correspondent
        correspondent_map = {
            'mtn': 'MTN_MOMO_ZMB',
            'airtel': 'AIRTEL_OAPI_ZMB',
            'mpesa': 'VODACOM_MPESA_TZA'  # Default to Tanzania, adjust based on user country
        }
        
        correspondent = correspondent_map.get(withdrawal.provider, 'MTN_MOMO_ZMB')
        
        # PawaPay payout API
        url = f"{settings.PAWAPAY_API_URL}/payouts"
        
        headers = {
            'Authorization': f'Bearer {settings.PAWAPAY_API_KEY}',
            'Content-Type': 'application/json'
        }
        
        data = {
            'payoutId': f'artx_payout_{withdrawal.id}',
            'amount': str(withdrawal.amount),
            'currency': withdrawal.currency,
            'correspondent': correspondent,
            'recipient': {
                'type': 'MSISDN',
                'address': {
                    'value': withdrawal.phone_number
                }
            },
            'customerTimestamp': withdrawal.created_at.isoformat(),
            'statementDescription': f'ARTX Withdrawal - {withdrawal.amount} {withdrawal.currency}',
            'metadata': {
                'withdrawal_id': str(withdrawal.id),
                'user_id': str(withdrawal.user.id),
                'username': withdrawal.user.username
            }
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=30)
        result = response.json()
        
        if response.status_code in [200, 201, 202]:
            withdrawal.transaction_id = data['payoutId']
            withdrawal.status = 'processing'
            withdrawal.provider_response = result
            withdrawal.save()
            
            logger.info(f"PawaPay payout initiated: {data['payoutId']}")
        else:
            withdrawal.status = 'failed'
            withdrawal.provider_response = result
            withdrawal.save()
            
            error_message = result.get('message', 'Unknown error')
            logger.error(f"PawaPay payout failed: {error_message}")
            raise Exception(f"PawaPay payout failed: {error_message}")
            
    except requests.exceptions.RequestException as e:
        withdrawal.status = 'failed'
        withdrawal.provider_response = {'error': str(e)}
        withdrawal.save()
        logger.error(f"PawaPay connection error: {str(e)}")
        raise Exception(f"PawaPay connection error: {str(e)}")
    except Exception as e:
        withdrawal.status = 'failed'
        withdrawal.save()
        logger.error(f"Withdrawal processing error: {str(e)}")
        raise


def process_bank_withdrawal(withdrawal):
    """Process bank withdrawal"""
    # Mock implementation - integrate with banking APIs
    withdrawal.transaction_id = f'bank_{withdrawal.id}'
    withdrawal.status = 'processing'
    withdrawal.save()


def process_paypal_withdrawal(withdrawal):
    """Process PayPal withdrawal"""
    # Mock implementation - integrate with PayPal API
    withdrawal.transaction_id = f'paypal_{withdrawal.id}'
    withdrawal.status = 'processing'
    withdrawal.save()


def credit_wallet_from_payment(payment):
    """
    Credit user wallet when payment is completed (idempotent)
    Used for deposits
    """
    from django.db import transaction as db_transaction
    
    try:
        # Check if this is a wallet deposit
        if payment.metadata.get('deposit_type') == 'wallet':
            wallet_id = payment.metadata.get('wallet_id')
            
            if wallet_id:
                with db_transaction.atomic():
                    wallet = Wallet.objects.select_for_update().get(id=wallet_id, user=payment.user)
                    
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
        
        return False
        
    except Exception as e:
        logger.error(f"Failed to credit wallet: {str(e)}")
        return False


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def stripe_webhook_view(request):
    """Handle Stripe webhooks"""
    payload = request.body
    sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        return Response({'error': 'Invalid payload'}, status=400)
    except stripe.error.SignatureVerificationError:
        return Response({'error': 'Invalid signature'}, status=400)
    
    # Handle the event
    if event['type'] == 'payment_intent.succeeded':
        payment_intent = event['data']['object']
        payment_id = payment_intent['metadata'].get('payment_id')
        
        if payment_id:
            try:
                payment = Payment.objects.get(id=payment_id)
                payment.mark_completed()
                credit_wallet_from_payment(payment)
            except Payment.DoesNotExist:
                pass
    
    return Response({'status': 'success'})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def paystack_webhook_view(request):
    """Handle Paystack webhooks"""
    event = request.data
    
    if event.get('event') == 'charge.success':
        reference = event['data']['reference']
        
        try:
            payment = Payment.objects.get(transaction_reference=reference)
            payment.mark_completed()
            credit_wallet_from_payment(payment)
        except Payment.DoesNotExist:
            pass
    
    return Response({'status': 'success'})


@api_view(['GET', 'POST'])
@permission_classes([permissions.AllowAny])
def paystack_callback_view(request):
    """Handle Paystack redirect callback."""
    return Response({
        'status': 'success',
        'message': 'Paystack payment completed. Your wallet will be updated when the webhook confirms the charge.'
    })


# Webhook views
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.http import HttpResponse
import logging

logger = logging.getLogger(__name__)

@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Handle Stripe webhook events"""
    payload = request.body
    sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
        
        # Handle the event
        if event['type'] == 'payment_intent.succeeded':
            payment_intent = event['data']['object']
            # Update payment status
            logger.info(f"Payment succeeded: {payment_intent['id']}")
            
        elif event['type'] == 'payment_intent.payment_failed':
            payment_intent = event['data']['object']
            # Handle failed payment
            logger.info(f"Payment failed: {payment_intent['id']}")
            
        return HttpResponse(status=200)
        
    except Exception as e:
        logger.error(f"Stripe webhook error: {str(e)}")
        return HttpResponse(status=400)


@csrf_exempt
@require_POST
def paystack_webhook(request):
    """Handle Paystack webhook events"""
    try:
        payload = json.loads(request.body)
        event = payload.get('event')
        
        if event == 'charge.success':
            # Handle successful payment
            logger.info(f"Paystack payment succeeded: {payload.get('data', {}).get('reference')}")
            
        elif event == 'charge.failed':
            # Handle failed payment
            logger.info(f"Paystack payment failed: {payload.get('data', {}).get('reference')}")
            
        return HttpResponse(status=200)
        
    except Exception as e:
        logger.error(f"Paystack webhook error: {str(e)}")
        return HttpResponse(status=400)


@csrf_exempt
@require_POST
def tingg_webhook(request):
    """Handle Tingg webhook events"""
    try:
        payload = json.loads(request.body)
        
        # Handle Tingg webhook
        logger.info(f"Tingg webhook received: {payload}")
        
        return HttpResponse(status=200)
        
    except Exception as e:
        logger.error(f"Tingg webhook error: {str(e)}")
        return HttpResponse(status=400)


@csrf_exempt
@require_POST
def lemonsqueezy_webhook(request):
    """Handle Lemonsqueezy webhook events"""
    try:
        payload = json.loads(request.body)
        
        # Handle Lemonsqueezy webhook
        logger.info(f"Lemonsqueezy webhook received: {payload}")
        
        return HttpResponse(status=200)
        
    except Exception as e:
        logger.error(f"Lemonsqueezy webhook error: {str(e)}")
        return HttpResponse(status=400)



@csrf_exempt
@require_POST
def pawapay_webhook(request):
    """
    Handle PawaPay webhook events with signature verification
    
    PawaPay sends callbacks for deposit status updates:
    - ACCEPTED: Deposit accepted by correspondent
    - COMPLETED: Deposit successfully completed
    - FAILED: Deposit failed
    - REJECTED: Deposit rejected by correspondent
    """
    import hashlib
    import hmac
    from django.db import transaction as db_transaction
    
    try:
        payload = json.loads(request.body)
        
        # Verify webhook signature if configured
        signature = request.META.get('HTTP_X_PAWAPAY_SIGNATURE', '')
        if hasattr(settings, 'PAWAPAY_WEBHOOK_SECRET') and settings.PAWAPAY_WEBHOOK_SECRET:
            expected_signature = hmac.new(
                settings.PAWAPAY_WEBHOOK_SECRET.encode(),
                request.body,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                logger.warning("PawaPay webhook signature verification failed")
                return HttpResponse(status=401)
        
        logger.info(f"PawaPay webhook received: {payload}")
        
        # Extract transaction information
        deposit_id = payload.get('depositId')
        payout_id = payload.get('payoutId')
        status = payload.get('status')
        
        # Handle deposit webhooks
        if deposit_id:
            if not deposit_id:
                logger.error("PawaPay webhook missing depositId")
                return HttpResponse(status=400)
            
            # Find payment by deposit_id stored in transaction_reference
            try:
                with db_transaction.atomic():
                    payment = Payment.objects.select_for_update().get(transaction_reference=deposit_id)
                    
                    # Idempotency check - prevent duplicate processing
                    if payment.status == 'completed' and status == 'COMPLETED':
                        logger.info(f"PawaPay payment {deposit_id} already completed, skipping")
                        return HttpResponse(status=200)
                    
                    # Update payment status based on PawaPay status
                    if status == 'COMPLETED':
                        payment.status = 'completed'
                        payment.completed_at = timezone.now()
                        payment.metadata['pawapay_callback'] = payload
                        payment.save()
                        
                        # Mark payment as completed (updates user earnings)
                        payment.mark_completed()
                        
                        # Credit wallet if this is a deposit (with idempotency check inside)
                        credit_wallet_from_payment(payment)
                        
                        logger.info(f"PawaPay payment {deposit_id} marked as completed")
            except Payment.DoesNotExist:
                logger.error(f"Payment not found for PawaPay deposit_id: {deposit_id}")
                return HttpResponse(status=404)
            
            if status in ['FAILED', 'REJECTED']:
                payment.status = 'failed'
                payment.metadata['pawapay_callback'] = payload
                payment.metadata['failure_reason'] = payload.get('failureReason', {})
                payment.save()
                
                logger.warning(f"PawaPay payment {deposit_id} failed: {payload.get('failureReason')}")
                
            elif status == 'ACCEPTED':
                payment.status = 'processing'
                payment.metadata['pawapay_callback'] = payload
                payment.save()
                
                logger.info(f"PawaPay payment {deposit_id} accepted and processing")
        
        # Handle payout webhooks (withdrawals)
        elif payout_id:
            try:
                with db_transaction.atomic():
                    withdrawal = Withdrawal.objects.select_for_update().get(transaction_id=payout_id)
                    
                    # Idempotency check
                    if withdrawal.status == 'completed' and status == 'COMPLETED':
                        logger.info(f"PawaPay payout {payout_id} already completed, skipping")
                        return HttpResponse(status=200)
                    
                    # Update withdrawal status based on PawaPay status
                    if status == 'COMPLETED':
                        withdrawal.status = 'completed'
                        withdrawal.completed_at = timezone.now()
                        if not withdrawal.provider_response:
                            withdrawal.provider_response = {}
                        withdrawal.provider_response['pawapay_callback'] = payload
                        withdrawal.save()
                        
                        logger.info(f"PawaPay payout {payout_id} marked as completed")
            except Withdrawal.DoesNotExist:
                logger.error(f"Withdrawal not found for PawaPay payout_id: {payout_id}")
                return HttpResponse(status=404)

            if status in ['FAILED', 'REJECTED']:
                withdrawal.status = 'failed'
                if not withdrawal.provider_response:
                    withdrawal.provider_response = {}
                withdrawal.provider_response['pawapay_callback'] = payload
                withdrawal.provider_response['failure_reason'] = payload.get('failureReason', {})
                withdrawal.save()
                
                # Refund wallet if withdrawal failed
                try:
                    wallet = Wallet.objects.get(user=withdrawal.user)
                    wallet.add_funds(
                        amount=withdrawal.amount,
                        transaction_type='refund',
                        description=f'Withdrawal refund - {withdrawal.provider}',
                        metadata={
                            'withdrawal_id': withdrawal.id,
                            'reason': 'Withdrawal failed',
                            'failure_reason': payload.get('failureReason', {})
                        }
                    )
                    logger.info(f"Refunded {withdrawal.amount} to wallet for failed withdrawal {payout_id}")
                except Exception as e:
                    logger.error(f"Failed to refund wallet: {str(e)}")
                
                logger.warning(f"PawaPay payout {payout_id} failed: {payload.get('failureReason')}")
                
            elif status == 'ACCEPTED':
                withdrawal.status = 'processing'
                if not withdrawal.provider_response:
                    withdrawal.provider_response = {}
                withdrawal.provider_response['pawapay_callback'] = payload
                withdrawal.save()
                
                logger.info(f"PawaPay payout {payout_id} accepted and processing")
        
        return HttpResponse(status=200)
        
    except json.JSONDecodeError:
        logger.error("PawaPay webhook invalid JSON")
        return HttpResponse(status=400)
    except Exception as e:
        logger.error(f"PawaPay webhook error: {str(e)}")
        return HttpResponse(status=500)



# ============================================================================
# WALLET VIEWS
# ============================================================================

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def wallet_balance_view(request):
    """Get user wallet balance"""
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Sync with user earnings
    if created or wallet.total_earned != request.user.total_earnings:
        wallet.total_earned = request.user.total_earnings
        wallet.save()
    
    return Response({
        'wallet': WalletSerializer(wallet).data,
        'user_earnings': str(request.user.total_earnings)
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def transaction_history_view(request):
    """Get user transaction history"""
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    # Get query parameters
    transaction_type = request.query_params.get('type', None)
    limit = int(request.query_params.get('limit', 50))
    
    # Filter transactions
    transactions = wallet.transactions.all()
    if transaction_type:
        transactions = transactions.filter(transaction_type=transaction_type)
    
    transactions = transactions[:limit]
    
    return Response({
        'transactions': TransactionSerializer(transactions, many=True).data,
        'count': transactions.count()
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def deposit_funds_view(request):
    """
    Deposit funds to wallet
    This initiates a payment and credits wallet on completion
    """
    from .models import Payment
    
    # Log authentication status
    logger.info(f"Deposit request from user: {request.user.id if request.user.is_authenticated else 'Anonymous'}")
    logger.info(f"Is authenticated: {request.user.is_authenticated}")
    logger.info(f"Auth header: {request.META.get('HTTP_AUTHORIZATION', 'Not provided')[:50]}")
    
    # Log the incoming data for debugging
    logger.info(f"Deposit request data: {request.data}")
    logger.info(f"Content-Type: {request.content_type}")
    
    # Manually validate each field
    errors = {}
    
    # Validate amount
    amount = request.data.get('amount')
    if not amount:
        errors['amount'] = ['This field is required.']
    else:
        try:
            amount = float(amount)
            if amount <= 0:
                errors['amount'] = ['Amount must be greater than 0.']
        except (ValueError, TypeError):
            errors['amount'] = ['Invalid amount format. Must be a number.']
    
    # Validate currency
    currency = request.data.get('currency', 'ZMW')
    valid_currencies = [c[0] for c in Payment.CURRENCY_CHOICES]
    if currency not in valid_currencies:
        errors['currency'] = [f'Invalid currency. Must be one of: {", ".join(valid_currencies)}']
    
    # Validate provider
    provider = request.data.get('provider')
    valid_providers = [p[0] for p in Payment.PROVIDER_CHOICES]
    if not provider:
        errors['provider'] = ['This field is required.']
    elif provider not in valid_providers:
        errors['provider'] = [f'Invalid provider. Must be one of: {", ".join(valid_providers)}']
    
    # If there are validation errors, return them
    if errors:
        logger.warning(f"Wallet deposit validation failed: {errors}")
        return Response({
            'error': 'Invalid deposit request',
            'details': errors,
            'hint': 'Make sure amount is a positive number, currency is valid (e.g., ZMW, USD), and provider is valid (e.g., stripe, paystack, pawapay)'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    serializer = DepositSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except ValidationError as exc:
        logger.warning(
            f"Wallet deposit validation failed for user {request.user.id}: {exc.detail}"
        )
        return Response({
            'error': 'Invalid deposit request',
            'details': exc.detail
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
    currency = serializer.validated_data.get('currency', 'USD')
    
    # Create payment record
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
    
    try:
        if provider == 'stripe':
            return handle_stripe_payment(payment, request)
        elif provider == 'paystack':
            return handle_paystack_payment(payment, request)
        elif provider == 'pawapay':
            # Extract PawaPay fields
            phone_number = serializer.validated_data.get('phone_number')
            correspondent = serializer.validated_data.get('correspondent')
            
            return handle_pawapay_payment(payment, phone_number, correspondent)
        else:
            return Response({
                'error': f'Provider {provider} not supported for deposits'
            }, status=status.HTTP_400_BAD_REQUEST)
            
    except Exception as e:
        payment.status = 'failed'
        payment.save()
        logger.exception(f'Deposit failed for payment {payment.id}')
        return Response({
            'error': 'Deposit processing failed. Please try again or contact support.'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def withdraw_funds_view(request):
    """
    Withdraw funds from wallet
    Enhanced version with wallet integration
    """
    serializer = WithdrawalRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    user = request.user
    amount = serializer.validated_data['amount']
    
    # Get wallet
    try:
        wallet = Wallet.objects.get(user=user)
    except Wallet.DoesNotExist:
        return Response({
            'error': 'Wallet not found'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Check if wallet is locked
    if wallet.is_locked:
        return Response({
            'error': f'Wallet is locked: {wallet.lock_reason}'
        }, status=status.HTTP_403_FORBIDDEN)
    
    # Check if user has sufficient balance
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
    
    try:
        # Deduct funds from wallet (pending)
        wallet.deduct_funds(
            amount=amount,
            transaction_type='withdrawal',
            description=f'Withdrawal via {withdrawal.provider}',
            metadata={
                'withdrawal_id': withdrawal.id,
                'provider': withdrawal.provider
            }
        )
        
        # Process withdrawal based on provider
        if withdrawal.provider in ['airtel', 'mtn', 'mpesa']:
            process_mobile_money_withdrawal(withdrawal)
        elif withdrawal.provider == 'bank':
            process_bank_withdrawal(withdrawal)
        elif withdrawal.provider == 'paypal':
            process_paypal_withdrawal(withdrawal)
        
        return Response({
            'withdrawal': WithdrawalSerializer(withdrawal).data,
            'wallet': WalletSerializer(wallet).data,
            'message': 'Withdrawal request submitted successfully'
        })
        
    except ValueError as e:
        return Response({
            'error': str(e)
        }, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        withdrawal.status = 'failed'
        withdrawal.save()
        
        # Refund to wallet if deduction was made
        try:
            wallet.add_funds(
                amount=amount,
                transaction_type='refund',
                description=f'Withdrawal refund - {str(e)}',
                metadata={'withdrawal_id': withdrawal.id}
            )
        except:
            pass
        
        return Response({
            'error': f'Withdrawal processing failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def add_game_earnings_view(request):
    """
    Add game earnings to wallet
    Called when user wins a game/challenge
    """
    amount = request.data.get('amount')
    game_type = request.data.get('game_type', 'challenge')
    game_id = request.data.get('game_id', '')
    
    if not amount or Decimal(str(amount)) <= 0:
        return Response({
            'error': 'Invalid amount'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Get or create wallet
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    
    try:
        # Add earnings to wallet
        wallet.add_funds(
            amount=amount,
            transaction_type='earning',
            description=f'Earnings from {game_type}',
            metadata={
                'game_type': game_type,
                'game_id': game_id
            }
        )
        
        # Also update user total_earnings
        request.user.total_earnings += Decimal(str(amount))
        request.user.save()
        
        return Response({
            'wallet': WalletSerializer(wallet).data,
            'message': f'Added {amount} {wallet.currency} to your wallet!'
        })
        
    except Exception as e:
        return Response({
            'error': f'Failed to add earnings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
