// Authentication System - Django Backend Integration

// API Base URL - Dynamic detection for production
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

// Check if user is already logged in
document.addEventListener('DOMContentLoaded', () => {
    // Clear any old localStorage data first
    clearOldLocalStorageData();
    
    // Check for valid Django session
    checkAuthStatus();
    
    // Remove splash screen after animation
    setTimeout(() => {
        const splashScreen = document.getElementById('splashScreen');
        if (splashScreen) {
            splashScreen.remove();
        }
    }, 2500);
});

// Clear old localStorage data to force Django backend usage
function clearOldLocalStorageData() {
    const keysToRemove = [
        'artCurrentUser',
        'artUsers',
        'artPlayer_',
        'artSocialConnections_'
    ];
    
    // Remove specific keys
    keysToRemove.forEach(key => {
        if (key.endsWith('_')) {
            // Remove all keys that start with this prefix
            Object.keys(localStorage).forEach(storageKey => {
                if (storageKey.startsWith(key)) {
                    localStorage.removeItem(storageKey);
                }
            });
        } else {
            localStorage.removeItem(key);
        }
    });
    
    console.log('🧹 Cleared old localStorage data - now using Django backend');
}

// Check authentication status with Django backend
async function checkAuthStatus() {
    const token = localStorage.getItem('djangoAuthToken');
    
    if (!token) {
        console.log('No auth token found');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
            method: 'GET',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const userData = await response.json();
            console.log('User authenticated:', userData);
            // Redirect to main app if on auth page
            if (window.location.pathname.includes('auth.html')) {
                window.location.href = '../index.html';
            }
        } else {
            // Invalid token, remove it
            localStorage.removeItem('djangoAuthToken');
            console.log('Invalid auth token removed');
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('djangoAuthToken');
    }
}

// Load social connections for current user (placeholder for future implementation)
function loadSocialConnections() {
    console.log('Social connections feature - coming soon with Django backend integration');
}

// Social media connection functions (placeholder for future implementation)
function renderSocialConnections(connections) {
    console.log('Social connections rendering - coming soon');
}

function getPlatformIcon(platformId) {
    const icons = {
        'instagram': 'fab fa-instagram',
        'facebook': 'fab fa-facebook-f',
        'twitter': 'fab fa-twitter',
        'tiktok': 'fab fa-tiktok',
        'youtube': 'fab fa-youtube'
    };
    return icons[platformId] || 'fab fa-question';
}

function connectSocialMedia(platform) {
    alert('Social media connections coming soon with full Django backend integration!');
}

function disconnectSocialMedia(platform) {
    alert('Social media connections coming soon with full Django backend integration!');
}

// Show auth page (login/signup forms)
function showAuthPage() {
    const landingPage = document.getElementById('landingPage');
    const authContainer = document.querySelector('.auth-container');
    
    if (landingPage) {
        landingPage.style.animation = 'fadeOut 0.5s ease-in-out forwards';
        setTimeout(() => {
            landingPage.style.display = 'none';
            authContainer.style.display = 'grid';
            authContainer.style.animation = 'fadeInContent 0.5s ease-in-out forwards';
        }, 500);
    }
}

// Show about page (placeholder)
function showAbout() {
    alert('About page - Coming soon!');
}

// Show contact page (placeholder)
function showContact() {
    alert('Contact page - Coming soon!');
}

// Switch between login and signup
function switchToSignup() {
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('signupForm').classList.add('active');
}

function switchToLogin() {
    document.getElementById('signupForm').classList.remove('active');
    document.getElementById('loginForm').classList.add('active');
}

// Handle Signup - Django Backend Integration with Mobile Optimization
async function handleSignup(event) {
    event.preventDefault();
    
    const username = document.getElementById('signupUsername').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    
    // Validation
    if (username.length < 3) {
        alert('Username must be at least 3 characters long');
        return;
    }
    
    if (!email || !email.includes('@')) {
        alert('Please enter a valid email address');
        return;
    }
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }
    
    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }
    
    // Show loading state
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Creating Account...';
    submitBtn.disabled = true;
    
    try {
        // Register with Django backend - with timeout and retry
        const response = await fetchWithRetry(`${API_BASE_URL}/auth/register/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                email: email,
                display_name: username,
                password: password
            }),
            timeout: 15000,
            retries: 2
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            let errorMessage = data.error || data.message || 'Registration failed';
            
            if (data.details) {
                if (data.details.username) {
                    errorMessage = 'Username already taken';
                } else if (data.details.email) {
                    errorMessage = 'Email already registered';
                }
            }
            
            throw new Error(errorMessage);
        }
        
        console.log('Registration successful:', data);
        
        // Store the Django auth token
        if (data.token) {
            localStorage.setItem('djangoAuthToken', data.token);
        }
        
        alert('🎉 Account created successfully! Welcome to ARTX!\n\n📧 Check your email for a welcome message!');
        
        // Offer to pay registration fee now
        const payNow = confirm('Would you like to pay the registration fee now to unlock full features?');
        if (payNow) {
            // Ask for payment method
            const paymentMethod = prompt('Select payment method:\n\n1. Card (Stripe)\n2. Mobile Money (PawaPay)\n\nEnter 1 or 2:');
            
            if (paymentMethod === '1') {
                await initiatePayment(5, 'ZMW', 'stripe');
            } else if (paymentMethod === '2') {
                showPawapayPaymentForm();
            } else {
                alert('Invalid selection. You can pay later from your profile.');
            }
            return;
        }
        
        // Redirect to main app
        window.location.href = '../index.html';
        
    } catch (error) {
        console.error('Registration error:', error);
        alert(`Registration failed: ${error.message}`);
    } finally {
        // Reset button state
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}


// Initiate payment by calling Django backend /api/payments/initiate/
async function initiatePayment(amount = 5, currency = 'ZMW', provider = 'stripe', phoneNumber = '', correspondent = '') {
    try {
        const token = localStorage.getItem('djangoAuthToken');
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = `Token ${token}`;
        }
        
        const paymentData = {
            amount: amount, 
            currency: currency, 
            provider: provider
        };
        
        // Add PawaPay specific fields
        if (provider === 'pawapay') {
            if (!phoneNumber) {
                alert('Phone number is required for mobile money payments');
                return;
            }
            if (!correspondent) {
                alert('Please select your mobile money provider');
                return;
            }
            paymentData.phone_number = phoneNumber;
            paymentData.correspondent = correspondent;
        }
        
        const resp = await fetch(`${API_BASE_URL}/payments/initiate/`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(paymentData)
        });
        
        const data = await resp.json();
        if (!resp.ok) {
            alert('Failed to initiate payment: ' + (data.error || resp.statusText));
            return;
        }
        
        if (provider === 'pawapay') {
            // For PawaPay, show success message and instructions
            alert(`✅ Payment initiated!\n\n📱 Check your phone (${phoneNumber}) to complete the payment.\n\nDeposit ID: ${data.deposit_id}\nStatus: ${data.status}`);
            return;
        }
        
        if (data.payment_url) {
            // Redirect user to provider checkout
            window.location.href = data.payment_url;
            return;
        }
        
        alert('Payment initiation response: ' + JSON.stringify(data));
    } catch (e) {
        console.error('Payment initiation error', e);
        alert('Payment initiation error: ' + e.message);
    }
}

// Show PawaPay payment form
function showPawapayPaymentForm() {
    const phoneNumber = prompt('Enter your mobile money phone number (e.g., +260977123456):');
    if (!phoneNumber) return;
    
    // Detect country from phone code
    const countryCorrespondents = {
        '+260': [
            { value: 'MTN_MOMO_ZMB', label: 'MTN Mobile Money' },
            { value: 'AIRTEL_OAPI_ZMB', label: 'Airtel Money' }
        ],
        '+255': [
            { value: 'VODACOM_MPESA_TZA', label: 'M-Pesa' },
            { value: 'AIRTEL_OAPI_TZA', label: 'Airtel Money' },
            { value: 'TIGO_TZA', label: 'Tigo Pesa' }
        ],
        '+254': [
            { value: 'SAFARICOM_MPESA_KEN', label: 'M-Pesa' },
            { value: 'AIRTEL_OAPI_KEN', label: 'Airtel Money' }
        ],
        '+256': [
            { value: 'MTN_MOMO_UGA', label: 'MTN Mobile Money' },
            { value: 'AIRTEL_OAPI_UGA', label: 'Airtel Money' }
        ],
        '+233': [
            { value: 'MTN_MOMO_GHA', label: 'MTN Mobile Money' },
            { value: 'VODAFONE_GHA', label: 'Vodafone Cash' },
            { value: 'AIRTEL_OAPI_GHA', label: 'Airtel Money' }
        ],
        '+234': [
            { value: 'MTN_MOMO_NGA', label: 'MTN Mobile Money' },
            { value: 'AIRTEL_OAPI_NGA', label: 'Airtel Money' }
        ],
        '+27': [
            { value: 'VODACOM_MPESA_ZAF', label: 'Vodacom M-Pesa' }
        ]
    };
    
    // Find correspondents for country
    let correspondents = [];
    for (const [code, corrs] of Object.entries(countryCorrespondents)) {
        if (phoneNumber.startsWith(code)) {
            correspondents = corrs;
            break;
        }
    }
    
    if (correspondents.length === 0) {
        alert('Sorry, mobile money is not supported for this country yet.');
        return;
    }
    
    // Show correspondent selection
    let message = 'Select your mobile money provider:\n\n';
    correspondents.forEach((corr, index) => {
        message += `${index + 1}. ${corr.label}\n`;
    });
    
    const selection = prompt(message + '\nEnter number (1-' + correspondents.length + '):');
    if (!selection) return;
    
    const index = parseInt(selection) - 1;
    if (index < 0 || index >= correspondents.length) {
        alert('Invalid selection');
        return;
    }
    
    const correspondent = correspondents[index].value;
    
    // Initiate payment
    initiatePayment(5, 'ZMW', 'pawapay', phoneNumber, correspondent);
}

// Handle Login - Django Backend Integration with Mobile Optimization
async function handleLogin(event) {
    event.preventDefault();
    
    const usernameOrEmail = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    // Client-side validation
    if (!usernameOrEmail) {
        alert('Please enter your email or username');
        return;
    }
    
    if (!password) {
        alert('Please enter your password');
        return;
    }
    
    // Show loading state
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Logging in...';
    submitBtn.disabled = true;
    
    try {
        // Login with Django backend - with timeout and retry
        const response = await fetchWithRetry(`${API_BASE_URL}/auth/login/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: usernameOrEmail,
                password: password
            }),
            timeout: 15000, // 15 second timeout for mobile networks
            retries: 2 // Retry up to 2 times on network failure
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            // Provide specific error messages based on response
            let errorMessage = data.message || data.error || 'Login failed';
            
            if (response.status === 400) {
                // Bad request - validation error
                if (data.details) {
                    if (data.details.username) {
                        errorMessage = 'Email or username not found';
                    } else if (data.details.password) {
                        errorMessage = 'Password is incorrect';
                    }
                }
            } else if (response.status === 429) {
                errorMessage = 'Too many login attempts. Please try again later.';
            } else if (response.status === 500) {
                errorMessage = 'Server error. Please try again later.';
            }
            
            throw new Error(errorMessage);
        }
        
        console.log('Login successful:', data);
        
        // Check if OTP is required
        if (data.requires_otp) {
            // Store pending auth data for OTP verification
            localStorage.setItem('pendingAuth', JSON.stringify({
                username: usernameOrEmail,
                contact: data.contact || data.email,
                session_id: data.session_id
            }));
            
            // Redirect to OTP verification page
            window.location.href = 'otp-verification.html';
            return;
        }
        
        // If no OTP required, proceed with normal login
        if (data.token) {
            localStorage.setItem('djangoAuthToken', data.token);
        }
        
        // Get user profile to show welcome message
        try {
            const userResponse = await fetchWithRetry(`${API_BASE_URL}/auth/profile/`, {
                method: 'GET',
                headers: {
                    'Authorization': `Token ${data.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000,
                retries: 1
            });
            
            if (userResponse.ok) {
                const userData = await userResponse.json();
                alert(`Welcome back, ${userData.username}! 🔥 Ready to dominate the leaderboards?`);
            }
        } catch (profileError) {
            console.warn('Could not fetch profile:', profileError);
            // Don't fail login if profile fetch fails
        }
        
        // Redirect to main app
        window.location.href = '../index.html';
        
    } catch (error) {
        console.error('Login error:', error);
        alert(`Login failed: ${error.message}`);
    } finally {
        // Reset button state
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

// Fetch with retry logic for mobile networks
async function fetchWithRetry(url, options = {}) {
    const { timeout = 15000, retries = 2, ...fetchOptions } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response;
            
        } catch (error) {
            clearTimeout(timeoutId);
            lastError = error;
            
            // Check if it's a network error or timeout
            if (error.name === 'AbortError') {
                lastError = new Error('Request timeout - slow network connection');
            }
            
            // Only retry on network errors, not on other errors
            if (attempt < retries && (error.name === 'AbortError' || error.name === 'TypeError')) {
                console.warn(`Attempt ${attempt + 1} failed, retrying...`, error.message);
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            
            throw lastError;
        }
    }
    
    throw lastError;
}

// Simple password hashing (for demo purposes - use proper backend in production)
function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

// Make functions global
window.switchToSignup = switchToSignup;
window.switchToLogin = switchToLogin;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.showAuthPage = showAuthPage;
window.showAbout = showAbout;
window.showContact = showContact;


// Export PawaPay payment form function
window.showPawapayPaymentForm = showPawapayPaymentForm;
window.initiatePayment = initiatePayment;
