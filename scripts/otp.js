// OTP Verification - ARTX Platform

const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let resendTimer = null;
let resendCountdown = 60;

// Initialize OTP page
document.addEventListener('DOMContentLoaded', () => {
    // Check if user came from login
    const pendingAuth = localStorage.getItem('pendingAuth');
    if (!pendingAuth) {
        window.location.href = 'auth.html';
        return;
    }

    const authData = JSON.parse(pendingAuth);
    
    // Display user contact (email or phone)
    const contactEl = document.getElementById('userContact');
    if (contactEl && authData.contact) {
        contactEl.textContent = maskContact(authData.contact);
    }

    // Setup OTP inputs
    setupOTPInputs();
    
    // Start resend timer
    startResendTimer();
    
    // Auto-focus first input
    document.getElementById('otp1').focus();
});

// Setup OTP input behavior
function setupOTPInputs() {
    const inputs = document.querySelectorAll('.otp-input');
    
    inputs.forEach((input, index) => {
        // Handle input
        input.addEventListener('input', (e) => {
            const value = e.target.value;
            
            // Only allow numbers
            if (!/^\d*$/.test(value)) {
                e.target.value = '';
                return;
            }
            
            // Mark as filled
            if (value) {
                e.target.classList.add('filled');
                e.target.classList.remove('error');
                
                // Move to next input
                if (index < inputs.length - 1) {
                    inputs[index + 1].focus();
                } else {
                    // All inputs filled, auto-submit
                    const otp = getOTPValue();
                    if (otp.length === 6) {
                        verifyOTP(new Event('submit'));
                    }
                }
            } else {
                e.target.classList.remove('filled');
            }
        });
        
        // Handle backspace
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].value = '';
                inputs[index - 1].classList.remove('filled');
            }
            
            // Clear error on any key
            if (e.target.classList.contains('error')) {
                inputs.forEach(inp => inp.classList.remove('error'));
                hideError();
            }
        });
        
        // Handle paste
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedData = e.clipboardData.getData('text').trim();
            
            // Check if it's a 6-digit number
            if (/^\d{6}$/.test(pastedData)) {
                // Fill all inputs
                pastedData.split('').forEach((digit, i) => {
                    if (inputs[i]) {
                        inputs[i].value = digit;
                        inputs[i].classList.add('filled');
                    }
                });
                
                // Focus last input
                inputs[5].focus();
                
                // Auto-submit
                setTimeout(() => {
                    verifyOTP(new Event('submit'));
                }, 300);
            }
        });
    });
}

// Get OTP value from inputs
function getOTPValue() {
    const inputs = document.querySelectorAll('.otp-input');
    return Array.from(inputs).map(input => input.value).join('');
}

// Verify OTP
async function verifyOTP(event) {
    event.preventDefault();
    
    const otp = getOTPValue();
    
    // Validate OTP length
    if (otp.length !== 6) {
        showError('Please enter all 6 digits');
        return;
    }
    
    // Get pending auth data
    const pendingAuth = localStorage.getItem('pendingAuth');
    if (!pendingAuth) {
        showError('Session expired. Please login again.');
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 2000);
        return;
    }
    
    const authData = JSON.parse(pendingAuth);
    
    // Show loading state
    setLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-otp/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: authData.username,
                otp: otp,
                session_id: authData.session_id
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || data.message || 'Invalid OTP');
        }
        
        // OTP verified successfully
        console.log('OTP verified:', data);
        
        // Store auth token
        if (data.token) {
            localStorage.setItem('djangoAuthToken', data.token);
        }
        
        // Clear pending auth
        localStorage.removeItem('pendingAuth');
        
        // Show success
        showSuccess();
        
        // Redirect to main app
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 1500);
        
    } catch (error) {
        console.error('OTP verification error:', error);
        showError(error.message);
        markInputsAsError();
        setLoading(false);
    }
}

// Resend OTP
async function resendOTP() {
    const resendBtn = document.getElementById('resendBtn');
    
    if (resendBtn.disabled) return;
    
    const pendingAuth = localStorage.getItem('pendingAuth');
    if (!pendingAuth) {
        showError('Session expired. Please login again.');
        return;
    }
    
    const authData = JSON.parse(pendingAuth);
    
    // Disable button
    resendBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/resend-otp/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: authData.username,
                session_id: authData.session_id
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to resend OTP');
        }
        
        // Update session ID if provided
        if (data.session_id) {
            authData.session_id = data.session_id;
            localStorage.setItem('pendingAuth', JSON.stringify(authData));
        }
        
        // Show success notification
        if (window.showNotification) {
            showNotification('OTP sent successfully! Check your email.', 'success');
        } else {
            alert('OTP sent successfully! Check your email.');
        }
        
        // Clear inputs
        clearOTPInputs();
        
        // Restart timer
        startResendTimer();
        
    } catch (error) {
        console.error('Resend OTP error:', error);
        showError(error.message);
        resendBtn.disabled = false;
    }
}

// Start resend timer
function startResendTimer() {
    const resendBtn = document.getElementById('resendBtn');
    const timerEl = document.getElementById('resendTimer');
    const countEl = document.getElementById('timerCount');
    
    resendBtn.style.display = 'none';
    timerEl.style.display = 'block';
    
    resendCountdown = 60;
    countEl.textContent = resendCountdown;
    
    if (resendTimer) clearInterval(resendTimer);
    
    resendTimer = setInterval(() => {
        resendCountdown--;
        countEl.textContent = resendCountdown;
        
        if (resendCountdown <= 0) {
            clearInterval(resendTimer);
            resendBtn.style.display = 'inline-flex';
            resendBtn.disabled = false;
            timerEl.style.display = 'none';
        }
    }, 1000);
}

// Show error message
function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    
    errorText.textContent = message;
    errorEl.style.display = 'flex';
    
    // Hide after 5 seconds
    setTimeout(() => {
        hideError();
    }, 5000);
}

// Hide error message
function hideError() {
    const errorEl = document.getElementById('errorMessage');
    errorEl.style.display = 'none';
}

// Mark inputs as error
function markInputsAsError() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach(input => {
        input.classList.add('error');
        input.classList.remove('filled');
    });
    
    // Clear inputs
    setTimeout(() => {
        clearOTPInputs();
        document.getElementById('otp1').focus();
    }, 500);
}

// Clear OTP inputs
function clearOTPInputs() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach(input => {
        input.value = '';
        input.classList.remove('filled', 'error');
    });
    document.getElementById('otp1').focus();
}

// Show success animation
function showSuccess() {
    const logo = document.querySelector('.otp-logo');
    logo.innerHTML = '<i class="fas fa-check success-icon"></i>';
    logo.style.background = 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
    
    const title = document.querySelector('.otp-card h1');
    title.textContent = 'Verification Successful!';
    title.style.color = '#4caf50';
    
    const subtitle = document.querySelector('.otp-subtitle');
    subtitle.innerHTML = 'Redirecting to your dashboard...';
}

// Set loading state
function setLoading(loading) {
    const verifyBtn = document.getElementById('verifyBtn');
    const btnText = verifyBtn.querySelector('.btn-text');
    const btnLoader = verifyBtn.querySelector('.btn-loader');
    
    if (loading) {
        verifyBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
    } else {
        verifyBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
    }
}

// Mask contact (email or phone)
function maskContact(contact) {
    if (contact.includes('@')) {
        // Email
        const [username, domain] = contact.split('@');
        const maskedUsername = username.charAt(0) + '***' + username.charAt(username.length - 1);
        return `${maskedUsername}@${domain}`;
    } else {
        // Phone
        const visible = contact.slice(-4);
        return `***${visible}`;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (resendTimer) {
        clearInterval(resendTimer);
    }
});

// Export functions
window.verifyOTP = verifyOTP;
window.resendOTP = resendOTP;
