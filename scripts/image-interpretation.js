// ── Image Interpretation Game Engine ──────────────────────────────────────────
// Flow: card (blurred) → Details modal → Pay entry fee → Game modal (30s) → Submit

const IMG_INTERP_REVEAL_SECONDS = 30;

let _imgInterp = {
    challengeId: null,
    image: null,
    title: '',
    prize: 0,
    entryFee: 0,
    difficulty: '',
    participants: 0,
    correctNumbers: [],   // set by challenge creator (stored in data attr)
    timer: null,
    secondsLeft: IMG_INTERP_REVEAL_SECONDS,
    submitted: false,
    timerStarted: false,
};

// ── Open Details Modal ─────────────────────────────────────────────────────────
function openImgInterpDetails(challengeId) {
    const card = document.querySelector(`.challenge-card[data-id="${challengeId}"]`);
    if (!card) return;

    _imgInterp.challengeId = challengeId;
    _imgInterp.image       = card.getAttribute('data-image') || '';
    _imgInterp.title       = card.querySelector('.challenge-title')?.textContent || 'Image Challenge';
    _imgInterp.prize       = parseFloat(card.getAttribute('data-prize') || '0');
    _imgInterp.entryFee    = parseFloat(card.getAttribute('data-entry-fee') || '0');
    _imgInterp.difficulty  = card.getAttribute('data-difficulty') || '—';
    _imgInterp.participants = parseInt(card.getAttribute('data-participants') || '0', 10);
    _imgInterp.correctNumbers = (card.getAttribute('data-answer-numbers') || '').split(',').map(s => s.trim()).filter(Boolean);
    _imgInterp.submitted   = false;

    // Populate details modal
    const thumb = document.getElementById('imgInterpPreviewThumb');
    if (thumb && _imgInterp.image) thumb.src = _imgInterp.image;

    document.getElementById('imgInterpDetailsTitle').textContent = _imgInterp.title;

    const desc = card.querySelector('.challenge-description')?.textContent || '';
    document.getElementById('imgInterpDetailsDesc').textContent = desc;

    document.getElementById('imgInterpDetailsDiff').innerHTML =
        `<i class="fas fa-signal"></i><span>${_capitalize(_imgInterp.difficulty)}</span>`;

    document.getElementById('imgInterpDetailsParticipants').textContent =
        `${_imgInterp.participants} player${_imgInterp.participants !== 1 ? 's' : ''}`;

    document.getElementById('imgInterpDetailsEntry').textContent =
        _imgInterp.entryFee > 0 ? `K${_imgInterp.entryFee.toFixed(2)}` : 'Free';

    document.getElementById('imgInterpDetailsPrize').textContent =
        `K${_imgInterp.prize.toFixed(2)}`;

    // Update play button label
    const playBtn = document.getElementById('imgInterpPlayBtn');
    if (playBtn) {
        playBtn.innerHTML = _imgInterp.entryFee > 0
            ? `<i class="fas fa-coins"></i> Pay K${_imgInterp.entryFee.toFixed(2)} & Play`
            : `<i class="fas fa-play"></i> Play Now`;
    }

    document.getElementById('imgInterpDetailsModal').style.display = 'block';
}

function closeImgInterpDetails() {
    document.getElementById('imgInterpDetailsModal').style.display = 'none';
}

// ── Start Game (called from Details modal "Pay & Play" button) ─────────────────
function startImgInterpGame() {
    // Deduct entry fee from wallet first
    if (_imgInterp.entryFee > 0) {
        const walletEl = document.getElementById('walletBalance');
        const currentBalance = parseFloat(walletEl?.textContent.replace('K', '') || '0');
        if (currentBalance < _imgInterp.entryFee) {
            _showImgInterpNotice('Insufficient balance. Please top up your wallet.', 'error');
            return;
        }
        // Deduct
        const newBalance = currentBalance - _imgInterp.entryFee;
        if (walletEl) walletEl.textContent = `K${newBalance.toFixed(2)}`;
        localStorage.setItem('walletBalance', newBalance.toFixed(2));
    }

    // Close details, open game
    closeImgInterpDetails();
    _launchGameModal();
}

// ── Launch Game Modal ─────────────────────────────────────────────────────────
function _launchGameModal() {
    _imgInterp.secondsLeft  = IMG_INTERP_REVEAL_SECONDS;
    _imgInterp.submitted    = false;
    _imgInterp.timerStarted = false;

    // Set image (starts blurred, removes blur after "go" overlay fades)
    const gameImg = document.getElementById('imgInterpGameImage');
    if (gameImg) {
        gameImg.src = _imgInterp.image;
        gameImg.classList.add('img-blurred');
    }

    document.getElementById('imgInterpGameTitle').textContent = _imgInterp.title;
    document.getElementById('imgInterpSecondsLeft').textContent = IMG_INTERP_REVEAL_SECONDS;
    document.getElementById('imgInterpTimerFill').style.width = '100%';
    document.getElementById('imgInterpAnswer').value = '';
    document.getElementById('imgInterpTimeWarning').style.display = 'none';
    document.getElementById('imgInterpSubmitBtn').disabled = false;
    document.getElementById('imgInterpAnswerSection').style.opacity = '0.4';
    document.getElementById('imgInterpAnswerSection').style.pointerEvents = 'none';

    // Show the "get ready" overlay briefly then start
    const overlay = document.getElementById('imgInterpGoOverlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="go-pulse"><i class="fas fa-eye"></i></div><p>Get ready…</p>`;

    document.getElementById('imgInterpGameModal').style.display = 'block';

    // 3-2-1 countdown before reveal
    let countdown = 3;
    overlay.innerHTML = `<div class="go-countdown">${countdown}</div><p>Get ready…</p>`;

    const preTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            overlay.innerHTML = `<div class="go-countdown">${countdown}</div><p>Get ready…</p>`;
        } else {
            clearInterval(preTimer);
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.classList.remove('fade-out');
                // Unblur image
                gameImg.classList.remove('img-blurred');
                // Enable answer section
                document.getElementById('imgInterpAnswerSection').style.opacity = '1';
                document.getElementById('imgInterpAnswerSection').style.pointerEvents = 'auto';
                // Start the 30-second timer
                _startImgInterpTimer();
            }, 400);
        }
    }, 1000);
}

// ── 30-second Timer ───────────────────────────────────────────────────────────
function _startImgInterpTimer() {
    _imgInterp.timerStarted = true;
    clearInterval(_imgInterp.timer);

    const fillEl   = document.getElementById('imgInterpTimerFill');
    const secEl    = document.getElementById('imgInterpSecondsLeft');
    const warnEl   = document.getElementById('imgInterpTimeWarning');
    const countEl  = document.getElementById('imgInterpCountdown');

    _imgInterp.timer = setInterval(() => {
        _imgInterp.secondsLeft--;

        // Update UI
        const pct = (_imgInterp.secondsLeft / IMG_INTERP_REVEAL_SECONDS) * 100;
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (secEl)  secEl.textContent  = _imgInterp.secondsLeft;

        // Colour shifts as time runs out
        if (_imgInterp.secondsLeft <= 10) {
            if (fillEl) fillEl.style.background = '#e74c3c';
            if (countEl) countEl.classList.add('timer-danger');
            if (warnEl)  warnEl.style.display = 'flex';
        } else if (_imgInterp.secondsLeft <= 20) {
            if (fillEl) fillEl.style.background = '#f39c12';
        }

        // Time's up
        if (_imgInterp.secondsLeft <= 0) {
            clearInterval(_imgInterp.timer);
            _timeUp();
        }
    }, 1000);
}

// ── Time Up ───────────────────────────────────────────────────────────────────
function _timeUp() {
    if (_imgInterp.submitted) return;

    const gameImg = document.getElementById('imgInterpGameImage');
    if (gameImg) gameImg.classList.add('img-blurred');

    const ansSection = document.getElementById('imgInterpAnswerSection');
    if (ansSection) {
        ansSection.style.opacity = '0.5';
        ansSection.style.pointerEvents = 'none';
    }

    _showImgInterpResult(false, "Time's up! You didn't submit in time.");
}

// ── Submit Answer ─────────────────────────────────────────────────────────────
function submitImgInterpAnswer() {
    if (_imgInterp.submitted) return;

    const raw = document.getElementById('imgInterpAnswer').value.trim();
    if (!raw) {
        _showImgInterpNotice('Please enter at least one number you spotted.', 'warn');
        return;
    }

    clearInterval(_imgInterp.timer);
    _imgInterp.submitted = true;

    // Disable submit button
    document.getElementById('imgInterpSubmitBtn').disabled = true;

    // Parse user's numbers
    const userNumbers = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

    // Check against correct numbers (if set by creator)
    let correct = false;
    if (_imgInterp.correctNumbers.length > 0) {
        const correctSet = new Set(_imgInterp.correctNumbers);
        const matched = userNumbers.filter(n => correctSet.has(n));
        correct = matched.length >= Math.ceil(_imgInterp.correctNumbers.length * 0.5);
    } else {
        // No answer key set — any submission is accepted (peer review model)
        correct = true;
    }

    // Re-blur the image
    const gameImg = document.getElementById('imgInterpGameImage');
    if (gameImg) gameImg.classList.add('img-blurred');

    if (correct) {
        // Award prize
        _awardImgInterpPrize(_imgInterp.prize);
        _showImgInterpResult(true, `You spotted the right points! +K${_imgInterp.prize.toFixed(2)} added to your wallet.`);
    } else {
        _showImgInterpResult(false, 'Not quite — those numbers didn\'t match the hidden points. Better luck next time!');
    }
}

// ── Award Prize ───────────────────────────────────────────────────────────────
function _awardImgInterpPrize(amount) {
    const walletEl = document.getElementById('walletBalance');
    const current  = parseFloat(walletEl?.textContent.replace('K', '') || '0');
    const updated  = current + amount;
    if (walletEl) walletEl.textContent = `K${updated.toFixed(2)}`;
    localStorage.setItem('walletBalance', updated.toFixed(2));

    const walletBadge = document.getElementById('walletBalanceBadge');
    if (walletBadge) walletBadge.style.display = 'flex';

    const userMenuBalance = document.getElementById('userMenuBalance');
    if (userMenuBalance) userMenuBalance.textContent = `K${updated.toFixed(2)}`;
}

// ── Result Overlay ─────────────────────────────────────────────────────────────
function _showImgInterpResult(won, message) {
    const modal = document.getElementById('imgInterpGameModal');
    const resultDiv = document.createElement('div');
    resultDiv.className = `img-interp-result-overlay ${won ? 'result-win' : 'result-lose'}`;
    resultDiv.innerHTML = `
        <div class="result-icon">${won ? '<i class="fas fa-trophy"></i>' : '<i class="fas fa-times-circle"></i>'}</div>
        <h3>${won ? 'Well done!' : 'Better luck next time'}</h3>
        <p>${message}</p>
        <button class="btn-result-close" onclick="closeImgInterpGame()">
            <i class="fas fa-check"></i> Done
        </button>
    `;
    modal.querySelector('.img-interp-game-modal').appendChild(resultDiv);
}

// ── Small inline notice ────────────────────────────────────────────────────────
function _showImgInterpNotice(msg, type) {
    const existing = document.getElementById('_imgInterpNotice');
    if (existing) existing.remove();

    const el = document.createElement('p');
    el.id = '_imgInterpNotice';
    el.className = `img-interp-notice img-interp-notice--${type}`;
    el.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;

    // Prefer the details modal body (shown when balance check happens),
    // fall back to the game answer section
    const detailsBody = document.getElementById('imgInterpDetailsModal')?.querySelector('.modal-body');
    const gameSection = document.getElementById('imgInterpAnswerSection');
    const target = detailsBody || gameSection;
    if (target) target.appendChild(el);

    setTimeout(() => el.remove(), 4000);
}

// ── Close Game Modal ──────────────────────────────────────────────────────────
function closeImgInterpGame() {
    clearInterval(_imgInterp.timer);
    _imgInterp.submitted    = false;
    _imgInterp.timerStarted = false;

    const modal = document.getElementById('imgInterpGameModal');
    // Remove any result overlays
    modal.querySelectorAll('.img-interp-result-overlay').forEach(el => el.remove());
    modal.style.display = 'none';
}

// ── Utility ────────────────────────────────────────────────────────────────────
function _capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// ── Close on outside click ─────────────────────────────────────────────────────
window.addEventListener('click', function (e) {
    const detailsModal = document.getElementById('imgInterpDetailsModal');
    if (e.target === detailsModal) closeImgInterpDetails();
    // Note: game modal cannot be closed by clicking outside — must use Done button
});

// ── Patch publishChallenge to wire up image-interpretation cards correctly ─────
// We override the card footer rendering for image-interpretation after creation.
document.addEventListener('DOMContentLoaded', function () {
    // Patch existing sample image-interp cards in the challenges grid
    _patchImgInterpCards();

    // Also observe grid for dynamically added cards
    const grid = document.getElementById('challengesGrid');
    if (grid) {
        new MutationObserver(() => _patchImgInterpCards()).observe(grid, { childList: true });
    }
});

function _patchImgInterpCards() {
    document.querySelectorAll('.challenge-card[data-category="image-interpretation"]').forEach(card => {
        if (card.getAttribute('data-img-patched')) return;
        card.setAttribute('data-img-patched', '1');

        const id = card.getAttribute('data-id');
        const footer = card.querySelector('.challenge-footer');
        if (!footer) return;

        // Replace attempt button with "Play" that opens the image interp flow
        const attemptBtn = footer.querySelector('.btn-primary');
        if (attemptBtn) {
            attemptBtn.innerHTML = '<i class="fas fa-gamepad"></i> Play';
            attemptBtn.setAttribute('onclick', `openImgInterpDetails('${id}')`);
        }

        // Ensure Details button calls the details modal too
        const detailsBtn = footer.querySelector('.btn-secondary');
        if (detailsBtn) {
            detailsBtn.setAttribute('onclick', `openImgInterpDetails('${id}')`);
        }
    });
}
