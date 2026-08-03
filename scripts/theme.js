/**
 * ARTX Theme Engine — theme.js
 *
 * Load this as the FIRST script on every page (before any other JS).
 * It reads localStorage and applies the saved accent color instantly,
 * so there is zero flash-of-wrong-color on reload.
 *
 * Also exports window.ARTX_THEME so settings.js and any other script
 * can call applyAccent / saveAccent without duplicating logic.
 */

(function () {
    'use strict';

    /* ─────────────────────────────────────────────────────────────
       PALETTE REGISTRY
       Each key  = the accent hex shown in the color swatch.
       Values    = the full set of CSS tokens for that theme.
    ───────────────────────────────────────────────────────────── */
    var PALETTES = {
        /* ── Greens (default) ── */
        '#90ee90': {
            name:       'Forest Green',
            primary:    '#556b2f',
            primaryLt:  '#6b8a3a',
            primaryDk:  '#3d4f22',
            accent:     '#90ee90',
            glow:       'rgba(85,107,47,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #f4f7f0)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #556b2f)',
        },
        /* ── Blues ── */
        '#4facfe': {
            name:       'Ocean Blue',
            primary:    '#1565c0',
            primaryLt:  '#1e88e5',
            primaryDk:  '#0d47a1',
            accent:     '#4facfe',
            glow:       'rgba(21,101,192,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #f0f4ff)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #1565c0)',
        },
        /* ── Pinks ── */
        '#f093fb': {
            name:       'Rose Pink',
            primary:    '#8e24aa',
            primaryLt:  '#ab47bc',
            primaryDk:  '#6a1b9a',
            accent:     '#f093fb',
            glow:       'rgba(142,36,170,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #fdf0ff)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #8e24aa)',
        },
        /* ── Gold ── */
        '#ffd700': {
            name:       'Gold',
            primary:    '#b8860b',
            primaryLt:  '#d4a017',
            primaryDk:  '#8b6508',
            accent:     '#ffd700',
            glow:       'rgba(184,134,11,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #fffbf0)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #b8860b)',
        },
        /* ── Red ── */
        '#ff6b6b': {
            name:       'Crimson Red',
            primary:    '#c62828',
            primaryLt:  '#e53935',
            primaryDk:  '#8e0000',
            accent:     '#ff6b6b',
            glow:       'rgba(198,40,40,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #fff0f0)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #c62828)',
        },
        /* ── Purple ── */
        '#a78bfa': {
            name:       'Deep Purple',
            primary:    '#4527a0',
            primaryLt:  '#5e35b1',
            primaryDk:  '#311b92',
            accent:     '#a78bfa',
            glow:       'rgba(69,39,160,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #f5f0ff)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #4527a0)',
        },
        /* ── Beige (new) ── */
        '#d4b483': {
            name:       'Warm Beige',
            primary:    '#8d6e37',
            primaryLt:  '#a67c45',
            primaryDk:  '#6b5028',
            accent:     '#d4b483',
            glow:       'rgba(141,110,55,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #fdf8f0)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #8d6e37)',
        },
        /* ── Brown (new) ── */
        '#a0522d': {
            name:       'Sienna Brown',
            primary:    '#6d3a1f',
            primaryLt:  '#8b4513',
            primaryDk:  '#4a2510',
            accent:     '#a0522d',
            glow:       'rgba(109,58,31,0.20)',
            bgGrad:     'linear-gradient(to left, #ffffff, #fdf5ef)',
            headerGrad: 'linear-gradient(to right, #f5f5f5, #6d3a1f)',
        },
    };

    var DEFAULT_ACCENT = '#90ee90';
    var STORAGE_KEY    = 'userPreferences';

    /* ─────────────────────────────────────────────────────────────
       APPLY — sets all CSS custom properties on :root
    ───────────────────────────────────────────────────────────── */
    function applyAccent(hex) {
        var p = PALETTES[hex] || PALETTES[DEFAULT_ACCENT];
        var r = document.documentElement;

        r.style.setProperty('--artx-primary',    p.primary);
        r.style.setProperty('--artx-primary-lt', p.primaryLt);
        r.style.setProperty('--artx-primary-dk', p.primaryDk);
        r.style.setProperty('--artx-accent',     p.accent);
        r.style.setProperty('--artx-glow',       p.glow);
        r.style.setProperty('--artx-bg-grad',    p.bgGrad);
        r.style.setProperty('--artx-header-grad',p.headerGrad);

        /* sg-* mirror vars used by settings modal */
        r.style.setProperty('--sg-primary',      p.primary);
        r.style.setProperty('--sg-primary-lt',   p.primaryLt);
        r.style.setProperty('--sg-primary-dk',   p.primaryDk);
        r.style.setProperty('--sg-accent',       p.accent);
        r.style.setProperty('--sg-glow',         '0 0 0 3px ' + p.glow);

        /* payment.css tokens */
        r.style.setProperty('--pay-primary',     p.primary);
        r.style.setProperty('--pay-primary-lt',  p.primaryLt);
        r.style.setProperty('--pay-accent',      p.accent);
        r.style.setProperty('--pay-glow',        p.glow);
    }

    /* ─────────────────────────────────────────────────────────────
       SAVE to localStorage (merged with existing prefs)
    ───────────────────────────────────────────────────────────── */
    function saveAccent(hex) {
        try {
            var prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            prefs.accentColor = hex;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch (e) { /* ignore storage errors */ }
    }

    /* ─────────────────────────────────────────────────────────────
       SELECT — apply + save + update swatches + ripple
    ───────────────────────────────────────────────────────────── */
    function selectAccent(hex) {
        applyAccent(hex);
        saveAccent(hex);

        /* Update all swatch elements (works if settings modal is open) */
        document.querySelectorAll('[data-accent-swatch]').forEach(function (el) {
            el.classList.toggle('active', el.dataset.accentSwatch === hex);
        });

        /* Show name label if it exists */
        var label = document.getElementById('smAccentLabel');
        var p     = PALETTES[hex];
        if (label && p) {
            label.textContent = p.name;
            label.style.color   = p.primary;
            label.style.opacity = '1';
            clearTimeout(label._t);
            label._t = setTimeout(function () { label.style.opacity = '0'; }, 1800);
        }

        /* Ripple animation */
        var swatch = document.querySelector('[data-accent-swatch="' + hex + '"]');
        if (swatch) {
            var ripple = document.createElement('span');
            ripple.className = 'sm-color-ripple';
            ripple.style.background = hex;
            swatch.appendChild(ripple);
            ripple.offsetWidth; /* reflow */
            ripple.classList.add('expanding');
            setTimeout(function () { ripple.remove(); }, 600);
        }
    }

    /* ─────────────────────────────────────────────────────────────
       BOOT — run immediately, before DOM paint
    ───────────────────────────────────────────────────────────── */
    (function boot() {
        try {
            var prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            var accent = prefs.accentColor || DEFAULT_ACCENT;
            applyAccent(accent);

            /* Also restore theme (dark/light) and font size */
            if (prefs.theme)    document.documentElement.setAttribute('data-theme', prefs.theme);
            if (prefs.fontSize) {
                var map = { small: '13px', medium: '15px', large: '17px' };
                document.documentElement.style.fontSize = map[prefs.fontSize] || '15px';
            }
            document.documentElement.classList.toggle('no-animations', !prefs.enableAnimations);
            document.documentElement.classList.toggle('compact-mode',  !!prefs.compactMode);
        } catch (e) { /* silent — keep CSS defaults */ }
    })();

    /* ─────────────────────────────────────────────────────────────
       PUBLIC API
    ───────────────────────────────────────────────────────────── */
    window.ARTX_THEME = {
        palettes:     PALETTES,
        defaultAccent:DEFAULT_ACCENT,
        applyAccent:  applyAccent,
        saveAccent:   saveAccent,
        selectAccent: selectAccent,
    };

}());
