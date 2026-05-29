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
    const [stats, logData] = await Promise.all([
        sendMessage({ what: 'getTheyLiveStats' }),
        sendMessage({ what: 'getTheyLiveLog' }),
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
