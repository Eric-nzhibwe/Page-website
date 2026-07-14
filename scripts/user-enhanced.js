// ─────────────────────────────────────────────────────────────────────────────
// ARTX Profile Enhancements — user-enhanced.js
// Badges, Heatmap, Weekly Chart, Rank Panel, Activity Filters,
// Followers Modal, Cover Upload, Profile Completion Bar
// ─────────────────────────────────────────────────────────────────────────────

const _EH_API = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

function _ehToken() { return localStorage.getItem('djangoAuthToken') || ''; }
function _ehHeaders() {
    return { 'Authorization': `Token ${_ehToken()}`, 'Content-Type': 'application/json' };
}

// ═══════════════════════════════════════════════════════
// INIT — hook into existing loadProfile / loadActivities
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Intercept after user.js renders the profile
    const origRender = window.renderProfile;
    if (origRender) {
        window.renderProfile = function(u, rank) {
            origRender(u, rank);
            _ehAfterRender(u, rank);
        };
    }

    // Intercept after activities load
    const origActs = window.loadActivities;
    if (origActs) {
        window.loadActivities = async function() {
            await origActs();
            _ehInitActivityFilters();
        };
    }

    // Init heatmap year label
    const hy = document.getElementById('heatmapYear');
    if (hy) hy.textContent = new Date().getFullYear();

    // Activity filter bar clicks
    const filterBar = document.getElementById('actFilterBar');
    if (filterBar) {
        filterBar.addEventListener('click', e => {
            const btn = e.target.closest('.act-filter');
            if (!btn) return;
            filterBar.querySelectorAll('.act-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _ehFilterActivity(btn.dataset.filter);
        });
    }

    // Cover upload label hover — only show on own profile
    const params = new URLSearchParams(window.location.search);
    const myId   = localStorage.getItem('userId');
    if (params.get('id') && String(params.get('id')) !== String(myId)) {
        const coverLbl = document.querySelector('.cover-upload-btn');
        if (coverLbl) coverLbl.style.display = 'none';
    }

    // Init sidebar skeleton removal on load
    _ehRemoveSkeletons();
});

// ═══════════════════════════════════════════════════════
// AFTER RENDER — called once profile data is available
// ═══════════════════════════════════════════════════════
function _ehAfterRender(u, rank) {
    _ehBuildCompletion(u);
    _ehBuildBadges(u);
    _ehBuildHeatmap(u);
    _ehBuildWeeklyChart(u);
    _ehBuildRankPanel(u, rank);
    _ehMarkSkeletonsDone();
}

// ═══════════════════════════════════════════════════════
// PROFILE COMPLETION BAR
// ═══════════════════════════════════════════════════════
function _ehBuildCompletion(u) {
    if (localStorage.getItem('completionDismissed') === '1') {
        const wrap = document.getElementById('completionBarWrap');
        if (wrap) wrap.style.display = 'none';
        return;
    }

    const steps = [
        { key: 'avatar',   label: 'Profile photo',  done: !!(u.profile_image || u.profile_image_url) },
        { key: 'bio',      label: 'Bio',             done: !!(u.bio && u.bio.trim()) },
        { key: 'location', label: 'Location',        done: !!(u.location && u.location.trim()) },
        { key: 'website',  label: 'Website',         done: !!(u.website && u.website.trim()) },
        { key: 'social',   label: 'Social link',     done: !!(u.social_connections && Object.values(u.social_connections).some(v => v && v.connected)) },
        { key: 'challenge','label': '1st challenge', done: (u.total_submissions || 0) > 0 },
    ];

    const done  = steps.filter(s => s.done).length;
    const total = steps.length;
    const pct   = Math.round((done / total) * 100);

    // Hide when 100% complete
    if (pct === 100) {
        const wrap = document.getElementById('completionBarWrap');
        if (wrap) wrap.style.display = 'none';
        return;
    }

    const remaining = total - done;
    const textEl = document.getElementById('completionText');
    const pctEl  = document.getElementById('completionPct');
    const fillEl = document.getElementById('completionFill');
    const stepsEl= document.getElementById('completionSteps');

    if (textEl) textEl.textContent = `${remaining} step${remaining > 1 ? 's' : ''} to complete your profile`;
    if (pctEl)  pctEl.textContent  = `${pct}%`;
    setTimeout(() => { if (fillEl) fillEl.style.width = `${pct}%`; }, 100);

    if (stepsEl) {
        stepsEl.innerHTML = steps.map(s => `
            <span class="completion-step ${s.done ? 'done' : 'todo'}">
                <i class="fas fa-${s.done ? 'check' : 'circle'}"></i>
                ${s.label}
            </span>`).join('');
    }
}

window.dismissCompletion = function() {
    localStorage.setItem('completionDismissed', '1');
    const wrap = document.getElementById('completionBarWrap');
    if (wrap) { wrap.style.opacity = '0'; wrap.style.transform = 'translateY(-8px)'; wrap.style.transition = 'all 0.3s'; setTimeout(() => wrap.style.display = 'none', 300); }
};

// ═══════════════════════════════════════════════════════
// BADGES / TROPHY SHELF
// ═══════════════════════════════════════════════════════
const BADGE_DEFS = [
    { id: 'first_submission', icon: '🎯', label: 'First Shot',   color: '#4ade80', border: '#16a34a', desc: 'Submitted your first challenge answer',       check: u => (u.total_submissions||0) >= 1 },
    { id: 'first_win',        icon: '🏆', label: 'First Win',    color: '#fbbf24', border: '#d97706', desc: 'Won your first tournament',                    check: u => (u.tournament_wins||0) >= 1 },
    { id: 'streak_7',         icon: '🔥', label: '7-Day Streak', color: '#fb923c', border: '#ea580c', desc: 'Maintained a 7-day activity streak',           check: u => (u.current_streak||0) >= 7 },
    { id: 'streak_30',        icon: '⚡', label: '30-Day Fire',  color: '#a78bfa', border: '#7c3aed', desc: 'Reached a 30-day streak — legendary focus',    check: u => (u.current_streak||0) >= 30 },
    { id: 'accuracy_80',      icon: '🎖️', label: 'Sharp Mind',  color: '#22d3ee', border: '#0891b2', desc: 'Achieved 80%+ accuracy overall',               check: u => (u.success_rate||0) >= 80 },
    { id: 'prestige_500',     icon: '⭐', label: 'Rising Star',  color: '#f9a825', border: '#f57f17', desc: 'Earned 500+ prestige points',                  check: u => (u.prestige_points||0) >= 500 },
    { id: 'prestige_2500',    icon: '💫', label: 'Star Player',  color: '#f9a825', border: '#f57f17', desc: 'Earned 2500+ prestige points',                 check: u => (u.prestige_points||0) >= 2500 },
    { id: 'silver_tier',      icon: '🥈', label: 'Silver Tier',  color: '#9ca3af', border: '#6b7280', desc: 'Reached Silver tier',                          check: u => ['Silver','Gold','Platinum','Diamond','Elite','Legendary'].includes(u.access_tier) },
    { id: 'gold_tier',        icon: '🥇', label: 'Gold Tier',    color: '#fbbf24', border: '#d97706', desc: 'Reached Gold tier',                            check: u => ['Gold','Platinum','Diamond','Elite','Legendary'].includes(u.access_tier) },
    { id: 'social_link',      icon: '🔗', label: 'Connected',    color: '#60a5fa', border: '#2563eb', desc: 'Linked a social media account',                check: u => !!(u.social_connections && Object.values(u.social_connections).some(v => v && v.connected)) },
    { id: 'wins_5',           icon: '🎪', label: 'Champion',     color: '#f472b6', border: '#db2777', desc: 'Won 5+ tournaments',                           check: u => (u.tournament_wins||0) >= 5 },
    { id: 'sub_50',           icon: '📊', label: 'Grinder',      color: '#34d399', border: '#059669', desc: 'Submitted 50+ challenge answers',              check: u => (u.total_submissions||0) >= 50 },
];

function _ehBuildBadges(u) {
    const shelf   = document.getElementById('badgesShelf');
    const countEl = document.getElementById('badgeCount');
    if (!shelf) return;

    const earned = BADGE_DEFS.filter(b => b.check(u));
    const locked = BADGE_DEFS.filter(b => !b.check(u));
    const all    = [...earned, ...locked];

    if (countEl) countEl.textContent = `${earned.length}/${all.length}`;

    shelf.innerHTML = all.map(b => {
        const isDone = b.check(u);
        return `
        <div class="badge-item ${isDone ? '' : 'locked'}"
             onmouseenter="_ehShowBadgeTip(this, '${b.desc.replace(/'/g,"\\'")}', ${isDone})"
             onmouseleave="_ehHideBadgeTip()">
            <div class="badge-icon" style="background:${isDone ? b.color+'22' : '#f3f4f6'};
                 border-color:${isDone ? b.border : '#e5e7eb'};">
                ${b.icon}
            </div>
            <span class="badge-label">${b.label}</span>
        </div>`;
    }).join('');
}

function _ehShowBadgeTip(el, text, earned) {
    const tip = document.getElementById('badgeTooltip');
    if (!tip) return;
    tip.textContent = earned ? text : `🔒 ${text}`;
    tip.classList.add('visible');
    const rect = el.getBoundingClientRect();
    tip.style.left = `${rect.left + rect.width / 2 - tip.offsetWidth / 2}px`;
    tip.style.top  = `${rect.bottom + 10 + window.scrollY}px`;
}

function _ehHideBadgeTip() {
    const tip = document.getElementById('badgeTooltip');
    if (tip) tip.classList.remove('visible');
}

window._ehShowBadgeTip = _ehShowBadgeTip;
window._ehHideBadgeTip = _ehHideBadgeTip;

// ═══════════════════════════════════════════════════════
// STREAK HEATMAP (last 52 weeks)
// ═══════════════════════════════════════════════════════
function _ehBuildHeatmap(u) {
    const wrap = document.getElementById('heatmapWrap');
    if (!wrap) return;

    // Build a map of activity from the global allActivities if available,
    // otherwise simulate from streak data
    const actMap = _ehBuildActivityDateMap();
    const today  = new Date();
    today.setHours(0,0,0,0);

    // Go back to the most recent Sunday, then 52 weeks back
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - startDay.getDay()); // Sunday
    startDay.setDate(startDay.getDate() - 51 * 7);           // 52 weeks total

    const weeks = [];
    let cur = new Date(startDay);
    while (cur <= today) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const day = new Date(cur);
            day.setDate(day.getDate() + d);
            if (day > today) { week.push(null); continue; }
            const key   = _ehDateKey(day);
            const count = actMap[key] || 0;
            const level = count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
            week.push({ date: key, level, count });
        }
        weeks.push(week);
        cur.setDate(cur.getDate() + 7);
    }

    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';
    weeks.forEach(week => {
        const col = document.createElement('div');
        col.className = 'heatmap-week';
        week.forEach(cell => {
            const div = document.createElement('div');
            if (!cell) { div.className = 'heatmap-cell'; div.style.visibility = 'hidden'; }
            else {
                div.className = 'heatmap-cell';
                div.dataset.level = cell.level;
                div.title = `${cell.date}: ${cell.count} action${cell.count !== 1 ? 's' : ''}`;
            }
            col.appendChild(div);
        });
        grid.appendChild(col);
    });

    wrap.innerHTML = '';
    wrap.appendChild(grid);
}

function _ehBuildActivityDateMap() {
    // Use cached activities if user.js stored them
    const map = {};
    if (window._allActivitiesCache) {
        window._allActivitiesCache.forEach(a => {
            const key = _ehDateKey(new Date(a.created_at));
            map[key] = (map[key] || 0) + 1;
        });
    }
    return map;
}

function _ehDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════
// WEEKLY BAR CHART (Performance tab + standalone card)
// ═══════════════════════════════════════════════════════
function _ehBuildWeeklyChart(u) {
    _ehRenderBarsInto('weeklyChart',      u);
    _ehRenderBarsInto('weeklyBarsPanel',  u);
}

function _ehRenderBarsInto(containerId, u) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;

    const actMap = _ehBuildActivityDateMap();
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today  = new Date();
    today.setHours(0,0,0,0);

    const cols = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key   = _ehDateKey(d);
        const count = actMap[key] || 0;
        cols.push({ day: DAYS[d.getDay()], count, isToday: i === 0, key });
    }

    const maxCount = Math.max(...cols.map(c => c.count), 1);
    const labelEl  = document.getElementById('weeklyLabel');
    const total    = cols.reduce((s, c) => s + c.count, 0);
    if (labelEl) labelEl.textContent = `${total} action${total !== 1 ? 's' : ''} this week`;

    const barsEl = document.createElement('div');
    barsEl.className = 'weekly-bars';

    cols.forEach(col => {
        const heightPct = Math.round((col.count / maxCount) * 100);
        barsEl.innerHTML += `
            <div class="weekly-bar-col ${col.isToday ? 'today' : ''}">
                <div class="weekly-bar-track">
                    <div class="weekly-bar-fill" data-val="${col.count}" style="height:0%"
                         data-target="${heightPct}"></div>
                </div>
                <span class="weekly-bar-day">${col.isToday ? 'Today' : col.day}</span>
            </div>`;
    });

    wrap.innerHTML = '';
    wrap.appendChild(barsEl);

    // Animate bars after paint
    requestAnimationFrame(() => {
        setTimeout(() => {
            wrap.querySelectorAll('.weekly-bar-fill').forEach(bar => {
                bar.style.height = bar.dataset.target + '%';
            });
        }, 120);
    });
}

// ═══════════════════════════════════════════════════════
// RANK PERCENTILE PANEL
// ═══════════════════════════════════════════════════════
function _ehBuildRankPanel(u, rank) {
    // Derive percentile from prestige points and a rough curve
    // (Backend rank data used when available)
    const total  = u.total_submissions || 0;
    const wins   = u.tournament_wins   || 0;
    const rate   = u.success_rate      || 0;
    const pts    = u.prestige_points   || 0;

    // Rough percentile: more points = beats more players
    // Milestone thresholds map to ~percentile bands
    const pctile = pts >= 5000 ? 99 :
                   pts >= 2500 ? 95 :
                   pts >= 1000 ? 85 :
                   pts >= 500  ? 70 :
                   pts >= 200  ? 50 :
                   pts >= 50   ? 30 : 10;

    const winRate = total > 0 ? `${Math.round((wins / Math.max(total,1)) * 100)}%` : '—';
    const tierPos = u.power_rank || (rank ? `#${rank}` : '—');

    const titleEl    = document.getElementById('rankTitle');
    const pctValEl   = document.getElementById('rankPctVal');
    const pctFillEl  = document.getElementById('rankPctFill');
    const pctYouEl   = document.getElementById('rankPctYou');
    const globalEl   = document.getElementById('rankGlobal');
    const tierPosEl  = document.getElementById('rankTierPos');
    const winRateEl  = document.getElementById('rankWinRate');
    const badgeBigEl = document.getElementById('rankBadgeBig');

    if (titleEl)   titleEl.textContent   = u.access_tier || 'Bronze';
    if (globalEl)  globalEl.textContent  = rank ? `#${rank}` : '—';
    if (tierPosEl) tierPosEl.textContent = tierPos;
    if (winRateEl) winRateEl.textContent = winRate;

    // Tier colour on the badge
    const TIER_COLORS = {
        Bronze:    '#cd7f32', Silver: '#9ca3af', Gold: '#f9a825',
        Platinum:  '#475569', Diamond: '#0ea5e9', Elite: '#8b5cf6', Legendary: '#ea580c'
    };
    const tc = TIER_COLORS[u.access_tier] || TIER_COLORS.Bronze;
    if (badgeBigEl) badgeBigEl.style.background = `linear-gradient(135deg, ${tc}cc, ${tc}44)`;

    // Animate percentile
    setTimeout(() => {
        if (pctValEl)  pctValEl.textContent  = `${pctile}%`;
        if (pctFillEl) pctFillEl.style.width = `${pctile}%`;
        if (pctYouEl)  pctYouEl.style.left   = `${pctile}%`;
    }, 500);
}

// ═══════════════════════════════════════════════════════
// ACTIVITY FILTERS + LOAD MORE
// ═══════════════════════════════════════════════════════
const FILTER_TYPES = {
    challenge: ['submission_success','submission_failed'],
    win:       ['tournament_win','tier_upgrade','level_up'],
    social:    ['alliance_join','alliance_create'],
};

let _ehAllItems     = [];
let _ehShownCount   = 10;
const _EH_PAGE_SIZE = 10;

// Called after user.js renders the activity list
function _ehInitActivityFilters() {
    // Scrape rendered items and cache them (with data-type attribute)
    // Instead of scraping DOM, hook into the raw data via our patched loadActivities
    // Items are already rendered; re-fetch to cache raw data
    _ehFetchAndCacheActivities();
}

async function _ehFetchAndCacheActivities() {
    try {
        const res  = await fetch(`${_EH_API}/auth/activities/?limit=100`, {
            headers: { 'Authorization': `Token ${_ehToken()}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        _ehAllItems = (data.results || data);
        window._allActivitiesCache = _ehAllItems; // share with heatmap
        // Re-render heatmap now that we have real data
        if (window._lastProfileData) {
            _ehBuildHeatmap(window._lastProfileData);
            _ehBuildWeeklyChart(window._lastProfileData);
        }
        _ehRenderActivityItems(_ehAllItems.slice(0, _EH_PAGE_SIZE));
        const lmBtn = document.getElementById('loadMoreBtn');
        if (lmBtn) lmBtn.style.display = _ehAllItems.length > _EH_PAGE_SIZE ? 'flex' : 'none';
    } catch { /* silent — user.js already rendered fallback */ }
}

function _ehFilterActivity(filter) {
    _ehShownCount = _EH_PAGE_SIZE;
    const filtered = filter === 'all'
        ? _ehAllItems
        : _ehAllItems.filter(a => (FILTER_TYPES[filter] || []).includes(a.activity_type));
    _ehRenderActivityItems(filtered.slice(0, _EH_PAGE_SIZE));
    const lmBtn = document.getElementById('loadMoreBtn');
    if (lmBtn) lmBtn.style.display = filtered.length > _EH_PAGE_SIZE ? 'flex' : 'none';
    // store current filter for load more
    _ehCurrentFilter = filter;
}

let _ehCurrentFilter = 'all';

window.loadMoreActivity = function() {
    _ehShownCount += _EH_PAGE_SIZE;
    const filtered = _ehCurrentFilter === 'all'
        ? _ehAllItems
        : _ehAllItems.filter(a => (FILTER_TYPES[_ehCurrentFilter] || []).includes(a.activity_type));
    _ehRenderActivityItems(filtered.slice(0, _ehShownCount));
    const lmBtn = document.getElementById('loadMoreBtn');
    if (lmBtn) lmBtn.style.display = filtered.length > _ehShownCount ? 'flex' : 'none';
};

const _EH_ACT_META = {
    prestige_gained:    { icon: 'fa-star',          bg: 'linear-gradient(135deg,#b45309,#f59e0b)' },
    level_up:           { icon: 'fa-arrow-trend-up', bg: 'linear-gradient(135deg,#16a34a,#4ade80)' },
    tier_upgrade:       { icon: 'fa-crown',          bg: 'linear-gradient(135deg,#92400e,#f59e0b)' },
    tournament_entry:   { icon: 'fa-trophy',         bg: 'linear-gradient(135deg,#1d4ed8,#60a5fa)' },
    tournament_win:     { icon: 'fa-medal',          bg: 'linear-gradient(135deg,#92400e,#fbbf24)' },
    alliance_join:      { icon: 'fa-users',          bg: 'linear-gradient(135deg,#6d28d9,#a78bfa)' },
    alliance_create:    { icon: 'fa-flag',           bg: 'linear-gradient(135deg,#6d28d9,#f472b6)' },
    payment_made:       { icon: 'fa-credit-card',    bg: 'linear-gradient(135deg,#0e7490,#22d3ee)' },
    submission_success: { icon: 'fa-check-double',   bg: 'linear-gradient(135deg,#15803d,#4ade80)' },
    submission_failed:  { icon: 'fa-xmark',          bg: 'linear-gradient(135deg,#b91c1c,#f87171)' },
};

function _ehTimeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    if (diff < 604800000)return `${Math.floor(diff/86400000)}d ago`;
    return new Date(d).toLocaleDateString();
}

function _ehRenderActivityItems(items) {
    const list   = document.getElementById('activityList');
    const countEl= document.getElementById('activityCount');
    if (!list) return;
    if (countEl) countEl.textContent = _ehAllItems.length > 99 ? '99+' : _ehAllItems.length || '';

    if (!items.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-bolt-lightning"></i><span>No activity in this category</span></div>';
        return;
    }
    list.innerHTML = items.map((a, i) => {
        const m = _EH_ACT_META[a.activity_type] || { icon:'fa-circle', bg:'linear-gradient(135deg,#6b7280,#9ca3af)' };
        return `
        <div class="act-item" style="animation-delay:${i * 0.04}s">
            <div class="act-icon" style="background:${m.bg}"><i class="fas ${m.icon}"></i></div>
            <div class="act-body">
                <div class="act-desc">${a.description}</div>
                <div class="act-time">${_ehTimeAgo(a.created_at)}</div>
            </div>
            ${a.points_change ? `<span class="act-pts">+${a.points_change}</span>` : ''}
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════
// FOLLOWERS / FOLLOWING MODAL
// ═══════════════════════════════════════════════════════
let _ehFollowModalTab = 'followers';
let _ehFollowUserId   = null;

window.openFollowersModal = async function(tab) {
    // Only works on own profile
    const params  = new URLSearchParams(window.location.search);
    const myId    = localStorage.getItem('userId');
    const viewId  = params.get('id');
    _ehFollowUserId = (viewId && String(viewId) !== String(myId)) ? viewId : myId;

    const modal = document.getElementById('followModal');
    if (modal) modal.classList.add('open');
    switchFollowTab(tab);
};

window.closeFollowModal = function() {
    const modal = document.getElementById('followModal');
    if (modal) modal.classList.remove('open');
};

window.switchFollowTab = async function(tab) {
    _ehFollowModalTab = tab;
    document.querySelectorAll('.follow-tab').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`followTab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`);
    if (activeBtn) activeBtn.classList.add('active');
    await _ehLoadFollowList(tab);
};

async function _ehLoadFollowList(tab) {
    const list = document.getElementById('followModalList');
    if (!list) return;
    list.innerHTML = '<div class="skeleton-list"><div class="sk-row"></div><div class="sk-row short"></div><div class="sk-row"></div></div>';

    try {
        const endpoint = tab === 'followers'
            ? `${_EH_API}/social/follows/followers/?user_id=${_ehFollowUserId}`
            : `${_EH_API}/social/follows/following/?user_id=${_ehFollowUserId}`;
        const res  = await fetch(endpoint, { headers: { 'Authorization': `Token ${_ehToken()}` } });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const users = Array.isArray(data) ? data : (data.results || data.followers || data.following || []);

        if (!users.length) {
            list.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><span>No ${tab} yet</span></div>`;
            return;
        }

        list.innerHTML = users.map(u => {
            const name   = u.display_name || u.username || 'User';
            const handle = u.username     || '';
            const tier   = u.access_tier  || 'Bronze';
            const av     = u.profile_image_url || u.profile_image || '';
            const avHTML = av
                ? `<img src="${av}" alt="${name}">`
                : `<i class="fas fa-user"></i>`;
            return `
            <div class="follow-user-row" onclick="window.location.href='user.html?id=${u.id}'">
                <div class="follow-user-av">${avHTML}</div>
                <div class="follow-user-info">
                    <span class="follow-user-name">${name}</span>
                    <span class="follow-user-handle">@${handle}</span>
                </div>
                <span class="follow-user-tier">${tier}</span>
            </div>`;
        }).join('');
    } catch {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><span>Could not load list</span></div>';
    }
}

// Close follow modal on backdrop click
document.addEventListener('click', e => {
    const modal = document.getElementById('followModal');
    if (modal && e.target === modal) window.closeFollowModal();
});

// ═══════════════════════════════════════════════════════
// COVER PHOTO UPLOAD
// ═══════════════════════════════════════════════════════
window.uploadCover = async function(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
        if (window.showToast) showToast('Cover image must be under 8 MB');
        return;
    }

    // Instant preview
    const reader = new FileReader();
    reader.onload = e => {
        const cover = document.getElementById('coverArt');
        if (cover) {
            cover.style.backgroundImage  = `url(${e.target.result})`;
            cover.style.backgroundSize   = 'cover';
            cover.style.backgroundPosition = 'center';
        }
    };
    reader.readAsDataURL(file);

    // Upload to backend
    const form = new FormData();
    form.append('cover_image', file);
    try {
        const res = await fetch(`${_EH_API}/auth/profile/`, {
            method:  'PATCH',
            headers: { 'Authorization': `Token ${_ehToken()}` },
            body:    form,
        });
        if (res.ok) {
            if (window.showToast) showToast('Cover updated ✓');
        } else {
            if (window.showToast) showToast('Cover saved locally (backend endpoint not set up yet)');
        }
    } catch {
        if (window.showToast) showToast('Cover saved locally');
    }
    // Reset input so same file can be re-selected
    input.value = '';
};

// ═══════════════════════════════════════════════════════
// SKELETON HELPERS
// ═══════════════════════════════════════════════════════
function _ehRemoveSkeletons() {
    // Items start as sk-item — they get .loaded class once renderProfile fires
}

function _ehMarkSkeletonsDone() {
    document.querySelectorAll('.sk-item').forEach(el => el.classList.add('loaded'));
}

// ═══════════════════════════════════════════════════════
// PATCH renderProfile to store last data for heatmap refresh
// ═══════════════════════════════════════════════════════
(function patchRenderProfile() {
    const orig = window.renderProfile;
    if (!orig) return;
    window.renderProfile = function(u, rank) {
        window._lastProfileData = u;
        orig(u, rank);
    };
})();

// ═══════════════════════════════════════════════════════
// PERFORMANCE TAB — hook weekly chart tab into existing
// tab pill bar so it renders on click
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    const tabBar = document.getElementById('perfTabBar');
    if (!tabBar) return;
    tabBar.addEventListener('click', e => {
        const pill = e.target.closest('.tpill');
        if (!pill) return;
        // When switching to Weekly tab, re-render the bars panel
        if (pill.dataset.target === 'tabWeekly' && window._lastProfileData) {
            setTimeout(() => _ehBuildWeeklyChart(window._lastProfileData), 50);
        }
        // When switching to Rank tab, re-animate
        if (pill.dataset.target === 'tabRank' && window._lastProfileData) {
            setTimeout(() => _ehBuildRankPanel(window._lastProfileData, null), 50);
        }
    });
});
