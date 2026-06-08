"""
Payment webhook URLs for ARTX Platform
"""
from django.urls import path
from . import views

urlpatterns = [
    # Stripe webhooks
    path('stripe/', views.stripe_webhook, name='stripe_webhook'),
    
    # Paystack webhooks
    path('paystack/', views.paystack_webhook, name='paystack_webhook'),
    
    # Tingg webhooks
    path('tingg/', views.tingg_webhook, name='tingg_webhook'),
    
    # Lemonsqueezy webhooks
    path('lemonsqueezy/', views.lemonsqueezy_webhook, name='lemonsqueezy_webhook'),
    
    # PawaPay webhooks
    path('pawapay/', views.pawapay_webhook, name='pawapay_webhook'),
]