// Enhanced Challenges with Money Rewards

let currentChallengeId = null;
let submissionFiles = [];

// Filter challenges
function filterChallenges(filter) {
    const challenges = document.querySelectorAll('.challenge-card');
    const filterBtns = document.querySelectorAll('.challenge-filters .filter-btn');
    
    // Update active filter
    filterBtns.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Filter logic
    challenges.forEach(challenge => {
        const status = challenge.getAttribute('data-status');
        
        if (filter === 'all') {
            challenge.style.display = 'block';
        } else if (filter === 'active' && status === 'active') {
            challenge.style.display = 'block';
        } else if (filter === 'completed' && status === 'completed') {
            challenge.style.display = 'block';
        } else if (filter === 'my-challenges') {
            // Show challenges created by user
            challenge.style.display = 'block';
        } else {
            challenge.style.display = 'none';
        }
        
        if (challenge.style.display === 'block') {
            challenge.style.animation = 'fadeIn 0.3s';
        }
    });
}

// Handle category change in create challenge modal
function handleCategoryChange() {
    const category = document.getElementById('challengeCategory').value;
    const imageGroup = document.getElementById('challengeImageGroup');
    const challengeImage = document.getElementById('challengeImage');
    
    if (category === 'image-interpretation') {
        imageGroup.style.display = 'block';
        challengeImage.required = true;
    } else {
        imageGroup.style.display = 'none';
        challengeImage.required = false;
        // Clear image preview
        document.getElementById('challengeImagePreview').innerHTML = '';
    }
}

// Handle challenge image upload
let challengeImageData = null;

function handleChallengeImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        event.target.value = '';
        return;
    }
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        challengeImageData = e.target.result;
        
        // Show preview
        const preview = document.getElementById('challengeImagePreview');
        preview.innerHTML = `
            <div class="image-preview-item">
                <img src="${e.target.result}" alt="Challenge image">
                <button class="remove-image-btn" onclick="removeChallengeImage()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

// Remove challenge image
function removeChallengeImage() {
    challengeImageData = null;
    document.getElementById('challengeImage').value = '';
    document.getElementById('challengeImagePreview').innerHTML = '';
}

// Open create challenge modal
function openCreateChallengeModal() {
    const modal = document.getElementById('createChallengeModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Close create challenge modal
function closeCreateChallengeModal() {
    const modal = document.getElementById('createChallengeModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('createChallengeForm').reset();
    }
}

// Publish challenge
function publishChallenge(event) {
    event.preventDefault();
    
    const title = document.getElementById('challengeTitle').value;
    const category = document.getElementById('challengeCategory').value;
    const difficulty = document.getElementById('challengeDifficulty').value;
    const prize = parseFloat(document.getElementById('challengePrize').value);
    const duration = document.getElementById('challengeDuration').value;
    const description = document.getElementById('challengeDescription').value;
    const requirements = document.getElementById('challengeRequirements').value;
    const verification = document.getElementById('challengeVerification').checked;
    
    // Get username
    const username = document.getElementById('username')?.textContent || 'You';
    
    // Get category icon
    const categoryIcons = {
        'coding': 'fa-code',
        'gaming': 'fa-gamepad',
        'trivia': 'fa-brain',
        'creative': 'fa-palette',
        'image-interpretation': 'fa-image',
        'fitness': 'fa-dumbbell',
        'other': 'fa-star'
    };
    
    const icon = categoryIcons[category] || 'fa-trophy';
    
    // Create challenge card with image if it's an image interpretation challenge
    let challengeImageHTML = '';
    if (category === 'image-interpretation' && challengeImageData) {
        challengeImageHTML = `
            <div class="challenge-image">
                <img src="${challengeImageData}" alt="${title}" style="width: 100%; border-radius: 8px; margin: 12px 0;">
            </div>
        `;
    }
    
    // Create challenge card
    const challengeCard = document.createElement('div');
    challengeCard.className = 'challenge-card';
    challengeCard.setAttribute('data-status', 'active');
    challengeCard.setAttribute('data-id', Date.now());
    challengeCard.setAttribute('data-category', category);
    if (challengeImageData) {
        challengeCard.setAttribute('data-image', challengeImageData);
    }
    challengeCard.style.animation = 'fadeIn 0.5s';
    
    challengeCard.innerHTML = `
        <div class="challenge-badge prize">K${prize.toFixed(2)} Prize</div>
        <div class="challenge-header">
            <div class="challenge-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="challenge-creator">
                <span>Created by <strong>${username}</strong></span>
                <span class="challenge-time">Just now</span>
            </div>
        </div>
        <h3 class="challenge-title">${title}</h3>
        <p class="challenge-description">${description}</p>
        ${challengeImageHTML}
        <div class="challenge-details">
            <div class="challenge-detail">
                <i class="fas fa-clock"></i>
                <span>${duration} days left</span>
            </div>
            <div class="challenge-detail">
                <i class="fas fa-users"></i>
                <span>0 participants</span>
            </div>
            <div class="challenge-detail">
                <i class="fas fa-signal"></i>
                <span>${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</span>
            </div>
        </div>
        <div class="challenge-footer">
            <button class="btn-primary" onclick="attemptChallenge(${Date.now()})">
                <i class="fas fa-play"></i> Attempt
            </button>
            <button class="btn-secondary" onclick="viewChallengeDetails(${Date.now()})">
                <i class="fas fa-info-circle"></i> Details
            </button>
        </div>
    `;
    
    // Add to grid
    const grid = document.getElementById('challengesGrid');
    grid.insertBefore(challengeCard, grid.firstChild);
    
    // Close modal
    closeCreateChallengeModal();
    
    // Clear image data
    challengeImageData = null;
    
    // Show success
    showNotification('Challenge created successfully! 🏆');
    
    // Update stats
    updateChallengeStats();
    
    // In real app, would send to backend
    console.log('Challenge created:', {
        title,
        category,
        difficulty,
        prize,
        duration,
        description,
        requirements,
        verification
    });
}

// Attempt challenge
function attemptChallenge(challengeId) {
    currentChallengeId = challengeId;
    
    // Get challenge details
    const challengeCard = document.querySelector(`[data-id="${challengeId}"]`);
    if (!challengeCard) return;
    
    const title = challengeCard.querySelector('.challenge-title').textContent;
    const description = challengeCard.querySelector('.challenge-description').textContent;
    const prizeText = challengeCard.querySelector('.challenge-badge').textContent;
    const category = challengeCard.getAttribute('data-category') || 'general';
    const challengeImage = challengeCard.getAttribute('data-image');
    
    // Populate modal
    document.getElementById('attemptChallengeTitle').textContent = title;
    document.getElementById('attemptChallengeDescription').textContent = description;
    document.getElementById('attemptChallengePrize').textContent = prizeText.replace('Prize', '').trim();
    
    // Show challenge image if it's an image interpretation challenge
    const modalBody = document.querySelector('#attemptChallengeModal .modal-body');
    const existingImage = modalBody.querySelector('.challenge-image-display');
    if (existingImage) {
        existingImage.remove();
    }
    
    if (category === 'image-interpretation' && challengeImage) {
        const imageDisplay = document.createElement('div');
        imageDisplay.className = 'challenge-image-display';
        imageDisplay.style.cssText = 'margin: 20px 0; text-align: center;';
        imageDisplay.innerHTML = `
            <h4 style="margin-bottom: 12px; color: #556b2f;">
                <i class="fas fa-image"></i> Image to Interpret:
            </h4>
            <img src="${challengeImage}" alt="Challenge image" style="max-width: 100%; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="margin-top: 12px; color: #65676b; font-size: 14px;">
                <i class="fas fa-info-circle"></i> Provide a detailed interpretation (minimum 100 words)
            </p>
        `;
        
        const form = modalBody.querySelector('form');
        form.insertBefore(imageDisplay, form.firstChild);
        
        // Update submission placeholder for image interpretation
        const submissionText = document.getElementById('submissionText');
        submissionText.placeholder = 'Write your detailed interpretation of the image (minimum 100 words)...';
        submissionText.rows = 8;
    } else {
        // Reset placeholder for other challenge types
        const submissionText = document.getElementById('submissionText');
        submissionText.placeholder = 'Describe your solution or provide links...';
        submissionText.rows = 4;
    }
    
    // Open modal
    const modal = document.getElementById('attemptChallengeModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Close attempt challenge modal
function closeAttemptChallengeModal() {
    const modal = document.getElementById('attemptChallengeModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('attemptChallengeForm').reset();
        submissionFiles = [];
        document.getElementById('submissionFilesPreview').innerHTML = '';
    }
}

// Handle submission files
function handleSubmissionFiles(event) {
    const files = Array.from(event.target.files);
    const preview = document.getElementById('submissionFilesPreview');
    
    files.forEach(file => {
        submissionFiles.push(file);
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-preview-item';
        
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileItem.innerHTML = `
                    <video src="${e.target.result}"></video>
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            fileItem.innerHTML = `
                <i class="fas fa-file"></i>
                <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
        
        preview.appendChild(fileItem);
    });
}

// Remove submission file
function removeSubmissionFile(index) {
    submissionFiles.splice(index, 1);
    
    // Rebuild preview
    const preview = document.getElementById('submissionFilesPreview');
    preview.innerHTML = '';
    
    submissionFiles.forEach((file, idx) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-preview-item';
        
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileItem.innerHTML = `
                    <video src="${e.target.result}"></video>
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            fileItem.innerHTML = `
                <i class="fas fa-file"></i>
                <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
        
        preview.appendChild(fileItem);
    });
}

// Submit challenge attempt
async function submitChallengeAttempt(event) {
    event.preventDefault();
    
    const submissionText = document.getElementById('submissionText').value;
    const submissionLink = document.getElementById('submissionLink').value;
    
    // Get challenge details
    const challengeCard = document.querySelector(`[data-id="${currentChallengeId}"]`);
    if (!challengeCard) return;
    
    const challengeTitle = challengeCard.querySelector('.challenge-title').textContent;
    const prizeText = document.getElementById('attemptChallengePrize').textContent;
    const prizeAmount = parseFloat(prizeText.replace('K', '').replace('Prize', '').trim());
    
    // Show loading
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    submitBtn.disabled = true;
    
    try {
        // Verify challenge submission with backend
        const isVerified = await verifyChallengeSubmission({
            challengeId: currentChallengeId,
            challengeTitle: challengeTitle,
            submissionText: submissionText,
            submissionLink: submissionLink,
            files: submissionFiles
        });
        
        if (isVerified) {
            // Mark as completed
            challengeCard.setAttribute('data-status', 'completed');
            challengeCard.classList.add('challenge-success');
            
            // Add money to wallet via backend
            await addMoneyToWalletBackend(prizeAmount, currentChallengeId);
            
            // Update stats
            updateChallengeStats();
            
            // Close modal
            closeAttemptChallengeModal();
            
            // Show success with money earned
            showSuccessModal(prizeAmount);
        } else {
            // Verification failed
            alert('❌ Challenge verification failed. Please check your submission and try again.');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
        
    } catch (error) {
        console.error('Challenge submission error:', error);
        alert(`❌ Submission failed: ${error.message}`);
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

// Verify challenge submission
async function verifyChallengeSubmission(submission) {
    // Get challenge card to determine type
    const challengeCard = document.querySelector(`[data-id="${submission.challengeId}"]`);
    if (!challengeCard) return false;
    
    // Get challenge category from card
    const categoryIcon = challengeCard.querySelector('.challenge-icon i');
    let challengeType = 'general';
    
    if (categoryIcon) {
        if (categoryIcon.classList.contains('fa-code')) challengeType = 'coding';
        else if (categoryIcon.classList.contains('fa-brain')) challengeType = 'trivia';
        else if (categoryIcon.classList.contains('fa-gamepad')) challengeType = 'gaming';
        else if (categoryIcon.classList.contains('fa-palette')) challengeType = 'creative';
    }
    
    // Validate submission has content
    if (!submission.submissionText && !submission.submissionLink && submission.files.length === 0) {
        throw new Error('Please provide a submission (text, link, or files)');
    }
    
    // For now, use client-side verification
    // In production, this should call Django backend API
    const token = localStorage.getItem('djangoAuthToken');
    
    if (token) {
        // Try to verify with backend
        try {
            const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
            const response = await fetch(`${API_BASE_URL}/challenges/verify/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    challenge_id: submission.challengeId,
                    challenge_type: challengeType,
                    submission_text: submission.submissionText,
                    submission_link: submission.submissionLink,
                    has_files: submission.files.length > 0
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.verified === true;
            }
        } catch (error) {
            console.warn('Backend verification unavailable, using client-side validation:', error);
        }
    }
    
    // Fallback: Client-side verification rules
    switch (challengeType) {
        case 'trivia':
            // For trivia, require text answer
            return submission.submissionText && submission.submissionText.length >= 3;
            
        case 'coding':
            // For coding, require link or files
            return submission.submissionLink || submission.files.length > 0;
            
        case 'creative':
            // For creative, require files (images/videos)
            return submission.files.length > 0;
            
        case 'gaming':
            // For gaming, require proof (screenshot/video)
            return submission.files.length > 0 || submission.submissionLink;
            
        case 'image-interpretation':
            // For image interpretation, require text (min 100 words)
            if (!submission.submissionText) return false;
            const wordCount = submission.submissionText.trim().split(/\s+/).length;
            if (wordCount < 100) {
                throw new Error('Image interpretation must be at least 100 words');
            }
            return true;
            
        default:
            // General challenges require any submission
            return submission.submissionText || submission.submissionLink || submission.files.length > 0;
    }
}

// Add money to wallet via backend
async function addMoneyToWalletBackend(amount, challengeId) {
    const token = localStorage.getItem('djangoAuthToken');
    
    if (token) {
        // Add earnings via Django backend
        try {
            const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
            const response = await fetch(`${API_BASE_URL}/payments/wallet/add-earnings/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: amount,
                    game_type: 'challenge',
                    game_id: challengeId
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Update UI with backend wallet data
                if (data.wallet) {
                    updateWalletUI(data.wallet.available_balance);
                }
                
                return true;
            } else {
                console.warn('Backend wallet update failed, using localStorage fallback');
            }
        } catch (error) {
            console.warn('Backend unavailable, using localStorage fallback:', error);
        }
    }
    
    // Fallback: Update localStorage
    addMoneyToWalletLocal(amount, challengeId);
    return true;
}

// Add money to wallet (localStorage fallback)
function addMoneyToWalletLocal(amount, challengeId) {
    // Get current balance
    const balanceElement = document.getElementById('walletBalance');
    const currentBalance = parseFloat(balanceElement?.textContent.replace('K', '') || '0');
    
    // Add prize money
    const newBalance = currentBalance + amount;
    
    // Update UI
    updateWalletUI(newBalance);
    
    // Store in localStorage
    localStorage.setItem('walletBalance', newBalance.toFixed(2));
    
    // Create transaction record
    const transaction = {
        type: 'challenge_reward',
        amount: amount,
        date: new Date().toISOString(),
        description: 'Challenge completion reward',
        challenge_id: challengeId
    };
    
    // Store transaction
    const transactions = JSON.parse(localStorage.getItem('transactions') || '[]');
    transactions.unshift(transaction);
    localStorage.setItem('transactions', JSON.stringify(transactions));
}

// Update wallet UI
function updateWalletUI(balance) {
    const balanceElement = document.getElementById('walletBalance');
    if (balanceElement) {
        balanceElement.textContent = `K${parseFloat(balance).toFixed(2)}`;
    }
    
    // Update wallet badge
    const walletBadge = document.getElementById('walletBalanceBadge');
    if (walletBadge) {
        walletBadge.style.display = 'flex';
    }
    
    // Update user menu balance
    const userMenuBalance = document.getElementById('userMenuBalance');
    if (userMenuBalance) {
        userMenuBalance.textContent = `K${parseFloat(balance).toFixed(2)}`;
    }
}

// Show success modal
function showSuccessModal(amount) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px; text-align: center;">
            <div style="font-size: 64px; color: #4caf50; margin-bottom: 20px;">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 style="color: #333; margin-bottom: 16px;">Challenge Completed! 🎉</h2>
            <p style="color: #65676b; margin-bottom: 24px;">Congratulations! You've successfully completed the challenge.</p>
            <div style="background: linear-gradient(to right, #ffd700, #ffed4e); padding: 20px; border-radius: 12px; margin-bottom: 24px;">
                <div style="font-size: 14px; color: #000; margin-bottom: 8px;">You earned</div>
                <div style="font-size: 36px; font-weight: bold; color: #000;">K${amount.toFixed(2)}</div>
            </div>
            <button class="btn-primary" onclick="this.closest('.modal').remove()" style="width: 100%;">
                <i class="fas fa-wallet"></i> View Wallet
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        modal.style.animation = 'fadeOut 0.3s';
        setTimeout(() => modal.remove(), 300);
    }, 5000);
}

// Update challenge stats
function updateChallengeStats() {
    const completedChallenges = document.querySelectorAll('[data-status="completed"]').length;
    const activeChallenges = document.querySelectorAll('[data-status="active"]').length;
    
    // Get total earned from localStorage
    const balance = parseFloat(localStorage.getItem('walletBalance') || '0');
    
    // Calculate success rate
    const totalAttempts = completedChallenges + 5; // Assuming some failed attempts
    const successRate = totalAttempts > 0 ? Math.round((completedChallenges / totalAttempts) * 100) : 0;
    
    // Update displays
    document.getElementById('completedChallenges').textContent = completedChallenges;
    document.getElementById('activeChallenges').textContent = activeChallenges;
    document.getElementById('totalEarned').textContent = `K${balance.toFixed(2)}`;
    document.getElementById('successRate').textContent = `${successRate}%`;
}

// View challenge details
function viewChallengeDetails(challengeId) {
    alert('Challenge details view coming soon!');
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Load wallet balance from localStorage
    const savedBalance = localStorage.getItem('walletBalance');
    if (savedBalance) {
        const balanceElement = document.getElementById('walletBalance');
        if (balanceElement) {
            balanceElement.textContent = `K${parseFloat(savedBalance).toFixed(2)}`;
        }
        
        const walletBadge = document.getElementById('walletBalanceBadge');
        if (walletBadge) {
            walletBadge.style.display = 'flex';
        }
    }
    
    // Update stats
    updateChallengeStats();
});

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    const createModal = document.getElementById('createChallengeModal');
    const attemptModal = document.getElementById('attemptChallengeModal');
    
    if (event.target === createModal) {
        closeCreateChallengeModal();
    }
    
    if (event.target === attemptModal) {
        closeAttemptChallengeModal();
    }
});
