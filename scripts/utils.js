// ARTX Platform - Utility Functions

/**
 * Sanitize HTML to prevent XSS attacks
 * @param {string} html - Raw HTML string
 * @returns {string} - Sanitized HTML
 */
function sanitizeHTML(html) {
    const temp = document.createElement('div');
    temp.textContent = html;
    return temp.innerHTML;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHTML(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Validate phone number (international format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidPhone(phone) {
    const re = /^\+?[1-9]\d{1,14}$/;
    return re.test(phone.replace(/[\s-]/g, ''));
}

/**
 * Get CSRF token from cookies
 * @returns {string|null} - CSRF token or null
 */
function getCSRFToken() {
    const cookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='));
    return cookie ? cookie.split('=')[1] : null;
}

/**
 * Format currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: ZMW)
 * @returns {string} - Formatted currency string
 */
function formatCurrency(amount, currency = 'ZMW') {
    return `${currency} ${parseFloat(amount).toFixed(2)}`;
}

/**
 * Format date relative to now
 * @param {Date} date - Date to format
 * @returns {string} - Relative time string
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} - Throttled function
 */
function throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Show notification toast
 * @param {string} message - Message to display
 * @param {string} type - Type: success, error, info, warning
 * @param {number} duration - Duration in ms (default: 3000)
 */
function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#2196f3'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

/**
 * Handle API errors consistently
 * @param {Error} error - Error object
 * @param {string} userMessage - User-friendly message
 */
function handleAPIError(error, userMessage = 'An error occurred') {
    console.error('API Error:', error);
    showNotification(userMessage, 'error');
    
    // Optional: Send to error tracking service
    // if (window.Sentry) {
    //     Sentry.captureException(error);
    // }
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Copied to clipboard!', 'success');
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        showNotification('Failed to copy', 'error');
        return false;
    }
}

/**
 * Generate random ID
 * @returns {string} - Random ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Check if user is on mobile device
 * @returns {boolean} - True if mobile
 */
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 50) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
}

// Export functions
window.sanitizeHTML = sanitizeHTML;
window.escapeHTML = escapeHTML;
window.isValidEmail = isValidEmail;
window.isValidPhone = isValidPhone;
window.getCSRFToken = getCSRFToken;
window.formatCurrency = formatCurrency;
window.formatRelativeTime = formatRelativeTime;
window.debounce = debounce;
window.throttle = throttle;
window.showNotification = showNotification;
window.handleAPIError = handleAPIError;
window.copyToClipboard = copyToClipboard;
window.generateId = generateId;
window.isMobile = isMobile;
window.truncateText = truncateText;

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
