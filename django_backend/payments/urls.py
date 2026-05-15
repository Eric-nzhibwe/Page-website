"""
Payment URLs for ARTX Platform
"""
from django.urls import path
from . views import (
    wallet_balance_view,
    deposit_funds_view,
    withdraw_funds_view,
    transaction_history_view,
    payment_history_view
)

app_name = 'payments'

urlpatterns = [
    # Payment endpoints
    path('history/', views.PaymentHistoryView.as_view(), name='payment_history'),
    path('initiate/', views.initiate_payment_view, name='initiate_payment'),
    
    # Withdrawal endpoints
    path('withdrawals/', views.WithdrawalHistoryView.as_view(), name='withdrawal_history'),
    path('withdraw/', views.request_withdrawal_view, name='request_withdrawal'),
    
    # Wallet endpoints
    path('wallet/', views.wallet_balance_view, name='wallet_balance'),
    path('wallet/transactions/', views.transaction_history_view, name='transaction_history'),
    path('wallet/deposit/', views.deposit_funds_view, name='deposit_funds'),
    path('wallet/withdraw/', views.withdraw_funds_view, name='withdraw_funds'),
    path('wallet/add-earnings/', views.add_game_earnings_view, name='add_earnings'),
    path('paystack/callback/', views.paystack_callback_view, name='paystack_callback'),
    
    # Webhook endpoints
    path('webhooks/stripe/', views.stripe_webhook_view, name='stripe_webhook'),
    path('webhooks/paystack/', views.paystack_webhook_view, name='paystack_webhook'),
]
