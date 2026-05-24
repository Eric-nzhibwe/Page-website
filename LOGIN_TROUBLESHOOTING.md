# Login Troubleshooting Guide

## Issue: Cannot Login to Account

### Root Causes

1. **OTP Email Not Sending**
   - Email configuration might be incorrect
   - SMTP credentials not set in environment
   - Email service not running

2. **OTP Verification Page Missing**
   - `otp-verification.html` might not exist
   - Frontend redirect failing

3. **Token Not Being Stored**
   - localStorage not saving token
   - Browser storage disabled

4. **API Endpoint Issues**
   - CORS not configured properly
   - API base URL incorrect

### Solutions

#### Solution 1: Disable OTP for Testing (Temporary)

Edit `django_backend/users/views.py` in the `login_view` function:

```python
@csrf_exempt
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_view(request):
    """User login endpoint"""
    print(f"🔐 Login request received: {request.method}")
    print(f"📊 Request data: {request.data}")
    
    serializer = UserLoginSerializer(data=request.data)
    
    if not serializer.is_valid():
        print(f"❌ Serializer errors: {serializer.errors}")
        return Response({
            'error': 'Invalid data',
            'details': serializer.errors,
        }, status=status.HTTP_400_BAD_REQUEST)
    
    user = serializer.validated_data['user']
    
    # TEMPORARY: Skip OTP for testing
    # TODO: Remove this after testing
    login(request, user)
    token, created = Token.objects.get_or_create(user=user)
    
    return Response({
        'user': UserProfileSerializer(user).data,
        'token': token.key,
        'message': f'Welcome back, {user.username}! 🔥'
    })
```

#### Solution 2: Check Email Configuration

Verify email settings in `django_backend/artx_platform/settings.py`:

```python
# Email Configuration
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'  # or your email provider
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = 'your-email@gmail.com'
EMAIL_HOST_PASSWORD = 'your-app-password'  # Use app-specific password for Gmail
DEFAULT_FROM_EMAIL = 'noreply@artx.com'
```

Set environment variables:
```bash
export EMAIL_HOST_USER="your-email@gmail.com"
export EMAIL_HOST_PASSWORD="your-app-password"
```

#### Solution 3: Create OTP Verification Page

Create `pages/otp-verification.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify OTP - ARTX</title>
    <link rel="stylesheet" href="../styles/auth.css">
</head>
<body>
    <div class="auth-container">
        <div class="auth-card">
            <h1>🔐 Verify Your Identity</h1>
            <p id="contactInfo"></p>
            
            <form id="otpForm" onsubmit="handleOTPVerification(event)">
                <div class="form-group">
                    <label>Enter 6-Digit Code</label>
                    <input type="text" id="otpInput" maxlength="6" placeholder="000000" required>
                </div>
                
                <button type="submit" class="btn-primary">Verify</button>
                <button type="button" class="btn-secondary" onclick="resendOTP()">Resend Code</button>
            </form>
            
            <p id="errorMessage" style="color: red; display: none;"></p>
        </div>
    </div>
    
    <script src="../scripts/auth.js"></script>
    <script>
        // Load pending auth data
        const pendingAuth = JSON.parse(localStorage.getItem('pendingAuth') || '{}');
        document.getElementById('contactInfo').textContent = `Code sent to ${pendingAuth.contact}`;
        
        async function handleOTPVerification(event) {
            event.preventDefault();
            
            const otp = document.getElementById('otpInput').value;
            const errorMsg = document.getElementById('errorMessage');
            
            try {
                const response = await fetch(`${API_BASE_URL}/auth/verify-otp/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: pendingAuth.session_id,
                        otp: otp,
                        username: pendingAuth.username
                    })
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    errorMsg.textContent = data.error || 'Invalid OTP';
                    errorMsg.style.display = 'block';
                    return;
                }
                
                // Save token and redirect
                localStorage.setItem('djangoAuthToken', data.token);
                localStorage.removeItem('pendingAuth');
                window.location.href = '../index.html';
                
            } catch (error) {
                errorMsg.textContent = 'Error verifying OTP: ' + error.message;
                errorMsg.style.display = 'block';
            }
        }
        
        async function resendOTP() {
            try {
                const response = await fetch(`${API_BASE_URL}/auth/resend-otp/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: pendingAuth.session_id,
                        username: pendingAuth.username
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    alert('Code resent successfully!');
                } else {
                    alert('Error: ' + (data.error || 'Could not resend code'));
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
    </script>
</body>
</html>
```

#### Solution 4: Check Browser Console

Open browser DevTools (F12) and check:

1. **Console tab** - Look for JavaScript errors
2. **Network tab** - Check API requests:
   - POST to `/api/auth/login/` should return 200 or 400
   - Check response body for error details
3. **Application tab** - Check localStorage:
   - `djangoAuthToken` should be set after login
   - `pendingAuth` should be set if OTP required

#### Solution 5: Test Login via cURL

```bash
# Test login endpoint
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your-username",
    "password": "your-password"
  }'

# Expected response (if OTP required):
{
  "requires_otp": true,
  "session_id": "...",
  "contact": "your-email@example.com",
  "message": "OTP sent to your email. Please verify to continue."
}

# Expected response (if OTP disabled):
{
  "user": {...},
  "token": "your-token-here",
  "message": "Welcome back!"
}
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid credentials" | Wrong username/password | Check credentials |
| "User account is disabled" | User is_active=False | Enable user in admin |
| "OTP expired or invalid session" | OTP cache expired | Request new OTP |
| "Maximum attempts exceeded" | Too many wrong OTP attempts | Request new OTP |
| "CORS error" | CORS not configured | Check CORS_ALLOWED_ORIGINS |
| "Cannot POST /api/auth/login/" | URL routing issue | Check urls.py configuration |

### Debug Checklist

- [ ] Check Django server is running: `python manage.py runserver`
- [ ] Check API is accessible: `curl http://localhost:8000/api/auth/login/`
- [ ] Check email configuration in settings.py
- [ ] Check environment variables are set
- [ ] Check browser console for errors (F12)
- [ ] Check network requests in DevTools
- [ ] Check localStorage in DevTools Application tab
- [ ] Check Django logs for error messages
- [ ] Verify user exists in database: `python manage.py shell`
  ```python
  from users.models import User
  User.objects.filter(username='your-username').exists()
  ```

### Quick Fix for Testing

To quickly test without OTP:

1. Edit `users/views.py` login_view function
2. Comment out OTP code
3. Return token directly
4. Test login
5. Re-enable OTP when ready

### Production Considerations

- Always enable OTP for security
- Use environment variables for email credentials
- Implement rate limiting on login attempts
- Log all authentication attempts
- Monitor for suspicious activity
- Use HTTPS only
- Set secure cookie flags

### Support

If issues persist:

1. Check Django logs: `tail -f logs/artx.log`
2. Enable DEBUG mode temporarily
3. Add print statements to views.py
4. Check database: `python manage.py dbshell`
5. Test with Postman or cURL first
6. Check email service status

---

**Last Updated:** May 24, 2026
