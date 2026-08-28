/* ═══════════════════════════════════════════════════════════════
   ARTX · smooth.js
   Powers every smoothness feature declared in smooth.css.
   Auto-initialises on DOMContentLoaded. Zero external dependencies.
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── helpers ─────────────────────────────────────────────── */
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointerFine   = window.matchMedia('(pointer: fine)').matches;   // mouse / stylus
    const pointerCoarse = window.matchMedia('(pointer: coarse)').matches; // touchscreen

    /* ── 1. CUSTOM CURSOR (desktop / pointer:fine only) ──────── */
    let dot, ring, mouseX = 0, mouseY = 0, ringX = 0, ringY = 0;

    function initCursor() {
        if (!pointerFine || reducedMotion) return;

        dot  = document.createElement('div'); dot.id  = 'artx-cursor-dot';
        ring = document.createElement('div'); ring.id = 'artx-cursor-ring';
        document.body.appendChild(dot);
        document.body.appendChild(ring);

        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mousedown', () => setCursorState('clicking'));
        document.addEventListener('mouseup',   () => setCursorState(''));

        // Hover detection
        document.addEventListener('mouseover', e => {
            const t = e.target.closest(
                'a, button, [role="button"], label[for], select, .clickable, ' +
                '.p-method, .p-preset, .p-action-btn, .color-swatch, [data-accent-swatch], ' +
                '.stl-dot, .flip-card, .icon-nav-btn, .p-pill, .p-load-more, .waction-btn'
            );
            if (t) { setCursorState('hovering'); return; }

            const inp = e.target.closest(
                'input[type="text"], input[type="email"], input[type="password"], ' +
                'input[type="number"], input[type="tel"], textarea, [contenteditable]'
            );
            if (inp) { setCursorState('text'); return; }

            setCursorState('');
        }, { passive: true });

        // Hide cursor when leaving window
        document.addEventListener('mouseleave', () => {
            if (dot)  dot.style.opacity  = '0';
            if (ring) ring.style.opacity = '0';
        });
        document.addEventListener('mouseenter', () => {
            if (dot)  dot.style.opacity  = '';
            if (ring) ring.style.opacity = '';
        });

        rafCursor();
    }

    function setCursorState(state) {
        if (!dot || !ring) return;
        dot.className  = state;
        ring.className = state;
    }

    function onMouseMove(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
        // Dot snaps instantly
        if (dot) {
            dot.style.transform = `translate(calc(${mouseX}px - 50%), calc(${mouseY}px - 50%))`;
        }
    }

    function rafCursor() {
        // Ring follows with slight lag (lerp)
        ringX += (mouseX - ringX) * 0.14;
        ringY += (mouseY - ringY) * 0.14;
        if (ring) {
            ring.style.transform = `translate(calc(${ringX}px - 50%), calc(${ringY}px - 50%))`;
        }
        requestAnimationFrame(rafCursor);
    }

    /* ── 2. RIPPLE EFFECT ────────────────────────────────────── */
    const RIPPLE_TARGETS =
        'button:not([data-no-ripple]), ' +
        '.btn-submit, .btn-primary, .btn-auth, ' +
        '.p-btn-next, .p-btn-submit, .p-btn-back, ' +
        '.p-action-btn, .p-preset, .p-pill, ' +
        '.waction-btn, .wbtn-next, .wbtn-submit, ' +
        '.icon-nav-btn, .header-icon-btn, ' +
        '.color-swatch, [data-accent-swatch], ' +
        '.stl-dot, .p-load-more, ' +
        '.ch-btn-primary, .ch-btn-secondary, ' +
        '.fee-gate-btn-pay, .fee-gate-btn-cancel, .fee-gate-btn-topup, ' +
        '.post-action-btn, .quick-menu-item, .menu-item, .filter-btn';

    function spawnRipple(e) {
        const btn = e.currentTarget;
        const rect = btn.getBoundingClientRect();

        // Use touch position if available, otherwise mouse
        const clientX = (e.touches ? e.touches[0].clientX : e.clientX) ?? (rect.left + rect.width / 2);
        const clientY = (e.touches ? e.touches[0].clientY : e.clientY) ?? (rect.top + rect.height / 2);

        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const size = Math.max(rect.width, rect.height) * 2;

        const ripple = document.createElement('span');
        ripple.className = 'artx-ripple';
        ripple.style.cssText =
            `width:${size}px;height:${size}px;` +
            `left:${x - size / 2}px;top:${y - size / 2}px;`;
        btn.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    }

    function attachRipples(root = document) {
        root.querySelectorAll(RIPPLE_TARGETS).forEach(el => {
            if (el.dataset.rippleAttached) return;
            el.dataset.rippleAttached = '1';
            el.addEventListener('pointerdown', spawnRipple, { passive: true });
        });
    }

    /* ── 3. SCROLL-REVEAL (IntersectionObserver) ─────────────── */
    const REVEAL_SELECTORS = [
        '.artx-reveal',
        '.artx-reveal-left',
        '.artx-reveal-right',
        '.artx-reveal-scale',
        '.artx-reveal-stagger',
    ].join(', ');

    function initReveal() {
        if (reducedMotion) return;

        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll(REVEAL_SELECTORS).forEach(el => io.observe(el));
        return io;
    }

    /* ── 4. PAGE TRANSITION VEIL ─────────────────────────────── */
    function initPageVeil() {
        const veil = document.createElement('div');
        veil.id = 'artx-page-veil';
        document.body.appendChild(veil);

        document.addEventListener('click', e => {
            const link = e.target.closest('a[href]');
            if (!link) return;
            const href = link.getAttribute('href');
            // Only intercept same-site navigations; skip anchors, external, mailto, etc.
            if (!href || href.startsWith('#') || href.startsWith('javascript') ||
                href.startsWith('mailto') || href.startsWith('tel') ||
                link.target === '_blank' || link.hasAttribute('data-no-veil')) return;

            e.preventDefault();
            veil.classList.add('leaving');
            setTimeout(() => { window.location.href = href; }, 300);
        });
    }

    /* ── 5. SMOOTH MODAL OPEN / CLOSE HELPERS ────────────────── */
    /**
     * Smoothly open a modal element.
     * Usage: artxOpenModal(document.getElementById('myModal'))
     */
    function artxOpenModal(el) {
        if (!el) return;
        el.style.display = 'flex';
        // Force reflow so the transition fires
        void el.offsetHeight;
        el.classList.add('artx-modal-open');
        document.body.style.overflow = 'hidden';
        // Trap focus inside modal
        trapFocus(el);
    }

    /**
     * Smoothly close a modal element.
     */
    function artxCloseModal(el) {
        if (!el) return;
        el.classList.remove('artx-modal-open');
        el.classList.add('artx-modal-closing');
        const done = () => {
            el.style.display = 'none';
            el.classList.remove('artx-modal-closing');
            document.body.style.overflow = '';
        };
        el.addEventListener('transitionend', done, { once: true });
        // Fallback in case transitionend never fires (e.g. reduced-motion)
        setTimeout(done, 400);
    }

    /* Focus trap helper */
    function trapFocus(el) {
        const focusable = el.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        first.focus();
        el.addEventListener('keydown', function handler(e) {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
            }
            // Remove trap when modal is closed
            if (!el.classList.contains('artx-modal-open')) el.removeEventListener('keydown', handler);
        });
    }

    /* ── 6. TOUCH SWIPE HELPER ───────────────────────────────── */
    /**
     * Attach a swipe listener to an element.
     * cb(direction) where direction ∈ 'left'|'right'|'up'|'down'
     *
     * Usage: artxSwipe(el, dir => { if (dir === 'left') next(); })
     */
    function artxSwipe(el, cb, threshold = 40) {
        if (!el || !cb) return;
        let startX, startY;

        el.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        el.addEventListener('touchend', e => {
            if (startX === undefined) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
            if (Math.abs(dx) >= Math.abs(dy)) {
                cb(dx > 0 ? 'right' : 'left');
            } else {
                cb(dy > 0 ? 'down' : 'up');
            }
            startX = startY = undefined;
        }, { passive: true });
    }

    /* ── 7. SCROLL-DIRECTION BODY CLASS ─────────────────────── */
    /* Adds .scroll-up / .scroll-down to <body> so headers can
       auto-hide on mobile with pure CSS. */
    function initScrollDirection() {
        let last = window.scrollY;
        let ticking = false;

        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const cur = window.scrollY;
                if (Math.abs(cur - last) < 4) { ticking = false; return; }
                document.body.classList.toggle('scroll-down', cur > last && cur > 80);
                document.body.classList.toggle('scroll-up',   cur < last);
                last = cur;
                ticking = false;
            });
        }, { passive: true });
    }

    /* ── 8. OVERSCROLL BOUNCE SUPPRESSION (iOS PWA) ──────────── */
    /* Prevents the rubber-band pull on iOS from exposing white
       space behind the header / background colour. */
    function initOverscrollFix() {
        // Only needed on iOS
        if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
        document.body.style.overscrollBehaviorY = 'none';
    }

    /* ── 9. HORIZONTAL SCROLL: DRAG-TO-SCROLL ────────────────── */
    /* Makes horizontally-scrollable containers (stories, filter rows)
       draggable with the mouse on desktop. */
    const DRAG_SCROLL_SELECTOR = '.stories-container, .ch-filter-row .filters, .marketplace-filters, .challenge-filters';

    function initDragScroll() {
        document.querySelectorAll(DRAG_SCROLL_SELECTOR).forEach(el => {
            if (el.dataset.dragAttached) return;
            el.dataset.dragAttached = '1';

            let isDown = false, startX, scrollLeft;

            el.addEventListener('mousedown', e => {
                isDown = true;
                el.style.cursor = 'grabbing';
                startX = e.pageX - el.offsetLeft;
                scrollLeft = el.scrollLeft;
                e.preventDefault();
            });

            el.addEventListener('mouseleave', () => {
                isDown = false;
                el.style.cursor = '';
            });

            el.addEventListener('mouseup', () => {
                isDown = false;
                el.style.cursor = '';
            });

            el.addEventListener('mousemove', e => {
                if (!isDown) return;
                const x = e.pageX - el.offsetLeft;
                const walk = (x - startX) * 1.6;
                el.scrollLeft = scrollLeft - walk;
            });
        });
    }

    /* ── 10. MUTATION OBSERVER — auto-attach to dynamic content ─ */
    function watchDOM() {
        const mo = new MutationObserver(() => {
            attachRipples();
            initDragScroll();
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    /* ── INIT ─────────────────────────────────────────────────── */
    function init() {
        initCursor();
        attachRipples();
        initReveal();
        initPageVeil();
        initScrollDirection();
        initOverscrollFix();
        initDragScroll();
        watchDOM();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ── PUBLIC API ───────────────────────────────────────────── */
    window.artxSmooth = {
        openModal:  artxOpenModal,
        closeModal: artxCloseModal,
        swipe:      artxSwipe,
        ripple:     spawnRipple,
    };

})();
