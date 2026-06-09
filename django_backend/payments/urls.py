"""
Payment URLs — ARTX Platform
"""
from django.urls import path
from . import views

app_name = 'payments'

urlpatterns = [
    # Deposit & Withdrawal
    path('wallet/deposit/',  views.deposit_funds_view,  name='deposit_funds'),
    path('wallet/withdraw/', views.withdraw_funds_view, name='withdraw_funds'),

    # Wallet
    path('wallet/',              views.wallet_balance_view,     name='wallet_balance'),
    path('wallet/transactions/', views.transaction_history_view, name='transaction_history'),
    path('wallet/add-earnings/', views.add_game_earnings_view,  name='add_earnings'),
    path('wallet/limits/',       views.withdrawal_limits_view,  name='withdrawal_limits'),

    # History
    path('history/',     views.PaymentHistoryView.as_view(),    name='payment_history'),
    path('withdrawals/', views.WithdrawalHistoryView.as_view(), name='withdrawal_history'),

    # Status polling
    path('status/<int:payment_id>/',               views.payment_status_view,    name='payment_status'),
    path('withdrawals/<int:withdrawal_id>/status/', views.withdrawal_status_view, name='withdrawal_status'),

    # Audit log
    path('audit/<int:payment_id>/', views.payment_audit_log_view, name='payment_audit'),

    # Legacy aliases
    path('initiate/', views.deposit_funds_view,        name='initiate_payment'),
    path('withdraw/', views.withdraw_funds_view,        name='request_withdrawal'),
    path('paystack/callback/', views.paystack_callback_view, name='paystack_callback'),
]
