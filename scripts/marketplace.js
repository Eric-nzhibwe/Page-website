// Marketplace JavaScript

// Toggle Quick Menu
function toggleQuickMenu() {
    const dropdown = document.getElementById('quickMenuDropdown');
    const userDropdown = document.getElementById('userMenuDropdown');
    
    // Close user menu if open
    if (userDropdown && userDropdown.classList.contains('show')) {
        userDropdown.classList.remove('show');
    }
    
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Toggle User Menu
function toggleUserMenu() {
    const dropdown = document.getElementById('userMenuDropdown');
    const quickMenu = document.getElementById('quickMenuDropdown');
    
    // Close quick menu if open
    if (quickMenu && quickMenu.classList.contains('show')) {
        quickMenu.classList.remove('show');
    }
    
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
    const quickMenu = document.getElementById('quickMenuDropdown');
    const userMenu = document.getElementById('userMenuDropdown');
    
    // Check if click is outside quick menu
    if (quickMenu && !event.target.closest('.header-icon-btn') && !event.target.closest('.quick-menu-dropdown')) {
        quickMenu.classList.remove('show');
    }
    
    // Check if click is outside user menu
    if (userMenu && !event.target.closest('.user-avatar-btn') && !event.target.closest('.user-menu-dropdown')) {
        userMenu.classList.remove('show');
    }
});

// Show Notifications (placeholder)
function showNotifications() {
    alert('Notifications feature coming soon!');
}

// Show Settings is now in settings.js

// Update icon navigation active state
function updateIconNav(viewName) {
    document.querySelectorAll('.icon-nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === viewName) {
            btn.classList.add('active');
        }
    });
}

// Initialize icon navigation
document.addEventListener('DOMContentLoaded', function() {
    // Add click handlers to icon nav buttons
    document.querySelectorAll('.icon-nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', function() {
            const view = this.getAttribute('data-view');
            if (view) {
                showView(view);
                updateIconNav(view);
            }
        });
    });
    
    // Update user menu with data
    updateUserMenuData();
});

// Update user menu with current user data
function updateUserMenuData() {
    setTimeout(() => {
        const username = document.getElementById('username')?.textContent || 'Player';
        const tier = document.getElementById('tierBadge')?.textContent || 'Bronze';
        const streak = document.getElementById('streakCount')?.textContent || '0';
        const prestige = document.getElementById('userPrestige')?.textContent || '0';
        const balance = document.getElementById('walletBalance')?.textContent || 'K0.00';
        
        // Update user menu
        const userMenuName = document.getElementById('userMenuName');
        const userMenuTier = document.getElementById('userMenuTier');
        const userMenuStreak = document.getElementById('userMenuStreak');
        const userMenuPrestige = document.getElementById('userMenuPrestige');
        const userMenuBalance = document.getElementById('userMenuBalance');
        
        if (userMenuName) userMenuName.textContent = username;
        if (userMenuTier) userMenuTier.textContent = tier + ' Tier';
        if (userMenuStreak) userMenuStreak.textContent = streak;
        if (userMenuPrestige) userMenuPrestige.textContent = prestige;
        if (userMenuBalance) userMenuBalance.textContent = balance;
    }, 500);
}

// Marketplace Functions

let selectedProductImages = [];

// Filter marketplace
function filterMarketplace(category) {
    const products = document.querySelectorAll('.product-card');
    const filterBtns = document.querySelectorAll('.marketplace-filters .filter-btn');
    
    // Update active filter button
    filterBtns.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Filter products
    products.forEach(product => {
        const productCategory = product.getAttribute('data-category');
        
        if (category === 'all' || productCategory === category) {
            product.style.display = 'block';
            product.style.animation = 'fadeIn 0.3s';
        } else {
            product.style.display = 'none';
        }
    });
}

// Open create product modal
function openCreateProductModal() {
    const modal = document.getElementById('createProductModal');
    if (modal) {
        modal.style.display = 'block';
        selectedProductImages = [];
        document.getElementById('productImagePreview').innerHTML = '';
    }
}

// Close create product modal
function closeCreateProductModal() {
    const modal = document.getElementById('createProductModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('createProductForm').reset();
        selectedProductImages = [];
        document.getElementById('productImagePreview').innerHTML = '';
    }
}

// Handle product images upload
function handleProductImages(event) {
    const files = Array.from(event.target.files);
    const preview = document.getElementById('productImagePreview');
    
    // Limit to 5 images
    const remainingSlots = 5 - selectedProductImages.length;
    const filesToAdd = files.slice(0, remainingSlots);
    
    filesToAdd.forEach(file => {
        if (file.type.startsWith('image/')) {
            selectedProductImages.push(file);
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const previewItem = document.createElement('div');
                previewItem.className = 'image-preview-item';
                previewItem.innerHTML = `
                    <img src="${e.target.result}" alt="Product">
                    <button class="remove-image-btn" onclick="removeProductImage(${selectedProductImages.length - 1})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                preview.appendChild(previewItem);
            };
            reader.readAsDataURL(file);
        }
    });
    
    if (files.length > remainingSlots) {
        alert(`Maximum 5 images allowed. Only ${remainingSlots} images were added.`);
    }
}

// Remove product image
function removeProductImage(index) {
    selectedProductImages.splice(index, 1);
    
    // Rebuild preview
    const preview = document.getElementById('productImagePreview');
    preview.innerHTML = '';
    
    selectedProductImages.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewItem = document.createElement('div');
            previewItem.className = 'image-preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Product">
                <button class="remove-image-btn" onclick="removeProductImage(${idx})">
                    <i class="fas fa-times"></i>
                </button>
            `;
            preview.appendChild(previewItem);
        };
        reader.readAsDataURL(file);
    });
}

// Show/hide phone number field based on contact method
document.addEventListener('DOMContentLoaded', function() {
    const contactMethod = document.getElementById('contactMethod');
    const phoneNumberGroup = document.getElementById('phoneNumberGroup');
    
    if (contactMethod) {
        contactMethod.addEventListener('change', function() {
            if (this.value === 'phone' || this.value === 'whatsapp') {
                phoneNumberGroup.style.display = 'block';
                document.getElementById('contactPhone').required = true;
            } else {
                phoneNumberGroup.style.display = 'none';
                document.getElementById('contactPhone').required = false;
            }
        });
    }
});

// Publish product
function publishProduct(event) {
    event.preventDefault();
    
    const title = document.getElementById('productTitle').value;
    const category = document.getElementById('productCategory').value;
    const price = document.getElementById('productPrice').value;
    const description = document.getElementById('productDescription').value;
    const contactMethod = document.getElementById('contactMethod').value;
    const contactPhone = document.getElementById('contactPhone').value;
    
    // Get username
    const username = document.getElementById('username')?.textContent || 'You';
    
    // Create product card
    const productCard = document.createElement('div');
    productCard.className = 'product-card';
    productCard.setAttribute('data-category', category);
    productCard.style.animation = 'fadeIn 0.5s';
    
    // Use first image or placeholder
    let imageUrl = 'https://via.placeholder.com/300x200/556b2f/90ee90?text=Product';
    if (selectedProductImages.length > 0) {
        const reader = new FileReader();
        reader.onload = function(e) {
            productCard.querySelector('.product-image img').src = e.target.result;
        };
        reader.readAsDataURL(selectedProductImages[0]);
    }
    
    productCard.innerHTML = `
        <div class="product-image">
            <img src="${imageUrl}" alt="${title}">
            <div class="product-badge">New</div>
        </div>
        <div class="product-info">
            <h3 class="product-title">${title}</h3>
            <p class="product-description">${description}</p>
            <div class="product-seller">
                <i class="fas fa-user-circle"></i>
                <span>${username}</span>
            </div>
            <div class="product-footer">
                <div class="product-price">K${parseFloat(price).toFixed(2)}</div>
                <button class="btn-contact" onclick="contactSeller('${username}')">
                    <i class="fas fa-comments"></i> Contact
                </button>
            </div>
        </div>
    `;
    
    // Add to marketplace grid
    const grid = document.getElementById('marketplaceGrid');
    grid.insertBefore(productCard, grid.firstChild);
    
    // Close modal
    closeCreateProductModal();
    
    // Show success message
    showNotification('Product listed successfully! 🎉');
    
    // In real app, would send to backend
    console.log('Product published:', {
        title,
        category,
        price,
        description,
        contactMethod,
        contactPhone,
        images: selectedProductImages.length
    });
}

// Contact seller
function contactSeller(sellerName) {
    // In real app, would open messenger or show contact info
    const message = `Contact ${sellerName} about this product?\n\nThis will open a conversation in Messenger.`;
    
    if (confirm(message)) {
        // Redirect to messenger or open chat
        window.location.href = 'pages/messenger.html';
    }
}

// Show notification
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: linear-gradient(135deg, darkolivegreen, lightgreen);
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('createProductModal');
    if (event.target === modal) {
        closeCreateProductModal();
    }
});
