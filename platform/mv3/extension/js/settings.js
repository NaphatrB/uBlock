/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2014-present Raymond Hill

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

import { browser, i18n, sendMessage } from './ext.js';
import { dom, qs$ } from './dom.js';
import { hashFromIterable } from './dashboard.js';
import { renderFilterLists } from './filter-lists.js';

/******************************************************************************/

let cachedRulesetData = {};

/******************************************************************************/

function renderAdminRules() {
    const { disabledFeatures: forbid = [] } = cachedRulesetData;
    if ( forbid.length === 0 ) { return; }
    dom.body.dataset.forbid = forbid.join(' ');
    if ( forbid.includes('dashboard') ) {
        dom.body.dataset.pane = 'about';
    }
}

/******************************************************************************/

function renderWidgets() {
    if ( cachedRulesetData.firstRun ) {
        dom.cl.add(dom.body, 'firstRun');
    }

    renderDefaultMode();

    qs$('#autoReload input[type="checkbox"]').checked = cachedRulesetData.autoReload;

    {
        const input = qs$('#showBlockedCount input[type="checkbox"]');
        if ( cachedRulesetData.canShowBlockedCount ) {
            input.checked = cachedRulesetData.showBlockedCount;
        } else {
            input.checked = false;
            dom.attr(input, 'disabled', '');
        }
    }

    {
        const input = qs$('#strictBlockMode input[type="checkbox"]');
        const canStrictBlock = cachedRulesetData.hasOmnipotence;
        input.checked = canStrictBlock && cachedRulesetData.strictBlockMode;
        dom.attr(input, 'disabled', canStrictBlock ? null : '');
    }

    {
        const state = Boolean(cachedRulesetData.developerMode) &&
            cachedRulesetData.disabledFeatures?.includes('develop') !== true;
        dom.body.dataset.develop = `${state}`;
        dom.prop('#developerMode input[type="checkbox"]', 'checked', state);
    }
}

/******************************************************************************/

function renderDefaultMode() {
    const defaultLevel = cachedRulesetData.defaultFilteringMode;
    if ( defaultLevel !== 0 ) {
        qs$(`.filteringModeCard input[type="radio"][value="${defaultLevel}"]`).checked = true;
    } else {
        dom.prop('.filteringModeCard input[type="radio"]', 'checked', false);
    }
}

/******************************************************************************/

async function onFilteringModeChange(ev) {
    const input = ev.target;
    const newLevel = parseInt(input.value, 10);

    switch ( newLevel ) {
    case 1: {
        const actualLevel = await sendMessage({
            what: 'setDefaultFilteringMode',
            level: newLevel,
        });
        cachedRulesetData.defaultFilteringMode = actualLevel;
        break;
    }
    case 2:
    case 3: {
        const granted = await browser.permissions.request({
            origins: [ '<all_urls>' ],
        });
        if ( granted ) {
            const actualLevel = await sendMessage({
                what: 'setDefaultFilteringMode',
                level: newLevel,
            });
            cachedRulesetData.defaultFilteringMode = actualLevel;
            cachedRulesetData.hasOmnipotence = true;
        }
        break;
    }
    default:
        break;
    }
    renderFilterLists(cachedRulesetData);
    renderWidgets();
}

dom.on(
    '#defaultFilteringMode',
    'change',
    '.filteringModeCard input[type="radio"]',
    ev => { onFilteringModeChange(ev); }
);

/******************************************************************************/

async function backupSettings() {
    const api = await import('./backup-restore.js');
    const data = await api.backupToObject(cachedRulesetData);
    if ( data instanceof Object === false ) { return; }
    const json = JSON.stringify(data, null, 2)  + '\n';
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(json)}`;
    dom.attr(a, 'download', 'my-ubol-settings.json');
    dom.attr(a, 'type', 'application/json');
    a.click();
}

async function restoreSettings() {
    const promise = new Promise(resolve => {
        const input = qs$('section[data-pane="settings"] input[type="file"]');
        input.onchange = ev => {
            dom.cl.add(dom.body, 'busy');
            input.onchange = null;
            const file = ev.target.files[0];
            if ( file === undefined || file.name === '' ) { return resolve(); }
            const fr = new FileReader();
            fr.onload = ( ) => {
                fr.onload = null;
                if ( typeof fr.result !== 'string' ) { return resolve(); }
                let data;
                try {
                    data = JSON.parse(fr.result);
                } catch {
                }
                if ( data instanceof Object === false ) { return resolve(); }
                import('./backup-restore.js').then(api => {
                    resolve(api.restoreFromObject(data));
                });
            };
            fr.readAsText(file);
        };
        input.oncancel = ( ) => {
            resolve();
        };
        // Reset to empty string, this will ensure a change event is properly
        // triggered if the user pick a file, even if it's the same as the last
        // one picked.
        input.value = '';
        input.click();
    });
    await promise;
    dom.cl.remove(dom.body, 'busy');
}

async function resetSettings() {
    const response = self.confirm(i18n.getMessage('resetToDefaultConfirm'));
    if ( response !== true ) { return; }
    dom.cl.add(dom.body, 'busy');
    const api = await import('./backup-restore.js');
    await api.restoreFromObject({});
    dom.cl.remove(dom.body, 'busy');
}

/******************************************************************************/

dom.on('#autoReload input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setAutoReload',
        state: ev.target.checked,
    });
});

dom.on('#showBlockedCount input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setShowBlockedCount',
        state: ev.target.checked,
    });
});

dom.on('#strictBlockMode input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setStrictBlockMode',
        state: ev.target.checked,
    });
});

dom.on('#developerMode input[type="checkbox"]', 'change', ev => {
    const state = ev.target.checked;
    sendMessage({ what: 'setDeveloperMode', state });
    dom.body.dataset.develop = `${state}`;
});

dom.on('section[data-pane="settings"] [data-i18n="backupButton"]', 'click', ( ) => {
    backupSettings();
});

dom.on('section[data-pane="settings"] [data-i18n="restoreButton"]', 'click', ( ) => {
    restoreSettings();
});

dom.on('section[data-pane="settings"] [data-i18n="resetToDefaultButton"]', 'click', ( ) => {
    resetSettings();
});

/******************************************************************************/
// They Live — AI classification settings

{
    const enabledEl = document.querySelector('#theyLiveEnabled');
    const urlEl = document.querySelector('#theyLiveAiUrl');
    const modelEl = document.querySelector('#theyLiveAiModel');
    const apiKeyEl = document.querySelector('#theyLiveAiApiKey');
    const thinkingEl = document.querySelector('#theyLiveThinking');
    const saveBtn = document.querySelector('#theyLiveSave');
    const testBtn = document.querySelector('#theyLiveTest');
    const clearCacheBtn = document.querySelector('#theyLiveClearCache');
    const cacheSizeEl = document.querySelector('#theyLiveCacheSize');
    const statusEl = document.querySelector('#theyLiveSaveStatus');
    const fieldsEl = document.querySelector('#theyLiveAiFields');
    const statsEl = document.querySelector('#theyLiveStats');
    const statLocalEl = document.querySelector('#theyLiveStatLocal');
    const statCacheEl = document.querySelector('#theyLiveStatCache');
    const statLlmEl = document.querySelector('#theyLiveStatLlm');
    const phraseTableEl = document.querySelector('#theyLivePhraseTable');
    const exportRowEl = document.querySelector('#theyLiveExportRow');
    const exportLogBtn = document.querySelector('#theyLiveExportLog');

    const refreshStats = () => {
        sendMessage({ what: 'getTheyLiveStats' }).then(s => {
            if ( !s || !statsEl ) { return; }
            const total = s.local + s.cache + s.llm;
            statsEl.style.display = total > 0 ? '' : 'none';
            if ( statLocalEl ) { statLocalEl.textContent = s.local; }
            if ( statCacheEl ) { statCacheEl.textContent = s.cache; }
            if ( statLlmEl ) { statLlmEl.textContent = s.llm; }
            if ( cacheSizeEl && s.cacheSize !== undefined ) {
                cacheSizeEl.textContent = `${s.cacheSize} cached`;
            }
            // Render phrase frequency distribution table.
            const freq = s.phraseFreq || {};
            const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
            const grandTotal = entries.reduce((n, [, c]) => n + c, 0);
            if ( phraseTableEl ) {
                if ( entries.length > 0 ) {
                    const rows = entries.map(([phrase, count]) => {
                        const pct = grandTotal > 0 ? Math.round(count / grandTotal * 100) : 0;
                        const bar = '█'.repeat(Math.round(pct / 5));
                        return `<tr>
                            <td style="padding:1px 8px 1px 0;color:#333;white-space:nowrap">${phrase}</td>
                            <td style="padding:1px 8px 1px 0;color:#888;font-variant-numeric:tabular-nums">${count}</td>
                            <td style="padding:1px 0;color:#aaa;font-size:0.9em">${bar} ${pct}%</td>
                        </tr>`;
                    }).join('');
                    phraseTableEl.innerHTML = `<b style="color:#555">Label distribution (session)</b><table style="border-collapse:collapse;margin-top:4px">${rows}</table>`;
                    phraseTableEl.style.display = '';
                } else {
                    phraseTableEl.style.display = 'none';
                }
            }
            if ( exportRowEl ) {
                exportRowEl.style.display = entries.length > 0 ? '' : 'none';
            }
        });
    };

    const refreshFieldVisibility = () => {
        if ( fieldsEl ) {
            fieldsEl.style.display = enabledEl?.checked ? '' : 'none';
        }
    };

    if ( enabledEl ) {
        enabledEl.addEventListener('change', refreshFieldVisibility);
    }

    if ( testBtn ) {
        testBtn.addEventListener('click', () => {
            if ( statusEl ) { statusEl.textContent = '⏳ Testing…'; }
            testBtn.disabled = true;
            sendMessage({
                what: 'theyLiveTest',
                aiBaseUrl: urlEl?.value.trim() || 'https://ollama.com',
                aiModel: modelEl?.value.trim() || 'gemma4:31b-cloud',
                aiApiKey: apiKeyEl?.value || '',
                aiThinking: thinkingEl?.checked || false,
            }).then(result => {
                testBtn.disabled = false;
                if ( !statusEl ) { return; }
                if ( result?.ok ) {
                    statusEl.textContent = `✓ Connected — got: "${result.label}"`;
                } else {
                    statusEl.textContent = `✗ Failed: ${result?.error || 'unknown error'}`;
                }
                setTimeout(() => { statusEl.textContent = ''; }, 6000);
            });
        });
    }

    if ( clearCacheBtn ) {
        clearCacheBtn.addEventListener('click', () => {
            sendMessage({ what: 'theyLiveClearCache' }).then(() => {
                if ( cacheSizeEl ) { cacheSizeEl.textContent = '0 cached'; }
                if ( statsEl ) { statsEl.style.display = 'none'; }
            });
        });
    }

    if ( exportLogBtn ) {
        exportLogBtn.addEventListener('click', () => {
            sendMessage({ what: 'getTheyLiveLog' }).then(data => {
                if ( !data?.log ) { return; }
                const blob = new Blob(
                    [JSON.stringify(data.log, null, 2)],
                    { type: 'application/json' }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `they-live-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        });
    }

    if ( saveBtn ) {
        saveBtn.addEventListener('click', () => {
            sendMessage({
                what: 'setTheyLiveSettings',
                aiEnabled: enabledEl?.checked || false,
                aiBaseUrl: urlEl?.value.trim() || 'https://ollama.com',
                aiModel: modelEl?.value.trim() || 'gemma4:31b-cloud',
                aiApiKey: apiKeyEl?.value || '',
                aiThinking: thinkingEl?.checked || false,
            }).then(() => {
                if ( statusEl ) {
                    statusEl.textContent = '✓ Saved';
                    setTimeout(() => { statusEl.textContent = ''; }, 2000);
                }
            });
        });
    }

    sendMessage({ what: 'getTheyLiveSettings' }).then(data => {
        if ( !data ) { return; }
        if ( enabledEl ) { enabledEl.checked = Boolean(data.aiEnabled); }
        if ( urlEl ) { urlEl.value = data.aiBaseUrl || 'https://ollama.com'; }
        if ( modelEl ) { modelEl.value = data.aiModel || 'gemma4:31b-cloud'; }
        if ( apiKeyEl ) { apiKeyEl.value = data.aiApiKey || ''; }
        if ( thinkingEl ) { thinkingEl.checked = Boolean(data.aiThinking); }
        refreshFieldVisibility();
    });

    refreshStats();
    // Refresh stats periodically while the settings page is open.
    const statsInterval = setInterval(refreshStats, 5000);
    window.addEventListener('unload', () => clearInterval(statsInterval), { once: true });
}

/******************************************************************************/

function listen() {
    const bc = new self.BroadcastChannel('uBOL');
    bc.onmessage = listen.onmessage;
}

listen.onmessage = ev => {
    const message = ev.data;
    if ( message instanceof Object === false ) { return; }
    const local = cachedRulesetData;
    let render = false;

    if ( message.hasOmnipotence !== undefined ) {
        if ( message.hasOmnipotence !== local.hasOmnipotence ) {
            local.hasOmnipotence = message.hasOmnipotence;
            render = true;
        }
    }

    if ( message.defaultFilteringMode !== undefined ) {
        if ( message.defaultFilteringMode !== local.defaultFilteringMode ) {
            local.defaultFilteringMode = message.defaultFilteringMode;
            render = true;
        }
    }

    if ( message.autoReload !== undefined ) {
        if ( message.autoReload !== local.autoReload ) {
            local.autoReload = message.autoReload;
            render = true;
        }
    }

    if ( message.showBlockedCount !== undefined ) {
        if ( message.showBlockedCount !== local.showBlockedCount ) {
            local.showBlockedCount = message.showBlockedCount;
            render = true;
        }
    }

    if ( message.strictBlockMode !== undefined ) {
        if ( message.strictBlockMode !== local.strictBlockMode ) {
            local.strictBlockMode = message.strictBlockMode;
            render = true;
        }
    }

    if ( message.developerMode !== undefined ) {
        if ( message.developerMode !== local.developerMode ) {
            local.developerMode = message.developerMode;
            render = true;
        }
    }

    if ( message.adminRulesets !== undefined ) {
        if ( hashFromIterable(message.adminRulesets) !== hashFromIterable(local.adminRulesets) ) {
            local.adminRulesets = message.adminRulesets;
            render = true;
        }
    }

    if ( message.enabledRulesets !== undefined ) {
        local.enabledRulesets = message.enabledRulesets;
        render = true;
    }

    if ( render === false ) { return; }
    renderFilterLists(cachedRulesetData);
    renderWidgets();
};

/******************************************************************************/

sendMessage({
    what: 'getOptionsPageData',
}).then(data => {
    if ( !data ) { return; }
    cachedRulesetData = data;
    try {
        renderAdminRules();
        renderFilterLists(cachedRulesetData);
        renderWidgets();
    } catch(reason) {
        console.error(reason);
    } finally {
        dom.cl.remove(dom.body, 'loading');
    }
    listen();
}).catch(reason => {
    console.error(reason);
});

/******************************************************************************/
