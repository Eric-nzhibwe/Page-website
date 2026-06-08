"""
Payment URLs for ARTX Platform
"""
from django.urls import path
from . import views
from .views import (
    PaymentHistoryView,
    WithdrawalHistoryView,
    wallet_balance_view,
    deposit_funds_view,
    withdraw_funds_view,
    transaction_history_view,
    add_game_earnings_view
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
    path('wallet/add-earnings/', add_game_earnings_view, name='add_earnings'),
    path('paystack/callback/', views.paystack_callback_view, name='paystack_callback'),
]
