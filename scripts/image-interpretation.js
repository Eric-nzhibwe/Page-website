/**
 * Image Interpretation Challenge — Full Game Engine
 * ===================================================
 * Flow:
 *   Card (blurred preview)
 *     → Preview modal  (title, rules, blurred image, entry fee, time limit)
 *       → [Pay &amp; Join] / [Join Free]
 *         → Game modal  (full image revealed, countdown timer)
 *           → Step 1: Observation  — user lists visual points they spot
 *           → Step 2: Interpretation — user explains each identified point
 *           → Step 3: Overall message — single textarea for the image story
 *           → [Submit] before timer expires
 *             → AI scoring via backend
 *               → Results overlay  (score breakdown, feedback, leaderboard)
 *
 * Scoring (backend, Groq AI):
 *   60%  Observation accuracy  — how many hidden points were found
 *   40%  Interpretation quality — how well meanings align with creator's key
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
const IMG_INTERP_STEPS = { OBSERVE: 1, INTERPRET: 2, OVERALL: 3 };
const IMG_INTERP_TIMER_DEFAULT = 120; // seconds (2 minutes); overridden by challenge.time_limit

// ─────────────────────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────────────────────
const _ii = {
    challenge:         null,   // full challenge object from API
    step:              IMG_INTERP_STEPS.OBSERVE,
    pointsList:        [],     // [{label, interpretation}]
    overallMessage:    '',
    timer:             null,
    secondsLeft:       IMG_INTERP_TIMER_DEFAULT,
    totalSeconds:      IMG_INTERP_TIMER_DEFAULT,
    submitted:         false,
    submitting:        false,
    startTime:         null,   // Date.now() when image was revealed
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helper — read wallet balance from DOM (populated by challenges.js)
// ─────────────────────────────────────────────────────────────────────────────
function _iiWalletBalance() {
    const el = document.getElementById('walletBalance');
    return el ? parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0 : 0;
}

function _iiSetWalletBalance(val) {
    const el = document.getElementById('walletBalance');
    if (el) el.textContent = `K${val.toFixed(2)}`;
    const badge = document.getElementById('walletBalanceBadge');
    if (badge) badge.style.display = 'flex';
    const menuBal = document.getElementById('menuBalance');
    if (menuBal) menuBal.textContent = `K${val.toFixed(2)}`;
    localStorage.setItem('walletBalance', val.toFixed(2));
}

function _iiCapitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─────────────────────────────────────────────────────────────────────────────
//  1.  OPEN PREVIEW MODAL
//  Called when user clicks a challenge card with challenge_type = image_interpretation
// ─────────────────────────────────────────────────────────────────────────────
async function openImgInterpPreview(challengeId) {
    // Load challenge data from API (or use cached if cards pre-loaded it)
    try {
        _ii.challenge = await apiService.getChallenge(challengeId);
    } catch (err) {
        _iiShowToast('Could not load challenge. Please try again.', 'error');
        return;
    }

    const c = _ii.challenge;
    const entryFee   = parseFloat(c.entry_fee || 0);
    const prize      = parseFloat(c.prize_amount || 0);
    const timeLimitS = (c.time_limit || 2) * 60; // minutes → seconds
    const pointCount = Array.isArray(c.hidden_points) ? c.hidden_points.length : '?';

    // ── Populate preview modal ──────────────────────────────────────────────
    _iiEl('iiPreviewTitle').textContent       = c.title;
    _iiEl('iiPreviewDescription').textContent = c.description || '';
    _iiEl('iiPreviewDifficulty').textContent  = _iiCapitalize(c.difficulty);
    _iiEl('iiPreviewTimeLimit').textContent   = `${c.time_limit || 2} min`;
    _iiEl('iiPreviewPointCount').textContent  = `${pointCount} hidden points`;

    // Blurred thumbnail
    const thumb = _iiEl('iiPreviewThumb');
    if (thumb) { thumb.src = c.image_url; thumb.alt = c.title; }

    // Entry fee / prize
    const feeBox = _iiEl('iiPreviewFeeBox');
    if (entryFee > 0) {
        _iiEl('iiPreviewEntryAmount').textContent = `K${entryFee.toFixed(2)}`;
        _iiEl('iiPreviewPrizeText').innerHTML     =
            prize > 0
                ? `Winner takes <strong>K${prize.toFixed(2)}</strong>`
                : 'Prestige points awarded';
        feeBox.style.display = 'flex';
    } else {
        feeBox.style.display = 'none';
    }

    // Play button label
    const playBtn = _iiEl('iiPreviewPlayBtn');
    if (playBtn) {
        playBtn.innerHTML = entryFee > 0
            ? `<i class="fas fa-coins"></i> Pay K${entryFee.toFixed(2)} &amp; Join`
            : `<i class="fas fa-play"></i> Join Free`;
    }

    _iiShowModal('imgInterpPreviewModal');
}

function closeImgInterpPreview() { _iiHideModal('imgInterpPreviewModal'); }

// ─────────────────────────────────────────────────────────────────────────────
//  2.  PAY ENTRY FEE → LAUNCH GAME
// ─────────────────────────────────────────────────────────────────────────────
async function startImgInterpGame() {
    const c        = _ii.challenge;
    const entryFee = parseFloat(c.entry_fee || 0);

    if (entryFee > 0) {
        const balance = _iiWalletBalance();
        if (balance < entryFee) {
            _iiShowToast('Insufficient wallet balance. Please top up first.', 'error');
            return;
        }

        // Try backend deduction first, fall back to local
        try {
            await apiService.deductEntryFee(entryFee, c.id, `Entry fee — ${c.title}`);
        } catch (_) {
            // Backend unavailable — deduct locally
            _iiSetWalletBalance(balance - entryFee);
        }
        _iiSetWalletBalance(_iiWalletBalance() - entryFee);
    }

    closeImgInterpPreview();
    _iiLaunchGame();
}

// ─────────────────────────────────────────────────────────────────────────────
//  3.  LAUNCH GAME MODAL
// ─────────────────────────────────────────────────────────────────────────────
function _iiLaunchGame() {
    const c = _ii.challenge;

    // Reset state
    _ii.step           = IMG_INTERP_STEPS.OBSERVE;
    _ii.pointsList     = [];
    _ii.overallMessage = '';
    _ii.submitted      = false;
    _ii.submitting     = false;
    _ii.totalSeconds   = (c.time_limit || 2) * 60;
    _ii.secondsLeft    = _ii.totalSeconds;
    _ii.startTime      = null;

    // Set image (starts blurred)
    const img = _iiEl('iiGameImage');
    if (img) { img.src = c.image_url; img.alt = c.title; img.classList.add('ii-img-blurred'); }

    _iiEl('iiGameTitle').textContent = c.title;
    _iiUpdateTimerDisplay();
    _iiEl('iiTimerFill').style.width      = '100%';
    _iiEl('iiTimerFill').style.background = 'var(--artx-primary, #556b2f)';

    // Reset steps
    _iiShowStep(IMG_INTERP_STEPS.OBSERVE);
    _iiRenderPointsList();

    _iiShowModal('imgInterpGameModal');

    // 3-2-1 countdown then reveal
    _iiCountdownReveal();
}

// ─────────────────────────────────────────────────────────────────────────────
//  4.  3-2-1 COUNTDOWN THEN IMAGE REVEAL
// ─────────────────────────────────────────────────────────────────────────────
function _iiCountdownReveal() {
    const overlay = _iiEl('iiGoOverlay');
    overlay.style.display = 'flex';
    overlay.innerHTML     = `<div class="ii-go-count">3</div><p>Get ready to observe…</p>`;
    let count = 3;

    const t = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerHTML = `<div class="ii-go-count">${count}</div><p>Get ready to observe…</p>`;
        } else {
            clearInterval(t);
            overlay.classList.add('ii-fade-out');
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.classList.remove('ii-fade-out');

                // Unblur the image
                const img = _iiEl('iiGameImage');
                if (img) img.classList.remove('ii-img-blurred');

                // Enable interaction
                _iiEl('iiAnswerSection').classList.remove('ii-disabled');

                // Start timer
                _ii.startTime = Date.now();
                _iiStartTimer();
            }, 400);
        }
    }, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  5.  TIMER
// ─────────────────────────────────────────────────────────────────────────────
function _iiStartTimer() {
    clearInterval(_ii.timer);
    _ii.timer = setInterval(() => {
        _ii.secondsLeft = Math.max(0, _ii.secondsLeft - 1);
        _iiUpdateTimerDisplay();

        const pct    = (_ii.secondsLeft / _ii.totalSeconds) * 100;
        const fillEl = _iiEl('iiTimerFill');
        if (fillEl) {
            fillEl.style.width = `${pct}%`;
            if (_ii.secondsLeft <= 20)       fillEl.style.background = '#e74c3c';
            else if (_ii.secondsLeft <= 45)  fillEl.style.background = '#f39c12';
        }

        const countEl = _iiEl('iiCountdownDisplay');
        if (countEl) {
            countEl.classList.toggle('ii-timer-danger', _ii.secondsLeft <= 20);
        }

        if (_ii.secondsLeft <= 0) {
            clearInterval(_ii.timer);
            _iiTimeUp();
        }
    }, 1000);
}

function _iiUpdateTimerDisplay() {
    const el = _iiEl('iiCountdownDisplay');
    if (!el) return;
    const m = Math.floor(_ii.secondsLeft / 60);
    const s = _ii.secondsLeft % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function _iiTimeUp() {
    if (_ii.submitted) return;
    // Auto-submit whatever they have so far
    _iiEl('iiAnswerSection').classList.add('ii-disabled');
    const img = _iiEl('iiGameImage');
    if (img) img.classList.add('ii-img-blurred');

    if (_ii.pointsList.length > 0 || _ii.overallMessage.trim()) {
        _iiDoSubmit(true); // auto-submit on timeout
    } else {
        _iiShowResult({
            timed_out:    true,
            final_score:  0,
            points_earned: 0,
            ai_feedback:  "Time's up and no points were identified. Study the image carefully next time!",
            observation_score:    0,
            interpretation_score: 0,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  6.  STEP NAVIGATION  (Observe → Interpret → Overall)
// ─────────────────────────────────────────────────────────────────────────────
function _iiShowStep(step) {
    _ii.step = step;
    const steps = ['iiStepObserve', 'iiStepInterpret', 'iiStepOverall'];
    steps.forEach((id, i) => {
        const el = _iiEl(id);
        if (el) el.style.display = (i + 1 === step) ? 'block' : 'none';
    });

    // Update progress dots
    document.querySelectorAll('.ii-step-dot').forEach((dot, i) => {
        dot.classList.toggle('active',   i + 1 === step);
        dot.classList.toggle('done',     i + 1 < step);
    });
}

// Called from Step 1 "Next: Interpret" button
function iiGoToInterpret() {
    if (_ii.pointsList.length === 0) {
        _iiShowToast('Add at least one visual point first.', 'warn');
        return;
    }
    _iiRenderInterpretForms();
    _iiShowStep(IMG_INTERP_STEPS.INTERPRET);
}

// Called from Step 2 "Next: Overall Message" button
function iiGoToOverall() {
    // Validate that all points have an interpretation filled in
    const inputs = document.querySelectorAll('.ii-interp-input');
    let allFilled = true;
    inputs.forEach((inp, i) => {
        const val = inp.value.trim();
        _ii.pointsList[i].interpretation = val;
        if (!val) allFilled = false;
    });
    if (!allFilled) {
        _iiShowToast('Please explain every point before continuing.', 'warn');
        return;
    }
    _iiShowStep(IMG_INTERP_STEPS.OVERALL);
}

// Called from Step 2 "Back" button
function iiBackToObserve() { _iiShowStep(IMG_INTERP_STEPS.OBSERVE); }

// Called from Step 3 "Back" button
function iiBackToInterpret() { _iiShowStep(IMG_INTERP_STEPS.INTERPRET); }

// ─────────────────────────────────────────────────────────────────────────────
//  7.  STEP 1 — OBSERVATION: add / remove points
// ─────────────────────────────────────────────────────────────────────────────
function iiAddPoint() {
    const input = _iiEl('iiPointInput');
    const label = input ? input.value.trim() : '';
    if (!label) { _iiShowToast('Type a label for the point first.', 'warn'); return; }
    if (_ii.pointsList.find(p => p.label.toLowerCase() === label.toLowerCase())) {
        _iiShowToast('You already added that point.', 'warn');
        return;
    }
    _ii.pointsList.push({ label, interpretation: '' });
    input.value = '';
    _iiRenderPointsList();
}

function iiRemovePoint(index) {
    _ii.pointsList.splice(index, 1);
    _iiRenderPointsList();
}

function _iiRenderPointsList() {
    const container = _iiEl('iiPointsList');
    if (!container) return;

    if (_ii.pointsList.length === 0) {
        container.innerHTML = '<p class="ii-empty-hint"><i class="fas fa-eye"></i> Study the image and add what you see below.</p>';
        return;
    }

    container.innerHTML = _ii.pointsList.map((pt, i) => `
        <div class="ii-point-tag">
            <span><i class="fas fa-circle-dot"></i> ${_escHtml(pt.label)}</span>
            <button class="ii-remove-point" onclick="iiRemovePoint(${i})" title="Remove">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Allow pressing Enter in the point input
function iiPointInputKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); iiAddPoint(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  8.  STEP 2 — INTERPRETATION: render one textarea per point
// ─────────────────────────────────────────────────────────────────────────────
function _iiRenderInterpretForms() {
    const container = _iiEl('iiInterpForms');
    if (!container) return;

    container.innerHTML = _ii.pointsList.map((pt, i) => `
        <div class="ii-interp-block">
            <label class="ii-interp-label">
                <i class="fas fa-circle-dot"></i>
                <strong>${_escHtml(pt.label)}</strong>
            </label>
            <textarea
                class="ii-interp-input"
                rows="3"
                placeholder="What does this represent? What idea or emotion does it convey?"
                data-index="${i}"
            >${_escHtml(pt.interpretation)}</textarea>
        </div>
    `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  9.  STEP 3 — OVERALL MESSAGE + SUBMIT
// ─────────────────────────────────────────────────────────────────────────────
async function iiSubmitFinal() {
    const textarea = _iiEl('iiOverallMessage');
    _ii.overallMessage = textarea ? textarea.value.trim() : '';

    if (!_ii.overallMessage) {
        _iiShowToast('Please write the overall message of the image.', 'warn');
        return;
    }
    await _iiDoSubmit(false);
}

async function _iiDoSubmit(timedOut) {
    if (_ii.submitted || _ii.submitting) return;
    _ii.submitting = true;

    clearInterval(_ii.timer);

    // Disable answer section
    _iiEl('iiAnswerSection').classList.add('ii-disabled');

    const submitBtn = _iiEl('iiSubmitFinalBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scoring…'; }

    const elapsedSeconds = _ii.startTime
        ? Math.floor((Date.now() - _ii.startTime) / 1000)
        : _ii.totalSeconds;

    // Collect final interpretations from textareas in case user edited them on step 2
    document.querySelectorAll('.ii-interp-input').forEach((inp, i) => {
        if (_ii.pointsList[i]) _ii.pointsList[i].interpretation = inp.value.trim();
    });

    try {
        const result = await apiService.submitImageInterpretation(
            _ii.challenge.id,
            _ii.pointsList,
            _ii.overallMessage,
            elapsedSeconds,
        );
        _ii.submitted = true;
        _iiShowResult(result);
    } catch (err) {
        _ii.submitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit'; }
        _iiEl('iiAnswerSection').classList.remove('ii-disabled');

        const msg = err.message || 'Submission failed. Please try again.';
        // If already submitted, show result
        if (msg.toLowerCase().includes('already submitted')) {
            _iiShowToast('You have already submitted to this challenge.', 'warn');
        } else {
            _iiShowToast(msg, 'error');
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  10.  RESULT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function _iiShowResult(result) {
    // Re-blur image
    const img = _iiEl('iiGameImage');
    if (img) img.classList.add('ii-img-blurred');

    const observScore  = result.observation_score   || 0;
    const interpScore  = result.interpretation_score || 0;
    const finalScore   = result.final_score          || 0;
    const pointsEarned = result.points_earned        || finalScore;
    const prizeAwarded = parseFloat(result.prize_awarded || 0);
    const won          = finalScore > 0 || pointsEarned > 0;

    // Parse ai_feedback — could be plain string or JSON string
    let feedbackSummary = '';
    let pointResults    = [];
    try {
        const parsed = JSON.parse(result.ai_feedback || '{}');
        feedbackSummary = parsed.summary        || '';
        pointResults    = parsed.point_results  || [];
    } catch (_) {
        feedbackSummary = result.ai_feedback || '';
    }

    // Build point results HTML
    const pointResultsHTML = pointResults.length > 0 ? `
        <div class="ii-result-points">
            <h4><i class="fas fa-list-check"></i> Point Breakdown</h4>
            ${pointResults.map(pr => `
                <div class="ii-result-point ${pr.matched ? 'matched' : 'missed'}">
                    <span class="ii-result-point-icon">
                        <i class="fas fa-${pr.matched ? 'check-circle' : 'times-circle'}"></i>
                    </span>
                    <div class="ii-result-point-body">
                        <strong>${_escHtml(pr.label)}</strong>
                        <span>${_escHtml(pr.feedback || '')}</span>
                    </div>
                    ${pr.matched ? `<span class="ii-result-point-score">${pr.score || 0}%</span>` : ''}
                </div>
            `).join('')}
        </div>
    ` : '';

    const prizeHTML = prizeAwarded > 0 ? `
        <div class="ii-result-prize">
            <i class="fas fa-coins"></i> +K${prizeAwarded.toFixed(2)} added to wallet
        </div>
    ` : '';

    const modal = _iiEl('imgInterpGameModal');
    const resultDiv = document.createElement('div');
    resultDiv.id        = 'iiResultOverlay';
    resultDiv.className = `ii-result-overlay ${won ? 'ii-result-win' : 'ii-result-lose'}`;
    resultDiv.innerHTML = `
        <div class="ii-result-inner">
            <div class="ii-result-icon">
                <i class="fas fa-${won ? 'trophy' : 'times-circle'}"></i>
            </div>
            <h3>${won ? 'Great observation!' : 'Better luck next time'}</h3>

            <div class="ii-score-grid">
                <div class="ii-score-cell">
                    <div class="ii-score-val">${observScore}%</div>
                    <div class="ii-score-key">Observation</div>
                </div>
                <div class="ii-score-cell">
                    <div class="ii-score-val">${interpScore}%</div>
                    <div class="ii-score-key">Interpretation</div>
                </div>
                <div class="ii-score-cell ii-score-total">
                    <div class="ii-score-val">${pointsEarned}</div>
                    <div class="ii-score-key">Prestige pts</div>
                </div>
            </div>

            ${feedbackSummary ? `<p class="ii-result-feedback">${_escHtml(feedbackSummary)}</p>` : ''}
            ${prizeHTML}
            ${pointResultsHTML}

            <button class="ii-btn-result-close" onclick="closeImgInterpGame()">
                <i class="fas fa-check"></i> Done
            </button>
        </div>
    `;

    // Append inside the game modal content (not the backdrop)
    const modalContent = modal.querySelector('.ii-game-modal-content');
    if (modalContent) modalContent.appendChild(resultDiv);
    else modal.appendChild(resultDiv);

    // Credit prize to wallet UI if awarded
    if (prizeAwarded > 0) {
        _iiSetWalletBalance(_iiWalletBalance() + prizeAwarded);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  11.  CLOSE GAME MODAL
// ─────────────────────────────────────────────────────────────────────────────
function closeImgInterpGame() {
    clearInterval(_ii.timer);
    _ii.submitted  = false;
    _ii.submitting = false;

    // Remove result overlay
    const overlay = document.getElementById('iiResultOverlay');
    if (overlay) overlay.remove();

    _iiHideModal('imgInterpGameModal');

    // Reload challenges list so card shows "Submitted"
    if (typeof loadChallenges === 'function') {
        loadChallenges().then(() => {
            if (typeof renderChallenges === 'function') renderChallenges();
        });
    }
}

// Alias kept for backwards-compat with any existing onclick references
function closeImgInterpDetails() { closeImgInterpPreview(); }

// ─────────────────────────────────────────────────────────────────────────────
//  12.  CARD PATCHING
//  Overrides the generic challenge card buttons for image_interpretation cards
// ─────────────────────────────────────────────────────────────────────────────
function _iiPatchCards() {
    document.querySelectorAll('.challenge-card[data-challenge-type="image_interpretation"]').forEach(card => {
        if (card.getAttribute('data-ii-patched')) return;
        card.setAttribute('data-ii-patched', '1');

        const id = card.getAttribute('data-id');
        if (!id) return;

        // Replace any existing participate/play buttons
        const footer = card.querySelector('.challenge-footer, .challenge-buttons');
        if (!footer) return;

        const existingBtns = footer.querySelectorAll('button');
        existingBtns.forEach(b => b.remove());

        footer.innerHTML = `
            <button class="btn-secondary" onclick="openImgInterpPreview('${id}'); event.stopPropagation();">
                <i class="fas fa-info-circle"></i> Details
            </button>
            <button class="btn-participate" onclick="openImgInterpPreview('${id}'); event.stopPropagation();">
                <i class="fas fa-gamepad"></i> Play
            </button>
        `;

        // Make the whole card clickable to open preview
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openImgInterpPreview(id));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  13.  INIT — patch cards on load and watch for dynamic additions
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    _iiPatchCards();

    const grid = document.getElementById('challengesGrid');
    if (grid) {
        new MutationObserver(_iiPatchCards).observe(grid, { childList: true, subtree: true });
    }

    // Close preview modal on backdrop click
    const previewModal = _iiEl('imgInterpPreviewModal');
    if (previewModal) {
        previewModal.addEventListener('click', e => {
            if (e.target === previewModal) closeImgInterpPreview();
        });
    }
    // Game modal cannot be closed by clicking outside — must use Done button
});

// ─────────────────────────────────────────────────────────────────────────────
//  14.  UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
function _iiEl(id) { return document.getElementById(id); }

function _iiShowModal(id) {
    const el = _iiEl(id);
    if (el) { el.style.display = 'flex'; }
}

function _iiHideModal(id) {
    const el = _iiEl(id);
    if (el) { el.style.display = 'none'; }
}

function _iiShowToast(msg, type = 'info') {
    // Prefer page notification system if available
    if (typeof showNotification === 'function') {
        showNotification(msg);
        return;
    }
    // Fallback: inline notice
    const existing = document.getElementById('_iiToast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id        = '_iiToast';
    el.className = `ii-toast ii-toast--${type}`;
    el.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'warn' ? 'exclamation-triangle' : 'info-circle'}"></i> ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function _escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
//  15.  GLOBAL EXPORTS  (window.* for inline onclick attributes)
// ─────────────────────────────────────────────────────────────────────────────
window.openImgInterpPreview  = openImgInterpPreview;
window.closeImgInterpPreview = closeImgInterpPreview;
window.closeImgInterpDetails = closeImgInterpDetails; // compat alias
window.startImgInterpGame    = startImgInterpGame;
window.closeImgInterpGame    = closeImgInterpGame;
window.iiAddPoint            = iiAddPoint;
window.iiRemovePoint         = iiRemovePoint;
window.iiPointInputKeydown   = iiPointInputKeydown;
window.iiGoToInterpret       = iiGoToInterpret;
window.iiGoToOverall         = iiGoToOverall;
window.iiBackToObserve       = iiBackToObserve;
window.iiBackToInterpret     = iiBackToInterpret;
window.iiSubmitFinal         = iiSubmitFinal;
