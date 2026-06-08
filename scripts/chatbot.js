// AI Chatbot - Django Backend Integration

// API key should be stored in backend, not exposed in frontend!
const CHATBOT_API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let conversationId = null;
let messageHistory = [];

// Initialize chatbot
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('djangoAuthToken');

    if (!token) {
        alert('Please login to use the AI Assistant');
        window.location.href = 'auth.html';
        return;
    }

    // Auto-resize textarea
    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateCharCount();
        toggleSuggestions();
    });

    // Load conversation history
    loadConversationHistory();

    // Show suggestions initially
    toggleSuggestions();
});

// Auto-resize textarea
function autoResizeTextarea() {
    const textarea = document.getElementById('messageInput');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Update character count
function updateCharCount() {
    const input = document.getElementById('messageInput');
    const charCount = document.getElementById('charCount');
    charCount.textContent = `${input.value.length}/500`;

    if (input.value.length > 450) {
        charCount.style.color = '#ff7675';
    } else {
        charCount.style.color = '#636e72';
    }
}

// Toggle suggestions visibility
function toggleSuggestions() {
    const input = document.getElementById('messageInput');
    const suggestions = document.getElementById('suggestions');
    const quickActions = document.getElementById('quickActions');

    if (input.value.trim() === '' && messageHistory.length <= 1) {
        suggestions.style.display = 'block';
        quickActions.style.display = 'flex';
    } else {
        suggestions.style.display = 'none';
        if (messageHistory.length > 1) {
            quickActions.style.display = 'none';
        }
    }
}

// Send message
async function sendMessage(event) {
    event.preventDefault();

    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;

    // Clear input
    input.value = '';
    autoResizeTextarea();
    updateCharCount();
    toggleSuggestions();

    // Add user message to UI
    addMessageToUI(message, 'user');

    // Show typing indicator
    showTypingIndicator();

    // Send to backend
    try {
        const response = await sendMessageToBackend(message);

        // Hide typing indicator
        hideTypingIndicator();

        // Add bot response to UI
        if (response && response.response) {
            addMessageToUI(response.response, 'bot');
        } else {
            addMessageToUI('Sorry, I encountered an error. Please try again.', 'bot', true);
        }

    } catch (error) {
        console.error('Error sending message:', error);
        hideTypingIndicator();
        addMessageToUI('Sorry, I\'m having trouble connecting. Please try again later.', 'bot', true);
    }
}

// Send quick message
function sendQuickMessage(message) {
    const input = document.getElementById('messageInput');
    input.value = message;

    // Trigger send
    const form = document.getElementById('chatForm');
    form.dispatchEvent(new Event('submit'));
}

// Add message to UI
function addMessageToUI(text, sender, isError = false) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message fade-in`;

    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-${sender === 'bot' ? 'robot' : 'user'}"></i>
        </div>
        <div class="message-content">
            <div class="message-text ${isError ? 'error-message' : ''}">
                ${formatMessage(text)}
            </div>
            <div class="message-time">${time}</div>
        </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
    scrollToBottom();

    // Add to history
    messageHistory.push({ text, sender, time });
}

// Format message (convert markdown-like syntax)
function formatMessage(text) {
    // Convert line breaks
    text = text.replace(/\n/g, '<br>');

    // Convert **bold**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Convert *italic*
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Convert `code`
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');

    // Convert URLs to links
    text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');

    return text;
}

// Show typing indicator
function showTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = 'flex';
    scrollToBottom();
}

// Hide typing indicator
function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = 'none';
}

// Scroll to bottom
function scrollToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}

// Send message to backend
async function sendMessageToBackend(message) {
    const token = localStorage.getItem('djangoAuthToken');

    try {
        const response = await fetch(`${API_BASE_URL}/chatbot/chat/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                conversation_id: conversationId
            })
        });

        if (!response.ok) {
            throw new Error('Failed to send message');
        }

        const data = await response.json();

        // Store conversation ID
        if (data.conversation_id) {
            conversationId = data.conversation_id;
        }

        // Normalize backend response shape to { response }
        if (data.ai_message && data.ai_message.content) {
            return { response: data.ai_message.content, conversation_id: data.conversation_id };
        }

        return data;

    } catch (error) {
        console.error('Backend error:', error);

        // Fallback to mock response if backend is unavailable
        return getMockResponse(message);
    }
}

// Mock response (fallback when backend is unavailable)
function getMockResponse(message) {
    const lowerMessage = message.toLowerCase();

    // Greeting
    if (lowerMessage.includes('greeting') || lowerMessage.includes('how are you') || lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
        return {
            response: `I'm all good,thank you for asking,\n\nHow can I help you today? 😊`
        };
    }

    // Wallet & Payments
    if (lowerMessage.includes('deposit') || lowerMessage.includes('add money')) {
        return {
            response: `To deposit funds to your wallet:\n\n1. Click the "Wallet" button in the navigation\n2. Click the "Deposit" button\n3. Choose your payment method:\n   • Card (Stripe)\n   • Mobile Money (PawaPay)\n4. Enter the amount\n5. Complete the payment\n\nYour wallet will be credited automatically! 💰`
        };
    }

    if (lowerMessage.includes('withdraw') || lowerMessage.includes('cash out')) {
        return {
            response: `To withdraw your earnings:\n\n1. Go to your Wallet page\n2. Click the "Withdraw" button\n3. Enter the amount you want to withdraw\n4. Select withdrawal method:\n   • Mobile Money (MTN, Airtel, M-Pesa)\n   • Bank Transfer\n   • PayPal\n5. Enter your account details\n6. Confirm withdrawal\n\nYour funds will be processed within 24 hours! 💸`
        };
    }

    if (lowerMessage.includes('payment') || lowerMessage.includes('pay')) {
        return {
            response: `We support multiple payment methods:\n\n💳 Card Payments (Stripe)\n📱 Mobile Money (PawaPay):\n   • MTN Mobile Money\n   • Airtel Money\n   • M-Pesa\n   • Vodacom\n   • Tigo Pesa\n💰 Paystack\n\nAll payments are secure and instant! The default currency is Zambian Kwacha (ZMW). 🇿🇲`
        };
    }

    // Earning & Games
    if (lowerMessage.includes('earn') || lowerMessage.includes('make money')) {
        return {
            response: `You can earn money on ARTX by:\n\n🎮 Completing Challenges - Win prizes for correct answers\n🏆 Winning Tournaments - Compete for big prizes\n⭐ Gaining Prestige - Unlock higher tiers with better rewards\n🤝 Alliance Rewards - Team up and earn together\n📈 Daily Streaks - Bonus rewards for consistency\n\nThe more you play, the more you earn! 💰`
        };
    }

    if (lowerMessage.includes('prestige') || lowerMessage.includes('points')) {
        return {
            response: `Prestige Points are your reputation on ARTX!\n\n⭐ Earn prestige by:\n   • Completing challenges\n   • Winning tournaments\n   • Maintaining streaks\n   • Helping your alliance\n\n📊 Prestige unlocks:\n   • Higher access tiers\n   • Better rewards\n   • Exclusive tournaments\n   • Special features\n\nYour current tier determines your earning potential! 🚀`
        };
    }

    if (lowerMessage.includes('tournament')) {
        return {
            response: `Tournaments are competitive events where you can win big!\n\n🏆 How tournaments work:\n1. Browse available tournaments\n2. Pay entry fee (if required)\n3. Compete against other players\n4. Complete challenges within time limit\n5. Top performers win prizes!\n\n💰 Prize pools are distributed to winners\n🎯 Higher tiers = bigger tournaments\n⏰ Check the schedule for upcoming events!`
        };
    }

    // Tiers & Levels
    if (lowerMessage.includes('tier') || lowerMessage.includes('level')) {
        return {
            response: `Access Tiers on ARTX:\n\n🥉 Bronze (0-199 prestige) - Starter tier\n🥈 Silver (200-499) - Better challenges\n🥇 Gold (500-999) - Premium tournaments\n💎 Platinum (1000-1499) - Elite access\n💠 Diamond (1500-2499) - VIP features\n⭐ Elite (2500-4999) - Top rewards\n🏆 Legendary (5000+) - Maximum benefits\n\nClimb the tiers to unlock better earning opportunities! 📈`
        };
    }

    // Alliance
    if (lowerMessage.includes('alliance')) {
        return {
            response: `Alliances are teams where players collaborate!\n\n🤝 Benefits:\n   • Team tournaments\n   • Shared rewards\n   • Alliance chat\n   • Combined prestige\n   • Exclusive challenges\n\n📝 To join an alliance:\n1. Go to Community page\n2. Browse available alliances\n3. Send join request\n4. Wait for approval\n\nOr create your own alliance and recruit members! 👥`
        };
    }

    // Messenger
    if (lowerMessage.includes('message') || lowerMessage.includes('chat')) {
        return {
            response: `The Messenger feature lets you chat with other players!\n\n💬 Features:\n   • Real-time messaging\n   • Media sharing (images, videos)\n   • Conversation history\n   • Unread notifications\n\n📱 To send a message:\n1. Click the user icon (top right)\n2. Select "Messenger"\n3. Choose a user to message\n4. Start chatting!\n\nStay connected with the ARTX community! 🌟`
        };
    }

    // General help
    if (lowerMessage.includes('help') || lowerMessage.includes('how')) {
        return {
            response: `I can help you with:\n\n💰 Wallet & Payments - Deposits, withdrawals, balance\n🎮 Games & Challenges - How to play and earn\n🏆 Tournaments - Joining and winning\n⭐ Prestige System - Levels and tiers\n🤝 Alliances - Teams and collaboration\n💬 Messenger - Chatting with players\n\nWhat would you like to know more about?`
        };
    }

    // Default response
    return {
        response: `I'm here to help! I can answer questions about:\n\n• Wallet & Payments 💰\n• Earning Money 🎮\n• Tournaments 🏆\n• Prestige & Tiers ⭐\n• Alliances 🤝\n• Messenger 💬\n\nWhat would you like to know?`
    };
}

// Load conversation history
async function loadConversationHistory() {
    const token = localStorage.getItem('djangoAuthToken');

    try {
        const response = await fetch(`${API_BASE_URL}/chatbot/history/`, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();

            if (data.conversations && data.conversations.length > 0) {
                // Load most recent conversation
                const recentConversation = data.conversations[0];
                conversationId = recentConversation.id;

                // Load messages from conversation
                if (recentConversation.messages && recentConversation.messages.length > 0) {
                    // Clear welcome message
                    const messagesContainer = document.getElementById('chatMessages');
                    messagesContainer.innerHTML = '';

                    // Add historical messages
                    recentConversation.messages.forEach(msg => {
                        addMessageToUI(msg.message, 'user');
                        if (msg.response) {
                            addMessageToUI(msg.response, 'bot');
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.log('Could not load conversation history:', error);
    }
}

// Clear conversation
function clearConversation() {
    if (!confirm('Are you sure you want to clear this conversation?')) {
        return;
    }

    // Clear UI
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = `
        <div class="message bot-message">
            <div class="message-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="message-content">
                <div class="message-text">
                    👋 Hello! I'm your ARTX AI Assistant. I'm here to help you with:
                    <br><br>
                    💰 Wallet & Payments<br>
                    🎮 Games & Challenges<br>
                    🏆 Tournaments & Alliances<br>
                    📊 Prestige & Levels<br>
                    ❓ General Questions<br>
                    <br>
                    How can I help you today?
                </div>
                <div class="message-time">Just now</div>
            </div>
        </div>
    `;

    // Reset state
    conversationId = null;
    messageHistory = [];

    // Show suggestions
    toggleSuggestions();
}

// Handle Enter key (send message)
document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('messageInput');

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const form = document.getElementById('chatForm');
            form.dispatchEvent(new Event('submit'));
        }
    });
});
