// Clear All Local Storage Data - ARTX Platform Reset
// This script will completely clear all local storage data

function clearAllLocalStorage() {
    console.log('🧹 CLEARING ALL LOCAL STORAGE DATA...');
    
    // Get all localStorage keys
    const keys = Object.keys(localStorage);
    console.log(`Found ${keys.length} localStorage items to clear:`);
    
    // Log what we're clearing
    keys.forEach(key => {
        console.log(`- ${key}: ${localStorage.getItem(key)?.substring(0, 50)}...`);
    });
    
    // Clear everything
    localStorage.clear();
    
    // Also clear sessionStorage just in case
    sessionStorage.clear();
    
    console.log('✅ ALL LOCAL STORAGE CLEARED!');
    console.log('🎮 Ready for fresh user registrations!');
    
    // Show confirmation to user
    alert('🧹 All local storage data has been cleared!\n\n✅ You can now register new users fresh!\n\n🎮 The system will now use the Django database for all user data.');
    
    // Redirect to auth page for fresh start
    window.location.href = 'pages/auth.html';
}

// Auto-execute when script loads
clearAllLocalStorage();