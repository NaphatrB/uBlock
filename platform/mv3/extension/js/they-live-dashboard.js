/*******************************************************************************

    uBlock Origin Lite — They Live AI Classification Dashboard
    Provides the "They Live" tab in the extension dashboard.

*******************************************************************************/

import { sendMessage } from './ext.js';

/******************************************************************************/

const qs = id => document.querySelector(id);

const fmt = n => Number(n || 0).toLocaleString();

const timeAgo = ts => {
    const s = Math.round((Date.now() - ts) / 1000);
    if ( s < 5 )   { return 'just now'; }
    if ( s < 60 )  { return `${s}s ago`; }
    if ( s < 3600 ) { return `${Math.round(s / 60)}m ago`; }
    return `${Math.round(s / 3600)}h ago`;
};

// Source badge colours (background).
const SRC_COLOR = { llm: '#b03', local: '#171', cache: '#336' };

/******************************************************************************/

function renderPhraseTable(phraseFreq) {
    const el = qs('#tlPhraseTable');
    if ( !el ) { return; }
    const entries = Object.entries(phraseFreq || {}).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((n, [, c]) => n + c, 0);
    if ( entries.length === 0 ) {
        el.innerHTML = '<span style="color:#aaa">No data yet — browse some pages with AI enabled.</span>';
        return;
    }
    const max = entries[0][1];
    const rows = entries.map(([phrase, count]) => {
        const pct = total > 0 ? (count / total * 100).toFixed(1) : '0.0';
        const barW = max > 0 ? Math.round(count / max * 140) : 0;
        return `<tr>
            <td style="padding:4px 14px 4px 0;font-weight:600;white-space:nowrap;font-size:0.88em">${phrase}</td>
            <td style="padding:4px 10px;color:#555;font-variant-numeric:tabular-nums;text-align:right;font-size:0.88em">${fmt(count)}</td>
            <td style="padding:4px 10px;color:#999;font-variant-numeric:tabular-nums;text-align:right;font-size:0.85em">${pct}%</td>
            <td style="padding:4px 0;width:150px;vertical-align:middle">
                <div style="height:9px;width:${barW}px;background:#c44;border-radius:3px;opacity:0.7"></div>
            </td>
        </tr>`;
    }).join('');
    el.innerHTML = `<table style="border-collapse:collapse">${rows}</table>`;
}

function renderProfileSection(profile) {
    const el = qs('#tlProfile');
    if ( !el ) { return; }
    if ( !profile || profile.totalAds === 0 ) {
        el.innerHTML = '<span style="color:#aaa">No data yet — browse some pages with AI enabled.</span>';
        return;
    }

    const score = profile.profileScore || 0;
    const scoreBar = '█'.repeat(score) + '░'.repeat(10 - score);
    const scoreDesc = score >= 8 ? 'Heavily targeted — you\'re in valuable segments'
                    : score >= 5 ? 'Moderately targeted'
                    : score >= 2 ? 'Light targeting'
                    : 'Minimal targeting detected';

    // Interests inferred from classified ad categories.
    let interestsHtml = '';
    if ( profile.interests?.length > 0 ) {
        const maxCount = profile.interests[0].count;
        const rows = profile.interests.map(({ trait, count, pct }) => {
            const barW = maxCount > 0 ? Math.round(count / maxCount * 120) : 0;
            return `<tr>
                <td style="padding:3px 14px 3px 0;font-size:0.88em;white-space:nowrap">${trait}</td>
                <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;font-size:0.85em;color:#555">${fmt(count)}</td>
                <td style="padding:3px 8px;text-align:right;color:#999;font-size:0.82em">${pct}%</td>
                <td style="padding:3px 0;width:130px;vertical-align:middle">
                    <div style="height:8px;width:${barW}px;background:#174;border-radius:3px;opacity:0.8"></div>
                </td>
            </tr>`;
        }).join('');
        interestsHtml = `
            <div style="margin-bottom:18px">
                <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin-bottom:6px;font-weight:600">Interests they've filed you under</div>
                <table style="border-collapse:collapse">${rows}</table>
            </div>`;
    }

    // Retargeting — advertisers seen across 2+ classification events.
    let retargetHtml = '';
    const retargeters = (profile.retargeters || []).filter(r => r.count >= 2);
    if ( retargeters.length > 0 ) {
        const items = retargeters.map(({ domain, count, pageCount }) =>
            `<tr>
                <td style="padding:3px 14px 3px 0;font-family:monospace;font-size:0.86em">${domain}</td>
                <td style="padding:3px 10px;color:#c44;font-size:0.85em;white-space:nowrap">seen ${count}×</td>
                <td style="padding:3px 0;color:#999;font-size:0.82em;white-space:nowrap">across ${pageCount} site${pageCount !== 1 ? 's' : ''}</td>
            </tr>`
        ).join('');
        retargetHtml = `
            <div style="margin-bottom:18px">
                <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin-bottom:6px;font-weight:600">Advertisers following you (retargeting pixels)</div>
                <table style="border-collapse:collapse">${items}</table>
            </div>`;
    } else {
        retargetHtml = `
            <div style="margin-bottom:18px">
                <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin-bottom:4px;font-weight:600">Advertisers following you (retargeting pixels)</div>
                <span style="color:#aaa;font-size:0.88em">None detected yet — browse more pages.</span>
            </div>`;
    }

    // Raw Google/DoubleClick cust_params (direct targeting evidence).
    let dcHtml = '';
    if ( profile.customParams?.length > 0 ) {
        const items = profile.customParams.slice(-5).reverse().map(({ page, params }) => {
            const escaped = params.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div style="font-size:0.82em;margin:3px 0;font-family:monospace;color:#555;word-break:break-all">[${page}] ${escaped}</div>`;
        }).join('');
        dcHtml = `
            <div style="margin-bottom:18px">
                <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin-bottom:6px;font-weight:600">Raw ad-platform targeting data (Google/DoubleClick)</div>
                ${items}
            </div>`;
    }

    el.innerHTML = `
        <div style="margin-bottom:18px">
            <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin-bottom:4px;font-weight:600">Profile intensity</div>
            <div style="font-family:monospace;font-size:1.1em;letter-spacing:0.06em;color:#c44">${scoreBar}</div>
            <div style="font-size:0.83em;color:#666;margin-top:3px">${score}/10 — ${scoreDesc}</div>
        </div>
        ${interestsHtml}${retargetHtml}${dcHtml}
        <div style="margin-top:8px">
            <button type="button" id="tlAnalyseBtn" class="dontshrink">🤖 Analyse with AI</button>
            <span style="font-size:0.82em;color:#aaa;margin-left:8px">Let the LLM read your profile and explain what it means</span>
        </div>
        <div id="tlProfileAnalysis" style="margin-top:12px"></div>`;

    qs('#tlAnalyseBtn')?.addEventListener('click', analyseProfile);
}

async function analyseProfile() {
    const btn = qs('#tlAnalyseBtn');
    const out = qs('#tlProfileAnalysis');
    if ( !out ) { return; }

    if ( btn ) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }
    out.innerHTML = '<span style="color:#aaa;font-size:0.88em">Sending profile to LLM…</span>';

    const result = await sendMessage({ what: 'theyLiveAnalyseProfile' });

    if ( btn ) { btn.disabled = false; btn.textContent = '🤖 Analyse with AI'; }

    if ( result?.error ) {
        out.innerHTML = `<span style="color:#c44;font-size:0.88em">⚠ ${result.error}</span>`;
        return;
    }

    if ( result?.analysis ) {
        // Render the LLM's bullet-point analysis in a styled box.
        const escaped = result.analysis.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = escaped.split('\n').filter(l => l.trim());
        const html = lines.map(l => `<div style="margin:5px 0;font-size:0.88em;line-height:1.5">${l}</div>`).join('');
        out.innerHTML = `<div style="background:#f7f7f7;border-left:3px solid #c44;padding:12px 16px;border-radius:0 4px 4px 0;margin-top:4px">${html}</div>`;
    }
}

function renderLogTable(log) {
    const el = qs('#tlLogTable');
    if ( !el ) { return; }
    if ( !log || log.length === 0 ) {
        el.innerHTML = '<span style="color:#aaa">No LLM or local-path calls yet this session.</span>';
        return;
    }
    const rows = log.slice().reverse().map(entry => {
        const bg = SRC_COLOR[entry.source] || '#555';
        const ctx = entry.ctx.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<tr style="border-bottom:1px solid rgba(0,0,0,0.06)">
            <td style="padding:4px 10px 4px 0;color:#aaa;white-space:nowrap;font-size:0.82em">${timeAgo(entry.ts)}</td>
            <td style="padding:4px 10px 4px 0;white-space:nowrap">
                <span style="background:${bg};color:#fff;padding:1px 6px;border-radius:3px;font-size:0.75em;letter-spacing:0.03em">${entry.source}</span>
            </td>
            <td style="padding:4px 10px 4px 0;font-weight:600;white-space:nowrap;font-size:0.84em">${entry.phrase}</td>
            <td style="padding:4px 0;color:#555;font-size:0.78em;font-family:monospace;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${ctx}">${ctx}</td>
        </tr>`;
    }).join('');
    el.innerHTML = `<table style="border-collapse:collapse;width:100%">${rows}</table>`;
}

/******************************************************************************/

async function refresh() {
    const [stats, logData, profile] = await Promise.all([
        sendMessage({ what: 'getTheyLiveStats' }),
        sendMessage({ what: 'getTheyLiveLog' }),
        sendMessage({ what: 'getTheyLiveProfile' }),
    ]);

    if ( stats ) {
        const localEl = qs('#tlLocal');
        const cacheEl = qs('#tlCache');
        const llmEl   = qs('#tlLlm');
        const sizeEl  = qs('#tlCacheSize');
        if ( localEl ) { localEl.textContent = fmt(stats.local); }
        if ( cacheEl ) { cacheEl.textContent = fmt(stats.cache); }
        if ( llmEl )   { llmEl.textContent   = fmt(stats.llm); }
        if ( sizeEl )  { sizeEl.textContent  = fmt(stats.cacheSize); }
        renderPhraseTable(stats.phraseFreq);
    }

    if ( profile !== undefined ) {
        renderProfileSection(profile);
    }

    if ( logData ) {
        renderLogTable(logData.log);
    }

    const lastRefreshEl = qs('#tlLastRefresh');
    if ( lastRefreshEl ) {
        lastRefreshEl.textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
    }
}

/******************************************************************************/

// Auto-refresh only while the They Live pane is active.
let refreshTimer = null;

function startRefresh() {
    refresh();
    if ( !refreshTimer ) {
        refreshTimer = setInterval(refresh, 5000);
    }
}

function stopRefresh() {
    if ( refreshTimer ) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

new MutationObserver(() => {
    if ( document.body.dataset.pane === 'they-live' ) {
        startRefresh();
    } else {
        stopRefresh();
    }
}).observe(document.body, { attributes: true, attributeFilter: ['data-pane'] });

// Already on this pane when the script loads.
if ( document.body.dataset.pane === 'they-live' ) {
    startRefresh();
}

/******************************************************************************/

// Manual refresh button.
qs('#tlRefreshBtn')?.addEventListener('click', refresh);

// Export log as JSON.
qs('#tlExportLog')?.addEventListener('click', () => {
    sendMessage({ what: 'getTheyLiveLog' }).then(data => {
        if ( !data?.log ) { return; }
        const blob = new Blob(
            [JSON.stringify(data.log, null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `they-live-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
});

// "Settings" link — switch to the settings pane.
qs('#tlGoToSettings')?.addEventListener('click', ev => {
    ev.preventDefault();
    document.body.dataset.pane = 'settings';
});

/******************************************************************************/
