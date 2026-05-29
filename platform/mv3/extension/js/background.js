/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import * as scrmgr from './scripting-manager.js';

import {
    MODE_BASIC,
    MODE_OPTIMAL,
    defaultFilteringModes,
    getDefaultFilteringMode,
    getFilteringMode,
    getFilteringModeDetails,
    persistHostPermissions,
    setDefaultFilteringMode,
    setFilteringMode,
    setFilteringModeDetails,
    syncWithBrowserPermissions,
} from './mode-manager.js';

import {
    addCustomFilters,
    customFiltersFromHostname,
    getAllCustomFilters,
    hasCustomFilters,
    injectCustomFilters,
    removeAllCustomFilters,
    removeCustomFilters,
    startCustomFilters,
    terminateCustomFilters,
} from './filter-manager.js';

import {
    adminReadEx,
    getAdminRulesets,
    loadAdminConfig,
} from './admin.js';

import {
    broadcastMessage,
    hostnameFromMatch,
    hostnamesFromMatches,
    intFromVersion,
} from './utils.js';

import {
    browser,
    localRead, localRemove, localWrite,
    runtime,
    sessionAccessLevel,
    webextFlavor,
} from './ext.js';

import {
    defaultConfig,
    loadRulesetConfig,
    process,
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';

import {
    enableRulesets,
    excludeFromStrictBlock,
    getDefaultRulesetsFromEnv,
    getEffectiveDynamicRules,
    getEffectiveSessionRules,
    getEffectiveUserRules,
    getEnabledRulesetsDetails,
    getRulesetDetails,
    patchDefaultRulesets,
    setStrictBlockMode,
    updateDynamicRules,
    updateSessionRules,
    updateUserRules,
} from './ruleset-manager.js';

import {
    getConsoleOutput,
    getMatchedRules,
    isSideloaded,
    toggleDeveloperMode,
    ubolErr,
    ubolLog,
} from './debug.js';

import {
    gotoURL,
    hasBroadHostPermissions,
} from './ext-utils.js';

import { dnr } from './ext-compat.js';
import { toggleToolbarIcon } from './action.js';

/******************************************************************************/

const UBOL_ORIGIN = runtime.getURL('').replace(/\/$/, '').toLowerCase();
const canShowBlockedCount = typeof dnr.setExtensionActionOptions === 'function';
const { registerInjectables } = scrmgr;

let pendingPermissionRequest;

/******************************************************************************/

function getCurrentVersion() {
    return runtime.getManifest().version;
}

/******************************************************************************/

async function reloadTab(tabId, url = '') {
    return new Promise(resolve => {
        self.setTimeout(( ) => {
            if ( url !== '' ) {
                browser.tabs.update(tabId, { url });
            } else {
                browser.tabs.reload(tabId);
            }
            resolve();
        }, 437);
    });
}

// When a new host permission is granted through the popup panel
async function onPermissionGrantedThruExtension(details, origins) {
    await persistHostPermissions();
    const defaultMode = await getDefaultFilteringMode();
    if ( defaultMode >= MODE_OPTIMAL ) { return; }
    if ( Array.isArray(origins) === false ) { return; }
    const hostnames = hostnamesFromMatches(origins);
    if ( hostnames.includes(details.hostname) === false ) { return; }
    const beforeLevel = await getFilteringMode(details.hostname);
    if ( beforeLevel === details.afterLevel ) { return; }
    const afterLevel = await setFilteringMode(details.hostname, details.afterLevel);
    if ( afterLevel !== details.afterLevel ) { return; }
    await registerInjectables();
    if ( rulesetConfig.autoReload !== true ) { return; }
    await reloadTab(details.tabId, details.url);
}

// When a new host permission is granted through the browser
async function onPermissionGrantedThruBrowser(origins) {
    const modified = await syncWithBrowserPermissions();
    if ( modified === false ) { return; }
    await registerInjectables();
    if ( rulesetConfig.autoReload !== true ) { return; }
    if ( origins.length !== 1 ) { return; }
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    if ( typeof tabId !== 'number' || tabId === -1 ) { return; }
    const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [ 0 ] },
        func: ( ) => document.location.hostname,
    }).catch(( ) => {
    });
    const tabHostname = results?.[0]?.result;
    if ( typeof tabHostname !== 'string' ) { return; }
    const hostname = hostnameFromMatch(origins[0]);
    if ( tabHostname.endsWith(hostname) === false ) { return; }
    const pos = tabHostname.length - hostname.length;
    if ( pos !== 0 && tabHostname.charAt(pos-1) !== '.' ) { return; }
    await reloadTab(tabId);
}

// https://github.com/uBlockOrigin/uBOL-home/issues/280
async function onPermissionsAdded(permissions) {
    const details = pendingPermissionRequest;
    pendingPermissionRequest = undefined;
    const { origins = [] } = permissions;
    return details !== undefined
        ? onPermissionGrantedThruExtension(details, origins)
        : onPermissionGrantedThruBrowser(origins);
}

async function onPermissionsRemoved() {
    const modified = await syncWithBrowserPermissions();
    if ( modified === false ) { return false; }
    registerInjectables();
    return true;
}

async function onPermissionsChanged(op, permissions) {
    await isFullyInitialized;
    const { pending } = onPermissionsChanged;
    await Promise.all(pending);
    const promise = op === 'removed'
        ? onPermissionsRemoved()
        : onPermissionsAdded(permissions);
    pending.push(promise);
}
onPermissionsChanged.pending = [];

/******************************************************************************/

function setDeveloperMode(state) {
    rulesetConfig.developerMode = state === true;
    toggleDeveloperMode(rulesetConfig.developerMode);
    broadcastMessage({ developerMode: rulesetConfig.developerMode });
    return Promise.all([
        updateUserRules(),
        saveRulesetConfig(),
    ]);
}

/******************************************************************************/
// They Live — LLM ad classification via OpenAI-compatible API

const THEY_LIVE_PHRASES = [
    'OBEY', 'CONSUME', 'WATCH TV', 'SLEEP', 'NO INDEPENDENT THOUGHT',
    'SUBMIT', 'CONFORM', 'STAY ASLEEP', 'BUY', 'WORK', 'DO NOT QUESTION AUTHORITY',
    'NO IMAGINATION', 'MARRY AND REPRODUCE', 'THIS IS YOUR GOD',
    'HONOR APATHY', 'NO IDEAS', 'WORK 8 HOURS', 'PLAY 8 HOURS',
];

// ---------------------------------------------------------------------------
// Local classification fast-path
// Checked before hitting the LLM. Resolves ~60-80% of ads with zero API cost.
// ---------------------------------------------------------------------------

// Partial hostname → phrase. Checked against [link:…] first, then [page:…].
const DOMAIN_RULES = [
    // Retail / shopping
    ['amazon', 'CONSUME'], ['ebay', 'CONSUME'], ['etsy', 'CONSUME'],
    ['walmart', 'CONSUME'], ['bestbuy', 'BUY'], ['target', 'CONSUME'],
    ['shopify', 'BUY'], ['aliexpress', 'CONSUME'], ['wish', 'BUY'],
    ['wayfair', 'CONSUME'], ['homedepot', 'BUY'], ['costco', 'CONSUME'],
    ['ikea', 'CONSUME'], ['zara', 'CONSUME'], ['nike', 'BUY'],
    ['adidas', 'BUY'], ['macys', 'CONSUME'], ['nordstrom', 'CONSUME'],
    // Streaming / entertainment
    ['netflix', 'WATCH TV'], ['youtube', 'WATCH TV'], ['twitch', 'WATCH TV'],
    ['spotify', 'WATCH TV'], ['disneyplus', 'WATCH TV'], ['disney', 'WATCH TV'],
    ['hulu', 'WATCH TV'], ['primevideo', 'WATCH TV'], ['hbomax', 'WATCH TV'],
    ['peacock', 'WATCH TV'], ['appletv', 'WATCH TV'], ['paramountplus', 'WATCH TV'],
    ['crunchyroll', 'WATCH TV'], ['funimation', 'WATCH TV'],
    // Finance / insurance
    ['chase', 'THIS IS YOUR GOD'], ['fidelity', 'THIS IS YOUR GOD'], ['vanguard', 'THIS IS YOUR GOD'],
    ['schwab', 'THIS IS YOUR GOD'], ['wellsfargo', 'THIS IS YOUR GOD'], ['bankofamerica', 'THIS IS YOUR GOD'],
    ['citibank', 'THIS IS YOUR GOD'], ['capitalone', 'THIS IS YOUR GOD'], ['americanexpress', 'THIS IS YOUR GOD'],
    ['progressive', 'WORK'], ['geico', 'WORK'], ['allstate', 'WORK'],
    ['statefarm', 'WORK'], ['creditkarma', 'THIS IS YOUR GOD'], ['experian', 'THIS IS YOUR GOD'],
    ['equifax', 'THIS IS YOUR GOD'], ['lending', 'THIS IS YOUR GOD'], ['coinbase', 'THIS IS YOUR GOD'],
    ['binance', 'THIS IS YOUR GOD'], ['robinhood', 'THIS IS YOUR GOD'],
    // News / media
    ['cnn', 'NO INDEPENDENT THOUGHT'], ['foxnews', 'NO INDEPENDENT THOUGHT'],
    ['nytimes', 'NO INDEPENDENT THOUGHT'], ['washingtonpost', 'NO INDEPENDENT THOUGHT'],
    ['bbc', 'NO INDEPENDENT THOUGHT'], ['theguardian', 'NO INDEPENDENT THOUGHT'],
    ['reuters', 'NO INDEPENDENT THOUGHT'], ['apnews', 'NO INDEPENDENT THOUGHT'],
    ['huffpost', 'NO INDEPENDENT THOUGHT'], ['dailymail', 'NO INDEPENDENT THOUGHT'],
    ['breitbart', 'NO INDEPENDENT THOUGHT'], ['politico', 'NO INDEPENDENT THOUGHT'],
    ['thehill', 'NO INDEPENDENT THOUGHT'], ['axios', 'NO INDEPENDENT THOUGHT'],
    // Social / tech
    ['facebook', 'HONOR APATHY'], ['instagram', 'HONOR APATHY'], ['twitter', 'HONOR APATHY'],
    ['x.com', 'HONOR APATHY'], ['tiktok', 'HONOR APATHY'], ['snapchat', 'HONOR APATHY'],
    ['linkedin', 'WORK 8 HOURS'], ['pinterest', 'CONFORM'],
    // Gaming
    ['steampowered', 'PLAY 8 HOURS'], ['epicgames', 'PLAY 8 HOURS'], ['xbox', 'PLAY 8 HOURS'],
    ['playstation', 'PLAY 8 HOURS'], ['nintendo', 'PLAY 8 HOURS'], ['roblox', 'PLAY 8 HOURS'],
    ['ea.com', 'PLAY 8 HOURS'], ['ubisoft', 'PLAY 8 HOURS'], ['blizzard', 'PLAY 8 HOURS'],
    // Dating / reproduction
    ['tinder', 'MARRY AND REPRODUCE'], ['bumble', 'MARRY AND REPRODUCE'],
    ['match', 'MARRY AND REPRODUCE'], ['hinge', 'MARRY AND REPRODUCE'],
    ['eharmony', 'MARRY AND REPRODUCE'],
    // Jobs / recruitment
    ['indeed', 'WORK 8 HOURS'], ['glassdoor', 'WORK 8 HOURS'], ['monster', 'WORK 8 HOURS'],
    ['ziprecruiter', 'WORK 8 HOURS'], ['upwork', 'WORK 8 HOURS'],
];

// Regex rules applied to the selector string first, then full context.
// Rules match on ad *content* (what is being advertised), NOT ad *format*.
// Format tokens like "video", "player", "banner" are deliberately excluded:
// they describe the delivery mechanism, not the product category — a video ad
// for car insurance should be "THIS IS YOUR GOD", not "WATCH TV".
// Streaming services are caught by DOMAIN_RULES (netflix, hulu, etc.).
// Ordered from most specific to least.
const KEYWORD_RULES = [
    [/\bgam(?:e|ing)\b|\besport\b/i, 'PLAY 8 HOURS'],
    [/\bshop\b|\bproduct\b|\bcart\b|\bcommerce\b|\bpurchase\b/i, 'BUY'],
    [/\bfinance\b|\bbank(?:ing)?\b|\binvest\b|\bloan\b|\binsur/i, 'THIS IS YOUR GOD'],
    [/\bcrypto\b|\bcoin\b|\btoken\b|\bnft\b|\bweb3\b/i, 'THIS IS YOUR GOD'],
    [/\bdat(?:e|ing)\b|\bmatrimony\b|\bwedding\b|\brelationship\b/i, 'MARRY AND REPRODUCE'],
    [/\bpregnancy\b|\bbaby\b|\bparenting\b|\bfertility\b/i, 'MARRY AND REPRODUCE'],
    [/\bjob\b|\bcareer\b|\brecruit\b|\bhiring\b|\bemploy\b/i, 'WORK 8 HOURS'],
    [/\bnews\b|\bbreaking\b|\bpoliti(?:cs|cal)\b|\bheadline\b/i, 'NO INDEPENDENT THOUGHT'],
    [/\bsocial\b|\bfollow\b|\bcommunity\b/i, 'HONOR APATHY'],
    [/\bsaas\b|\bsoftware\b|\bplatform\b/i, 'NO IDEAS'],
    [/\bsponsor(?:ed)?\b|\bpromot(?:ed|ion)\b|\badvert(?:is)?/i, 'OBEY'],
    [/\bleaderboard\b|\bskyscraper\b|\bbillboard\b|\bbanner\b/i, 'OBEY'],
];

// Parse a context string; return a phrase or null for "needs LLM".
const localClassify = (context) => {
    const pageMatch = context.match(/\[page:([^\]]+)\]/);
    const selMatch  = context.match(/\[sel:([^\]]+)\]/);
    const linkMatch = context.match(/\[link:([^\]]+)\]/);
    const linkHost  = linkMatch ? linkMatch[1] : '';
    const pageHost  = pageMatch ? pageMatch[1] : '';
    const selector  = selMatch  ? selMatch[1]  : '';

    // 1. Destination domain — strongest signal (what the ad is *advertising*).
    for ( const [pat, phrase] of DOMAIN_RULES ) {
        if ( linkHost.includes(pat) ) { return phrase; }
    }

    // 2. CSS selector keywords (contain ad-type info like .video-ad, [data-type="sponsored"]).
    for ( const [regex, phrase] of KEYWORD_RULES ) {
        if ( regex.test(selector) ) { return phrase; }
    }

    // 3. Full context scan — catches alt text, aria-label, visible text.
    for ( const [regex, phrase] of KEYWORD_RULES ) {
        if ( regex.test(context) ) { return phrase; }
    }

    // 4. Page domain — weakest (page may carry unrelated ads), but still useful.
    for ( const [pat, phrase] of DOMAIN_RULES ) {
        if ( pageHost.includes(pat) ) { return phrase; }
    }

    return null;
};

// ---------------------------------------------------------------------------
// System prompt is static — sent once per request; providers like OpenAI
// cache it so it costs fewer tokens on repeated calls.
const CLASSIFY_SYSTEM_PROMPT =
    `Ad classifier for satirical labelling. Output one label per ad, same order.\n` +
    `Labels: ${THEY_LIVE_PHRASES.join('|')}\n` +
    `Signals: [page:hostname] [sel:css-selector] [link:dest-hostname] visible-text [img-alt]\n` +
    `retail/shop→CONSUME/BUY; streaming-service(netflix/hulu/spotify etc)→WATCH TV; game→PLAY 8 HOURS; ` +
    `finance/bank/crypto/insurance→THIS IS YOUR GOD; job/recruitment→WORK 8 HOURS; ` +
    `news/politics→NO INDEPENDENT THOUGHT; social/influencer→HONOR APATHY; ` +
    `dating/wedding/baby→MARRY AND REPRODUCE; saas/tech/software→NO IDEAS/NO IMAGINATION; ` +
    `generic/other→OBEY. ` +
    `IMPORTANT: video/player/banner/player are ad FORMAT not category — classify by the advertised product, not the ad format.\n` +
    `Rules: exact label text only, one per line, no extra text, no numbering.`;

// In-memory classification cache (context hash → phrase).
// Persisted to chrome.storage.local under 'theyLiveCache'.
const CACHE_MAX_SIZE = 1000;
const classifyCache = new Map();
let cacheLoaded = false;

// Session-level classification stats (reset on service-worker restart).
const classifyStats = { local: 0, cache: 0, llm: 0 };

const cacheKey = (s) => {
    let h = 5381;
    for ( let i = 0; i < s.length; i++ ) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
};

const loadCache = async () => {
    if ( cacheLoaded ) { return; }
    cacheLoaded = true;
    try {
        const data = await chrome.storage.local.get('theyLiveCache');
        if ( data.theyLiveCache && typeof data.theyLiveCache === 'object' ) {
            for ( const [k, v] of Object.entries(data.theyLiveCache) ) {
                classifyCache.set(k, v);
            }
        }
    } catch { /* storage unavailable */ }
};

const persistCache = () => {
    if ( classifyCache.size > CACHE_MAX_SIZE ) {
        const excess = [...classifyCache.keys()].slice(0, classifyCache.size - CACHE_MAX_SIZE);
        for ( const k of excess ) { classifyCache.delete(k); }
    }
    chrome.storage.local.set({ theyLiveCache: Object.fromEntries(classifyCache) }).catch(() => {});
};

async function theyLiveClassify(contexts) {
    if ( contexts.length === 0 ) { return []; }

    const [enabled, url, model, apiKey, thinking] = await Promise.all([
        localRead('theyLive.aiEnabled'),
        localRead('theyLive.aiBaseUrl'),
        localRead('theyLive.aiModel'),
        localRead('theyLive.aiApiKey'),
        localRead('theyLive.aiThinking'),
    ]);
    if ( !enabled ) { return []; }

    await loadCache();

    const baseUrl = (url || 'https://ollama.com').replace(/\/$/, '');
    const aiModel = model || 'gemma4:31b-cloud';

    // Serve cache hits immediately; only call LLM for misses.
    const results = new Array(contexts.length).fill('');
    const misses = [];
    for ( let i = 0; i < contexts.length; i++ ) {
        const k = cacheKey(contexts[i]);
        const cached = classifyCache.get(k);
        if ( cached ) {
            results[i] = cached;
            classifyStats.cache++;
        } else {
            misses.push({ i, k, ctx: contexts[i] });
        }
    }
    if ( misses.length === 0 ) { return results; }

    // Local fast-path: resolve obvious cases without touching the LLM.
    let cacheUpdated = false;
    const llmMisses = [];
    for ( const miss of misses ) {
        const local = localClassify(miss.ctx);
        if ( local ) {
            results[miss.i] = local;
            classifyCache.set(miss.k, local);
            classifyStats.local++;
            cacheUpdated = true;
        } else {
            llmMisses.push(miss);
        }
    }
    if ( llmMisses.length === 0 ) {
        if ( cacheUpdated ) { persistCache(); }
        return results;
    }

    const missContexts = llmMisses.map(m => m.ctx);
    // User message: just numbered ad contexts — no repeated instructions.
    const userContent = missContexts.map((ctx, i) => `${i + 1}: ${ctx}`).join('\n');

    const headers = { 'Content-Type': 'application/json' };
    if ( apiKey ) { headers['Authorization'] = `Bearer ${apiKey}`; }

    let response;
    try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: aiModel,
                messages: [
                    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
                    { role: 'user', content: userContent },
                ],
                stream: false,
                ...(thinking ? { think: true } : {}),
            }),
            signal: AbortSignal.timeout(15000),
        });
    } catch(reason) {
        ubolErr(`theyLiveClassify/fetch/${reason}`);
        return results;
    }

    if ( !response.ok ) {
        ubolErr(`theyLiveClassify/http/${response.status}`);
        return results;
    }

    let data;
    try {
        data = await response.json();
    } catch(reason) {
        ubolErr(`theyLiveClassify/json/${reason}`);
        return results;
    }

    // OpenAI-compatible response; strip <think>…</think> blocks (Ollama reasoning models).
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const lines = content.split('\n').map(l => l.trim().toUpperCase());

    for ( let j = 0; j < llmMisses.length; j++ ) {
        const candidate = lines[j] || '';
        const phrase = THEY_LIVE_PHRASES.includes(candidate) ? candidate : '';
        results[llmMisses[j].i] = phrase;
        if ( phrase ) {
            classifyCache.set(llmMisses[j].k, phrase);
            classifyStats.llm++;
            cacheUpdated = true;
        }
    }
    if ( cacheUpdated ) { persistCache(); }
    return results;
}

/******************************************************************************/

function onMessage(request, sender, callback) {

    const tabId = sender?.tab?.id ?? false;
    const frameId = tabId && (sender?.frameId ?? false);

    // Does not require trusted origin.

    switch ( request.what ) {

    case 'insertCSS':
        if ( frameId === false ) { return false; }
        // https://bugs.webkit.org/show_bug.cgi?id=262491
        if ( frameId !== 0 && webextFlavor === 'safari' ) { return false; }
        browser.scripting.insertCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`insertCSS/${reason}`);
        });
        return false;

    case 'removeCSS':
        if ( frameId === false ) { return false; }
        // https://bugs.webkit.org/show_bug.cgi?id=262491
        if ( frameId !== 0 && webextFlavor === 'safari' ) { return false; }
        browser.scripting.removeCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`removeCSS/${reason}`);
        });
        return false;

    case 'toggleToolbarIcon': {
        if ( tabId ) {
            toggleToolbarIcon(tabId);
        }
        return false;
    }

    case 'theyLiveClassify': {
        theyLiveClassify(request.contexts || []).then(phrases => {
            callback(phrases);
        }).catch(() => {
            callback([]);
        });
        return true;
    }

    case 'getTheyLiveSettings': {
        Promise.all([
            localRead('theyLive.aiEnabled'),
            localRead('theyLive.aiBaseUrl'),
            localRead('theyLive.aiModel'),
            localRead('theyLive.aiApiKey'),
            localRead('theyLive.aiThinking'),
        ]).then(([enabled, url, model, apiKey, thinking]) => {
            callback({
                aiEnabled: Boolean(enabled),
                aiBaseUrl: url || 'https://ollama.com',
                aiModel: model || 'gemma4:31b-cloud',
                aiApiKey: apiKey || '',
                aiThinking: Boolean(thinking),
            });
        });
        return true;
    }

    case 'setTheyLiveSettings': {
        const { aiEnabled, aiBaseUrl, aiModel, aiApiKey, aiThinking } = request;
        Promise.all([
            localWrite('theyLive.aiEnabled', Boolean(aiEnabled)),
            localWrite('theyLive.aiBaseUrl', aiBaseUrl || 'https://ollama.com'),
            localWrite('theyLive.aiModel', aiModel || 'gemma4:31b-cloud'),
            localWrite('theyLive.aiApiKey', aiApiKey || ''),
            localWrite('theyLive.aiThinking', Boolean(aiThinking)),
        ]).then(() => { callback(); });
        return true;
    }

    case 'theyLiveTest': {
        const { aiBaseUrl, aiModel, aiApiKey, aiThinking } = request;
        const testUrl = (aiBaseUrl || 'https://ollama.com').replace(/\/$/, '');
        const testModel = aiModel || 'gemma4:31b-cloud';
        const headers = { 'Content-Type': 'application/json' };
        if ( aiApiKey ) { headers['Authorization'] = `Bearer ${aiApiKey}`; }
        fetch(`${testUrl}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: testModel,
                messages: [
                    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
                    { role: 'user', content: '1: buy cheap car insurance now' },
                ],
                stream: false,
                ...(aiThinking ? { think: true } : {}),
            }),
            signal: AbortSignal.timeout(15000),
        }).then(async res => {
            if ( !res.ok ) {
                callback({ ok: false, error: `HTTP ${res.status}` });
                return;
            }
            const data = await res.json();
            let label = data.choices?.[0]?.message?.content || '';
            label = label.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            callback({ ok: true, label });
        }).catch(err => {
            callback({ ok: false, error: String(err) });
        });
        return true;
    }

    case 'theyLiveClearCache': {
        classifyCache.clear();
        chrome.storage.local.remove('theyLiveCache').catch(() => {});
        callback({ size: 0 });
        return true;
    }

    case 'getTheyLiveCacheSize': {
        loadCache().then(() => { callback({ size: classifyCache.size }); });
        return true;
    }

    case 'getTheyLiveStats': {
        callback({ ...classifyStats, cacheSize: classifyCache.size });
        return false;
    }

    case 'startCustomFilters':
        if ( frameId === false ) { return false; }
        startCustomFilters(tabId, frameId).then(( ) => {
            callback();
        });
        return true;

    case 'terminateCustomFilters':
        if ( frameId === false ) { return false; }
        terminateCustomFilters(tabId, frameId).then(( ) => {
            callback();
        });
        return true;

    case 'injectCustomFilters':
        if ( frameId === false ) { return false; }
        injectCustomFilters(tabId, frameId, request.hostname).then(selectors => {
            callback(selectors);
        });
        return true;

    case 'injectCSSProceduralAPI':
        browser.scripting.executeScript({
            files: [ '/js/scripting/css-procedural-api.js' ],
            target: { tabId, frameIds: [ frameId ] },
            injectImmediately: true,
        }).catch(reason => {
            ubolErr(`executeScript/${reason}`);
        }).then(( ) => {
            callback();
        });
        return true;

    default:
        break;
    }

    // Does require trusted origin.

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender
    //   Firefox API does not set `sender.origin`
    if ( sender.origin !== undefined ) {
        if ( sender.origin.toLowerCase() !== UBOL_ORIGIN ) { return; }
    }

    switch ( request.what ) {

    case 'applyRulesets': {
        enableRulesets(request.enabledRulesets).then(result => {
            if ( result === undefined || result.error ) {
                callback(result);
                return;
            }
            rulesetConfig.enabledRulesets = result.enabledRulesets;
            return saveRulesetConfig().then(( ) => {
                return registerInjectables();
            }).then(( ) => {
                callback(result);
            });
        }).finally(( ) => {
            broadcastMessage({ enabledRulesets: rulesetConfig.enabledRulesets });
        });
        return true;
    }

    case 'getDefaultConfig':
        getDefaultRulesetsFromEnv().then(rulesets => {
            callback({
                autoReload: defaultConfig.autoReload,
                developerMode: defaultConfig.developerMode,
                showBlockedCount: defaultConfig.showBlockedCount,
                strictBlockMode: defaultConfig.strictBlockMode,
                rulesets,
                filteringModes: Object.assign(defaultFilteringModes),
            });
        });
        return true;

    case 'getOptionsPageData':
        Promise.all([
            hasBroadHostPermissions(),
            getDefaultFilteringMode(),
            getRulesetDetails(),
            dnr.getEnabledRulesets(),
            getAdminRulesets(),
            adminReadEx('disabledFeatures'),
        ]).then(results => {
            const [
                hasOmnipotence,
                defaultFilteringMode,
                rulesetDetails,
                enabledRulesets,
                adminRulesets,
                disabledFeatures,
            ] = results;
            callback({
                hasOmnipotence,
                defaultFilteringMode,
                enabledRulesets,
                adminRulesets,
                maxNumberOfEnabledRulesets: dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
                rulesetDetails: Array.from(rulesetDetails.values()),
                autoReload: rulesetConfig.autoReload,
                showBlockedCount: rulesetConfig.showBlockedCount,
                canShowBlockedCount,
                strictBlockMode: rulesetConfig.strictBlockMode,
                firstRun: process.firstRun,
                isSideloaded,
                developerMode: rulesetConfig.developerMode,
                disabledFeatures,
            });
            process.firstRun = false;
        });
        return true;

    case 'getEnabledRulesets':
        dnr.getEnabledRulesets().then(rulesets => {
            callback(rulesets);
        });
        return true;

    case 'getRulesetDetails':
        getRulesetDetails().then(rulesetDetails => {
            callback(Array.from(rulesetDetails.values()));
        });
        return true;

    case 'getEnabledRulesetsDetails':
        getEnabledRulesetsDetails().then(rulesetDetails => {
            callback(rulesetDetails);
        });
        return true;

    case 'hasBroadHostPermissions':
        hasBroadHostPermissions().then(result => {
            callback(result);
        });
        return true;

    case 'setAutoReload':
        rulesetConfig.autoReload = request.state && true || false;
        saveRulesetConfig().then(( ) => {
            callback();
            broadcastMessage({ autoReload: rulesetConfig.autoReload });
        });
        return true;

    case 'getShowBlockedCount':
        callback(rulesetConfig.showBlockedCount);
        break;

    case 'setShowBlockedCount':
        rulesetConfig.showBlockedCount = request.state && true || false;
        if ( canShowBlockedCount ) {
            dnr.setExtensionActionOptions({
                displayActionCountAsBadgeText: rulesetConfig.showBlockedCount,
            });
        }
        saveRulesetConfig().then(( ) => {
            callback();
            broadcastMessage({ showBlockedCount: rulesetConfig.showBlockedCount });
        });
        return true;

    case 'setStrictBlockMode':
        setStrictBlockMode(request.state).then(( ) => {
            callback();
            broadcastMessage({ strictBlockMode: rulesetConfig.strictBlockMode });
        });
        return true;

    case 'setDeveloperMode':
        setDeveloperMode(request.state).then(( ) => {
            callback();
        });
        return true;

    case 'popupPanelData': {
        Promise.all([
            hasBroadHostPermissions(),
            getFilteringMode(request.hostname),
            adminReadEx('disabledFeatures'),
            hasCustomFilters(request.hostname),
        ]).then(results => {
            callback({
                hasOmnipotence: results[0],
                level: results[1],
                autoReload: rulesetConfig.autoReload,
                isSideloaded,
                developerMode: rulesetConfig.developerMode,
                disabledFeatures: results[2],
                hasCustomFilters: results[3],
            });
        });
        return true;
    }

    case 'getFilteringMode': {
        getFilteringMode(request.hostname).then(actualLevel => {
            callback(actualLevel);
        });
        return true;
    }

    case 'gotoURL':
        gotoURL(request.url, request.type);
        break;

    case 'setFilteringMode': {
        getFilteringMode(request.hostname).then(beforeLevel => {
            if ( request.level === beforeLevel ) { return beforeLevel; }
            return setFilteringMode(request.hostname, request.level);
        }).then(afterLevel => {
            registerInjectables();
            callback(afterLevel);
        });
        return true;
    }

    case 'setPendingFilteringMode':
        pendingPermissionRequest = request;
        break;

    case 'getDefaultFilteringMode': {
        getDefaultFilteringMode().then(level => {
            callback(level);
        });
        return true;
    }

    case 'setDefaultFilteringMode':
        getDefaultFilteringMode().then(beforeLevel =>
            setDefaultFilteringMode(request.level).then(afterLevel =>
                ({ beforeLevel, afterLevel })
            )
        ).then(({ beforeLevel, afterLevel }) => {
            if ( afterLevel !== beforeLevel ) {
                registerInjectables();
            }
            callback(afterLevel);
        });
        return true;

    case 'getFilteringModeDetails':
        getFilteringModeDetails(true).then(details => {
            callback(details);
        });
        return true;

    case 'setFilteringModeDetails':
        setFilteringModeDetails(request.modes).then(( ) => {
            registerInjectables();
            getDefaultFilteringMode().then(defaultFilteringMode => {
                broadcastMessage({ defaultFilteringMode });
            });
            getFilteringModeDetails(true).then(details => {
                callback(details);
            });
        });
        return true;

    case 'excludeFromStrictBlock': {
        excludeFromStrictBlock(request.hostname, request.permanent).then(( ) => {
            callback();
        });
        return true;
    }

    case 'getMatchedRules':
        getMatchedRules(request.tabId).then(entries => {
            callback(entries);
        });
        return true;

    case 'showMatchedRules':
        browser.windows.create({
            type: 'popup',
            url: `/matched-rules.html?tab=${request.tabId}`,
        });
        break;

    case 'getEffectiveDynamicRules':
        getEffectiveDynamicRules().then(result => {
            callback(result);
        });
        return true;

    case 'getEffectiveSessionRules':
        getEffectiveSessionRules().then(result => {
            callback(result);
        });
        return true;

    case 'getEffectiveUserRules':
        getEffectiveUserRules().then(result => {
            callback(result);
        });
        return true;

    case 'updateUserDnrRules':
        updateUserRules().then(result => {
            callback(result);
        });
        return true;

    case 'addCustomFilters':
        addCustomFilters(request.hostname, request.selectors).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        })
        return true;

    case 'addManyCustomFilters': {
        const promises = [];
        for ( const [ hostname, selectors ] of request.entries ) {
            if ( typeof hostname !== 'string' ) { continue; }
            if ( hostname === '' ) { continue; }
            if ( Array.isArray(selectors) === false ) { continue; }
            if ( selectors.length === 0 ) { continue; }
            promises.push(addCustomFilters(hostname, selectors));
        }
        Promise.all(promises).then(results => {
            if ( results.some(a => a) === false ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        });
        return true;
    }

    case 'removeCustomFilters':
        removeCustomFilters(request.hostname, request.selectors).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        });
        return true;

    case 'removeAllCustomFilters':
        removeAllCustomFilters(request.hostname).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        });
        return true;

    case 'customFiltersFromHostname':
        customFiltersFromHostname(request.hostname).then(selectors => {
            callback(selectors);
        });
        return true;

    case 'getAllCustomFilters':
        getAllCustomFilters().then(data => {
            callback(data);
        });
        return true;

    case 'getRegisteredContentScripts':
        scrmgr.getRegisteredContentScripts().then(ids => {
            callback(ids);
        });
        return true;

    case 'getConsoleOutput':
        callback(getConsoleOutput());
        break;

    default:
        break;
    }

    return false;
}

/******************************************************************************/

function onCommand(command, tab) {
    switch ( command ) {
    case 'enter-zapper-mode': {
        if ( browser.scripting === undefined ) { return; }
        browser.scripting.executeScript({
            files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ],
            target: { tabId: tab.id },
        });
        break;
    }
    case 'enter-picker-mode': {
        if ( browser.scripting === undefined ) { return; }
        browser.scripting.executeScript({
            files: [
                '/js/scripting/css-procedural-api.js',
                '/js/scripting/tool-overlay.js',
                '/js/scripting/picker.js',
            ],
            target: { tabId: tab.id },
        });
        break;
    }
    default:
        break;
    }
}

/******************************************************************************/

async function startSession() {
    const currentVersion = getCurrentVersion();
    const isNewVersion = currentVersion !== rulesetConfig.version;

    // Admin settings override user settings
    await loadAdminConfig();

    // The default rulesets may have changed, find out new ruleset to enable,
    // obsolete ruleset to remove.
    if ( isNewVersion ) {
        const previousVersion = rulesetConfig.version;
        ubolLog(`Version change: ${rulesetConfig.version} => ${currentVersion}`);
        rulesetConfig.version = currentVersion;
        await patchDefaultRulesets();
        saveRulesetConfig();
        // https://github.com/uBlockOrigin/uBOL-home/issues/670
        if ( intFromVersion(previousVersion) <= intFromVersion('2026.423.0000') ) {
            const promises = [];
            const customFilters = await getAllCustomFilters();
            for ( const [ hostname, selectors ] of customFilters ) {
                let modified = false;
                for ( let i = 0; i < selectors.length; i++ ) {
                    const selector = selectors[i];
                    if ( selector.startsWith('0') === false ) { continue; }
                    selectors[i] = selector.slice(1);
                    modified = true;
                }
                if ( modified === false ) { continue; }
                promises.push(
                    removeAllCustomFilters(hostname).then(( ) =>
                        addCustomFilters(hostname, selectors)
                    )
                );
            }
            if ( promises.length !== 0 ) {
                await Promise.all(promises);
            }
        }
    }

    const rulesetsUpdated = await enableRulesets(rulesetConfig.enabledRulesets);

    // We need to update the regex rules only when ruleset version changes.
    if ( rulesetsUpdated === undefined ) {
        if ( isNewVersion ) {
            updateDynamicRules();
        } else {
            updateSessionRules();
        }
    }

    // Permissions may have been removed while the extension was disabled
    const permissionsUpdated = await syncWithBrowserPermissions();

    const shouldInject = isNewVersion || permissionsUpdated ||
        isSideloaded && rulesetConfig.developerMode;
    if ( shouldInject ) {
        await registerInjectables();
    }

    // Cosmetic filtering-related content scripts cache fitlering data in
    // session storage.
    sessionAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest
    //   Firefox API does not support `dnr.setExtensionActionOptions`
    if ( canShowBlockedCount ) {
        dnr.setExtensionActionOptions({
            displayActionCountAsBadgeText: rulesetConfig.showBlockedCount,
        });
    }

    // Switch to basic filtering if uBOL doesn't have broad permissions at
    // install time.
    if ( process.firstRun ) {
        const enableOptimal = await hasBroadHostPermissions();
        if ( enableOptimal === false ) {
            const afterLevel = await setDefaultFilteringMode(MODE_BASIC);
            if ( afterLevel === MODE_BASIC ) {
                registerInjectables();
                process.firstRun = false;
            }
        }
    }

    // Required to ensure up to date properties are available when needed
    adminReadEx('disabledFeatures').then(items => {
        if ( Array.isArray(items) === false ) { return; }
        if ( items.includes('develop') ) {
            if ( rulesetConfig.developerMode ) {
                setDeveloperMode(false);
            }
        }
    });
}

/******************************************************************************/

async function start() {
    await loadRulesetConfig();

    if ( process.wakeupRun === false ) {
        await startSession();
    } else {
        scrmgr.onWakeupRun();
    }

    const scripts = await scrmgr.getRegisteredContentScripts();
    if ( scripts.length === 0 ) {
        registerInjectables();
    }

    toggleDeveloperMode(rulesetConfig.developerMode);
}

/******************************************************************************/

// https://github.com/uBlockOrigin/uBOL-home/issues/199
// Force a restart of the extension once when an "internal error" occurs

const isFullyInitialized = start().then(( ) => {
    localRemove('goodStart');
    return false;
}).catch(reason => {
    ubolErr(reason);
    if ( process.wakeupRun ) { return; }
    return localRead('goodStart').then(goodStart => {
        if ( goodStart === false ) {
            localRemove('goodStart');
            return false;
        }
        return localWrite('goodStart', false).then(( ) => true);
    });
}).then(restart => {
    if ( restart !== true ) { return; }
    runtime.reload();
});

runtime.onMessage.addListener((request, sender, callback) => {
    isFullyInitialized.then(( ) => {
        const r = onMessage(request, sender, callback);
        if ( r !== true ) { callback(); }
    });
    return true;
});

browser.permissions.onRemoved.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onPermissionsChanged('removed', ...args);
    });
});

browser.permissions.onAdded.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onPermissionsChanged('added', ...args);
    });
});

browser.commands.onCommand.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onCommand(...args);
    });
});
