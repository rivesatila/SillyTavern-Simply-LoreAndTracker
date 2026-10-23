import { eventSource, event_types, getRequestHeaders } from '../../../../script.js';
import { updateWorldInfoList } from '../../../world-info.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

// ==========================================
// 1. CONSTANTES & CONFIGURATION
// ==========================================
const MODULE_NAME = "simply_lore_and_tracker";
const SYSTEM_PROMPT_COMMENT = "***ST_SYSTEM_PROMPT_TRACKER***";

const DEFAULT_HARVEST_PROMPT = `[END BLOCK TRACKER]
At the VERY END of every output, after all roleplay text and narration, you MUST generate the status and summary block.
Never place this block at the top or in the middle of your reply.

[BLOCK FORMAT]
Format the final block exactly as follows (ensure a blank line before and after the horizontal rule):

[Your story text ends here]

- 

📅 Date & Time: <Day, Date> · 🕒 <Time>
📍 Location: <Current Place / Area>
🌤 Weather: <Current Weather & Temperature>
👥 Characters Present: <Name 1> (<mood>), <Name 2> (<mood>)


📝 Context Summary:
💬 Message #{{lastMessageId}} <1-2 short sentences in English summarizing recent events and the latest exchange between {{user}} and {{char}}>
- 

[TRACKER RULES]
- Grounding: Update date, time, location, and weather dynamically based on story progression.

- Cast: List every character present in the current scene along with their current emotional state.

- Summary: Keep the context summary concise and written in English, focusing strictly on immediate actions and narrative hooks.`
;

extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {
    prefix: "slt_mem_",
    targetComment: "actual scene",
    targetTag: "Message #",
    startMsg: 1,
    endMsg: "",
    entryOrder: 100,
    entryPositionSelect: "4-0",
    entryDepth: 4,
    ignoreBudget: false,
    harvestPrompt: DEFAULT_HARVEST_PROMPT
};

// ==========================================
// 2. HELPER NOTIFICATION, PARSING & API REST
// ==========================================

let wiModule = null;
async function getWiApi() {
    if (!wiModule) {
        try { 
            wiModule = await import('../../../world-info.js'); 
        } catch (e) { 
            wiModule = {}; 
            console.warn('[Simply-LoreAndTracker] Impossible d\'importer world-info.js', e); 
        }
    }
    const c = SillyTavern.getContext();
    return {
        loadWorldInfo: c.loadWorldInfo || wiModule.loadWorldInfo,
        saveWorldInfo: c.saveWorldInfo || wiModule.saveWorldInfo,
        updateWorldInfoList: c.updateWorldInfoList || wiModule.updateWorldInfoList,
        reloadEditor: c.reloadWorldInfoEditor || wiModule.reloadEditor
    };
}

function showNotification(type, message, title = 'Simply-LoreAndTracker') {
    const toastrObj = window.toastr || (typeof toastr !== 'undefined' ? toastr : null);
    if (toastrObj && typeof toastrObj[type] === 'function') {
        toastrObj[type](message, title);
    } else {
        console.log(`[${title}] (${type}): ${message}`);
    }
}

function getApiHeaders() {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    try {
        if (typeof getRequestHeaders === 'function') {
            return { ...defaultHeaders, ...getRequestHeaders() };
        }
        if (typeof SillyTavern?.getContext === 'function' && typeof SillyTavern.getContext().getRequestHeaders === 'function') {
            return { ...defaultHeaders, ...SillyTavern.getContext().getRequestHeaders() };
        }
    } catch (e) {
        console.warn('[Simply-LoreAndTracker] Failed to retrieve CSRF headers:', e);
    }
    return defaultHeaders;
}

function parsePositionAndRole(val) {
    const strVal = String(val ?? "4-0");
    if (strVal.includes('-')) {
        const parts = strVal.split('-');
        return { position: parseInt(parts[0], 10), role: parseInt(parts[1], 10) };
    }
    return { position: parseInt(strVal, 10), role: 0 };
}

async function refreshSillyTavernWorldInfoList() {
    try {
        if (typeof updateWorldInfoList === 'function') {
            await updateWorldInfoList();
        } else if (typeof SillyTavern.getContext()?.updateWorldInfoList === 'function') {
            await SillyTavern.getContext().updateWorldInfoList();
        }
    } catch (err) {
        console.warn('[Simply-LoreAndTracker] Could not refresh UI WorldInfo list:', err);
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateSequentialKey(entries) {
    let maxKey = -1;
    if (entries) {
        for (const k of Object.keys(entries)) {
            const num = parseInt(k, 10);
            if (!isNaN(num) && num > maxKey) {
                maxKey = num;
            }
        }
    }
    return String(maxKey + 1);
}

function insertInOrder(currentContent, newBlock, newMsgNum, userTag) {
    const escapedTag = escapeRegExp(userTag.trim());
    const blockRegex = new RegExp(`(?=\\n*#\\s*(?:\\*\\*|\\*)*?${escapedTag}\\s*\\d+)`, 'gi');
    let blocks = currentContent.split(blockRegex).map(b => b.trim()).filter(b => b.length > 0);

    let updated = false;
    const parsedBlocks = [];
    const parseNumRegex = new RegExp(`${escapedTag}\\s*(\\d+)`, 'i');

    for (const block of blocks) {
        const match = block.match(parseNumRegex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num === newMsgNum) {
                parsedBlocks.push({ num: num, text: `# ${newBlock}` });
                updated = true;
            } else {
                parsedBlocks.push({ num: num, text: block.startsWith('#') ? block : `# ${block}` });
            }
        } else {
            parsedBlocks.push({ num: 0, text: block });
        }
    }

    if (!updated) {
        parsedBlocks.push({ num: newMsgNum, text: `# ${newBlock}` });
    }

    parsedBlocks.sort((a, b) => a.num - b.num);
    return parsedBlocks.map(b => b.text).join("\n\n");
}

function extractBlockFromMessage(messageText, messageId) {
    if (!messageText || typeof messageText !== 'string') return null;

    const startBound = parseInt(extension_settings[MODULE_NAME].startMsg, 10) || 1;
    const endBound = parseInt(extension_settings[MODULE_NAME].endMsg, 10) || Infinity;

    const userTag = (extension_settings[MODULE_NAME].targetTag || "Message #").trim();
    const escapedTag = escapeRegExp(userTag);

    const regexMarker = new RegExp(`(?:\\*\\*|\\*)*?${escapedTag}\\s*(\\d+)`, 'i');
    const match = messageText.match(regexMarker);
    if (!match) return null;

    const detectedMsgNum = parseInt(match[1], 10);

    if (detectedMsgNum < startBound || detectedMsgNum > endBound) {
        return null;
    }

    const markerIndex = messageText.search(regexMarker);
    const extractedBlock = messageText.substring(markerIndex).trim();

    return {
        msgNum: detectedMsgNum,
        block: extractedBlock,
        userTag: userTag
    };
}

async function fetchWorldInfoApi(lorebookName) {
    try {
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ name: lorebookName })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        return null;
    }
}

async function saveWorldInfoApi(lorebookName, worldInfoData) {
    try {
        const api = await getWiApi();
        
        // 1. Écriture (Mémoire/Disque)
        if (typeof api.saveWorldInfo === 'function') {
            await api.saveWorldInfo(lorebookName, worldInfoData, false);
        } else {
            const response = await fetch('/api/worldinfo/edit', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({ name: lorebookName, data: worldInfoData })
            });
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        }

        // 2. Événements globaux & rafraîchissement des listes
        if (typeof eventSource !== 'undefined' && event_types?.WORLDINFO_UPDATED) {
            eventSource.emit(event_types.WORLDINFO_UPDATED, lorebookName, worldInfoData);
            eventSource.emit('worldinfo_updated', lorebookName, worldInfoData);
        }
        await refreshSillyTavernWorldInfoList();

        // 3. Rechargement du panneau d'édition si ouvert
        if (typeof api.reloadEditor === 'function') {
            api.reloadEditor(lorebookName);
        }

        return true;
    } catch (err) {
        console.error(`[Simply-LoreAndTracker] Save error via API edit:`, err);
        return false;
    }
}

function toggleDepthInput() {
    const rawVal = $('#auto_memory_position_select').val();
    const { position } = parsePositionAndRole(rawVal);
    const isAtD = (position === 4);
    const depthInput = $('#auto_memory_depth_input');
    
    depthInput.prop('disabled', !isAtD);
    if (!isAtD) {
        depthInput.css({ 'opacity': '0.5', 'cursor': 'not-allowed' });
    } else {
        depthInput.css({ 'opacity': '1', 'cursor': 'text' });
    }
}

// ==========================================
// 3. LOGIQUE LOREBOOK & VÉRIFICATIONS
// ==========================================
function updateStatusDot(containerId, isOk) {
    const el = $(`#${containerId} .status-dot`);
    if (!el.length) return;
    if (isOk) {
        el.css({ 'color': '#00e676', 'text-shadow': '0 0 5px rgba(0, 230, 118, 0.5)' });
    } else {
        el.css({ 'color': '#ff5252', 'text-shadow': '0 0 5px rgba(255, 82, 82, 0.5)' });
    }
}

function createSceneEntryTemplate(uid, comment) {
    const orderVal = parseInt(extension_settings[MODULE_NAME].entryOrder, 10);
    const { position: positionVal, role: roleVal } = parsePositionAndRole(extension_settings[MODULE_NAME].entryPositionSelect ?? "4-0");
    const rawDepth = parseInt(extension_settings[MODULE_NAME].entryDepth ?? 4, 10);
    
    const isAtD = (positionVal === 4);
    const depthVal = isAtD ? (isNaN(rawDepth) ? 4 : rawDepth) : 0;

    return {
        uid: uid,
        key: [],
        keysecondary: [],
        comment: comment,
        content: "",
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: false,
        order: isNaN(orderVal) ? 100 : orderVal,
        position: positionVal,
        role: isAtD ? roleVal : 0,
        disable: false,
        ignoreBudget: !!extension_settings[MODULE_NAME].ignoreBudget,
        excludeRecursion: true,
        preventRecursion: true,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: depthVal,
        outletName: "",
        group: "",
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: "",
        triggers: [],
        displayIndex: uid,
        characterFilter: {
            isExclude: false,
            names: [],
            tags: []
        }
    };
}

function createSystemPromptTemplate(uid) {
    const promptText = extension_settings[MODULE_NAME].harvestPrompt || DEFAULT_HARVEST_PROMPT;
    return {
        uid: uid,
        key: [],
        keysecondary: [],
        comment: SYSTEM_PROMPT_COMMENT,
        content: promptText,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: false,
        order: 9999,
        position: 4,
        role: 0,
        disable: false,
        ignoreBudget: true,
        excludeRecursion: true,
        preventRecursion: true,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 0,
        outletName: "",
        group: "",
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: "",
        triggers: [],
        displayIndex: uid,
        characterFilter: {
            isExclude: false,
            names: [],
            tags: []
        }
    };
}

function syncSystemPromptEntry(worldInfoData) {
    let systemEntry = null;

    if (!worldInfoData.entries) worldInfoData.entries = {};

    for (const key in worldInfoData.entries) {
        const entry = worldInfoData.entries[key];
        if (entry && entry.comment === SYSTEM_PROMPT_COMMENT) {
            systemEntry = entry;
            break;
        }
    }

    if (!systemEntry) {
        const newKey = generateSequentialKey(worldInfoData.entries);
        const uid = parseInt(newKey, 10);
        worldInfoData.entries[newKey] = createSystemPromptTemplate(uid);
    } else {
        systemEntry.content = extension_settings[MODULE_NAME].harvestPrompt || DEFAULT_HARVEST_PROMPT;
        systemEntry.order = 9999;
        systemEntry.position = 4;
        systemEntry.role = 0;
        systemEntry.depth = 0;
    }
}

async function checkCharacterLorebook(forceCreate = false, isCharacterChange = false, forcePrefixRefresh = false) {
    const context = SillyTavern.getContext();
    const characterId = context.characterId;

    if (characterId === undefined || characterId === null) {
        $('#auto_memory_current_lorebook').val('');
        updateStatusDot('badge_lb_status', false);
        updateStatusDot('badge_entry_status', false);
        updateStatusDot('badge_prompt_status', false);
        return null;
    }

    const character = context.characters[characterId];
    if (!character || !character.name) {
        $('#auto_memory_current_lorebook').val('');
        updateStatusDot('badge_lb_status', false);
        updateStatusDot('badge_entry_status', false);
        updateStatusDot('badge_prompt_status', false);
        return null;
    }

    const cleanCharName = character.name.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const prefix = extension_settings[MODULE_NAME].prefix || "slt_mem_";
    const expectedLorebookName = `${prefix}${cleanCharName}`;

    let currentInput = $('#auto_memory_current_lorebook').val()?.trim() || '';

    if (isCharacterChange || forcePrefixRefresh || !currentInput || currentInput === 'No active character') {
        $('#auto_memory_current_lorebook').val(expectedLorebookName);
        currentInput = expectedLorebookName;
    }

    const lorebookName = currentInput;
    $('#auto_memory_current_lorebook').val(lorebookName);

    let worldInfoData = await fetchWorldInfoApi(lorebookName);
    const targetComment = (extension_settings[MODULE_NAME].targetComment || "actual scene").trim().toLowerCase();

    if (forceCreate) {
        if (!worldInfoData) {
            worldInfoData = { name: lorebookName, entries: {} };
        }
        if (!worldInfoData.entries) worldInfoData.entries = {};

        let hasSceneEntry = false;
        for (const k in worldInfoData.entries) {
            if (worldInfoData.entries[k]?.comment?.toLowerCase().trim() === targetComment) {
                hasSceneEntry = true;
                break;
            }
        }

        if (!hasSceneEntry) {
            const newKey = generateSequentialKey(worldInfoData.entries);
            const uid = parseInt(newKey, 10);
            worldInfoData.entries[newKey] = createSceneEntryTemplate(uid, extension_settings[MODULE_NAME].targetComment || "actual scene");
        }

        syncSystemPromptEntry(worldInfoData);

        const saved = await saveWorldInfoApi(lorebookName, worldInfoData);
        if (saved) {
            worldInfoData = await fetchWorldInfoApi(lorebookName);
        }
    }

    const hasEntries = worldInfoData && worldInfoData.entries && Object.keys(worldInfoData.entries).length > 0;

    let lbExists = false;
    let entryExists = false;
    let promptExists = false;

    if (hasEntries) {
        for (const k in worldInfoData.entries) {
            const c = worldInfoData.entries[k]?.comment;
            if (c) {
                if (c.toLowerCase().trim() === targetComment) entryExists = true;
                if (c === SYSTEM_PROMPT_COMMENT) promptExists = true;
            }
        }
        lbExists = entryExists || promptExists;
    }

    updateStatusDot('badge_lb_status', lbExists);
    updateStatusDot('badge_entry_status', entryExists);
    updateStatusDot('badge_prompt_status', promptExists);

    if (lbExists && character.data && character.data.extensions) {
        if (character.data.extensions.world !== lorebookName) {
            character.data.extensions.world = lorebookName;
            if (typeof context.saveCharacterDebounced === 'function') {
                context.saveCharacterDebounced();
            }
        }
    }

    return lbExists ? { lorebookName, worldInfoData } : null;
}

// ==========================================
// 4. TRAITEMENT DES MESSAGES & HARVEST
// ==========================================
async function processMessage(messageText, messageId) {
    const extracted = extractBlockFromMessage(messageText, messageId);
    if (!extracted) return false;

    let targetData = await checkCharacterLorebook(false, false, false);
    if (!targetData) {
        targetData = await checkCharacterLorebook(true, false, false);
    }
    if (!targetData) return false;

    const { lorebookName, worldInfoData } = targetData;
    if (!worldInfoData || !worldInfoData.entries) return false;

    const targetComment = (extension_settings[MODULE_NAME].targetComment || "actual scene").toLowerCase().trim();

    let targetEntry = null;
    for (const key in worldInfoData.entries) {
        const entry = worldInfoData.entries[key];
        if (entry && entry.comment && entry.comment.toLowerCase().trim() === targetComment) {
            targetEntry = entry;
            break;
        }
    }

    if (!targetEntry) {
        const newKey = generateSequentialKey(worldInfoData.entries);
        const uid = parseInt(newKey, 10);
        targetEntry = createSceneEntryTemplate(uid, extension_settings[MODULE_NAME].targetComment || "actual scene");
        worldInfoData.entries[newKey] = targetEntry;
    }

    const orderVal = parseInt(extension_settings[MODULE_NAME].entryOrder, 10);
    const { position: positionVal, role: roleVal } = parsePositionAndRole(extension_settings[MODULE_NAME].entryPositionSelect ?? "4-0");
    const rawDepth = parseInt(extension_settings[MODULE_NAME].entryDepth ?? 4, 10);
    const isAtD = (positionVal === 4);

    targetEntry.order = isNaN(orderVal) ? 100 : orderVal;
    targetEntry.position = positionVal;
    targetEntry.role = isAtD ? roleVal : 0;
    targetEntry.depth = isAtD ? (isNaN(rawDepth) ? 4 : rawDepth) : 0;
    
    if (extension_settings[MODULE_NAME].ignoreBudget !== undefined) {
        targetEntry.ignoreBudget = !!extension_settings[MODULE_NAME].ignoreBudget;
    }

    const oldContent = targetEntry.content || "";
    const newContent = insertInOrder(oldContent, extracted.block, extracted.msgNum, extracted.userTag);

    if (oldContent === newContent) return false;

    targetEntry.content = newContent;

    return await saveWorldInfoApi(lorebookName, worldInfoData);
}

async function harvestAllMessages() {
    const context = SillyTavern.getContext();
    const chat = context.chat;

    if (!chat || !Array.isArray(chat) || chat.length === 0) {
        showNotification('warning', "No messages in the chat history.");
        return;
    }

    // 1. Récupération / Création du lorebook UNE SEULE FOIS au départ
    let targetData = await checkCharacterLorebook(false, false, false);
    if (!targetData) {
        targetData = await checkCharacterLorebook(true, false, false);
    }
    if (!targetData) {
        showNotification('error', "Could not access character lorebook.");
        return;
    }

    const { lorebookName, worldInfoData } = targetData;
    if (!worldInfoData.entries) worldInfoData.entries = {};

    const targetComment = (extension_settings[MODULE_NAME].targetComment || "actual scene").toLowerCase().trim();

    let targetEntry = null;
    for (const key in worldInfoData.entries) {
        const entry = worldInfoData.entries[key];
        if (entry && entry.comment && entry.comment.toLowerCase().trim() === targetComment) {
            targetEntry = entry;
            break;
        }
    }

    if (!targetEntry) {
        const newKey = generateSequentialKey(worldInfoData.entries);
        const uid = parseInt(newKey, 10);
        targetEntry = createSceneEntryTemplate(uid, extension_settings[MODULE_NAME].targetComment || "actual scene");
        worldInfoData.entries[newKey] = targetEntry;
    }

    const orderVal = parseInt(extension_settings[MODULE_NAME].entryOrder, 10);
    const { position: positionVal, role: roleVal } = parsePositionAndRole(extension_settings[MODULE_NAME].entryPositionSelect ?? "4-0");
    const rawDepth = parseInt(extension_settings[MODULE_NAME].entryDepth ?? 4, 10);
    const isAtD = (positionVal === 4);

    targetEntry.order = isNaN(orderVal) ? 100 : orderVal;
    targetEntry.position = positionVal;
    targetEntry.role = isAtD ? roleVal : 0;
    targetEntry.depth = isAtD ? (isNaN(rawDepth) ? 4 : rawDepth) : 0;
    if (extension_settings[MODULE_NAME].ignoreBudget !== undefined) {
        targetEntry.ignoreBudget = !!extension_settings[MODULE_NAME].ignoreBudget;
    }

    const startBound = parseInt(extension_settings[MODULE_NAME].startMsg, 10) || 1;
    const endBoundInput = parseInt(extension_settings[MODULE_NAME].endMsg, 10);
    const endBound = isNaN(endBoundInput) ? chat.length : endBoundInput;

    const startIndex = Math.max(0, startBound - 1);
    const endIndex = Math.min(chat.length, endBound);

    let count = 0;
    let currentContent = targetEntry.content || "";

    // 2. Accumulation pure en mémoire sans aucun appel API dans la boucle
    for (let i = startIndex; i < endIndex; i++) {
        const msg = chat[i];
        const textContent = msg?.mes || msg?.text;

        if (msg && !msg.is_user && textContent) {
            const extracted = extractBlockFromMessage(textContent, i + 1);
            if (extracted) {
                const updatedContent = insertInOrder(currentContent, extracted.block, extracted.msgNum, extracted.userTag);
                if (updatedContent !== currentContent) {
                    currentContent = updatedContent;
                    count++;
                }
            }
        }
    }

    // 3. Sauvegarde unique et rafraîchissement global à la toute fin
    if (count > 0) {
        targetEntry.content = currentContent;
        await saveWorldInfoApi(lorebookName, worldInfoData);
        showNotification('success', `${count} summary block(s) harvested!`);
    } else {
        showNotification('info', "Memory is already up to date.");
    }
}

window.autoMemoryHarvest = harvestAllMessages;

// ==========================================
// 5. INITIALISATION & ÉVÉNEMENTS UI
// ==========================================
jQuery(async () => {
    try {
        const template = await renderExtensionTemplateAsync('third-party/SillyTavern-Simply-LoreAndTracker', 'index');
        $('#extensions_settings').append(template);

        $('#auto_memory_prefix_input').val(extension_settings[MODULE_NAME].prefix || 'slt_mem_');
        $('#auto_memory_comment_input').val(extension_settings[MODULE_NAME].targetComment || 'actual scene');
        $('#auto_memory_tag_input').val(extension_settings[MODULE_NAME].targetTag || 'Message #');
        $('#auto_memory_start_input').val(extension_settings[MODULE_NAME].startMsg || '');
        $('#auto_memory_end_input').val(extension_settings[MODULE_NAME].endMsg || '');
        $('#auto_memory_order_input').val(extension_settings[MODULE_NAME].entryOrder ?? 100);
        $('#auto_memory_position_select').val(extension_settings[MODULE_NAME].entryPositionSelect ?? '4-0');
        $('#auto_memory_depth_input').val(extension_settings[MODULE_NAME].entryDepth ?? 4);
        $('#auto_memory_prompt_textarea').val(extension_settings[MODULE_NAME].harvestPrompt || DEFAULT_HARVEST_PROMPT);
        $('#auto_memory_budget_checkbox').prop('checked', !!extension_settings[MODULE_NAME].ignoreBudget);

        toggleDepthInput();

        $('#auto_memory_prefix_input').on('input', function () {
            extension_settings[MODULE_NAME].prefix = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
            checkCharacterLorebook(false, false, true);
        });

        $('#auto_memory_current_lorebook').on('input', function () {
            checkCharacterLorebook(false, false, false);
        });

        $('#auto_memory_comment_input').on('input', function () {
            extension_settings[MODULE_NAME].targetComment = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
            checkCharacterLorebook(false, false, false);
        });

        $('#auto_memory_tag_input').on('input', function () {
            extension_settings[MODULE_NAME].targetTag = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_start_input').on('input', function () {
            extension_settings[MODULE_NAME].startMsg = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_end_input').on('input', function () {
            extension_settings[MODULE_NAME].endMsg = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_order_input').on('input', function () {
            extension_settings[MODULE_NAME].entryOrder = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_position_select').on('change', function () {
            extension_settings[MODULE_NAME].entryPositionSelect = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
            toggleDepthInput();
        });

        $('#auto_memory_depth_input').on('input', function () {
            extension_settings[MODULE_NAME].entryDepth = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_prompt_textarea').on('input', function () {
            extension_settings[MODULE_NAME].harvestPrompt = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
            checkCharacterLorebook(false, false, false);
        });

        $('#auto_memory_reset_prompt_btn').on('click', function () {
            $('#auto_memory_prompt_textarea').val(DEFAULT_HARVEST_PROMPT);
            extension_settings[MODULE_NAME].harvestPrompt = DEFAULT_HARVEST_PROMPT;
            SillyTavern.getContext().saveSettingsDebounced();
            checkCharacterLorebook(false, false, false);
            showNotification('info', "Default directive prompt restored.");
        });

        $('#auto_memory_budget_checkbox').on('change', function () {
            extension_settings[MODULE_NAME].ignoreBudget = $(this).is(':checked');
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_run_all_btn').on('click', async () => {
            await harvestAllMessages();
        });

        $('#auto_memory_create_lb_btn').on('click', async () => {
            const res = await checkCharacterLorebook(true, false, false);
            if (res) {
                showNotification('success', `Lorebook "${res.lorebookName}" synchronized!`);
            }
        });

        const handleCharacterSwitch = async () => {
            await checkCharacterLorebook(false, true, false);
        };

        const updateUIState = async () => {
            await checkCharacterLorebook(false, false, false);
        };

        if (event_types.CHARACTER_SELECTED) {
            eventSource.on(event_types.CHARACTER_SELECTED, handleCharacterSwitch);
        }
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, handleCharacterSwitch);
        }

        const handleMessageEvent = async (messageId) => {
            const chat = SillyTavern.getContext().chat;
            const msg = chat?.[messageId];
            const textContent = msg?.mes || msg?.text;
            if (textContent) {
                await processMessage(textContent, messageId);
            }
        };

        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleMessageEvent);
        }

        const swipeEvent = event_types.CHARACTER_MESSAGE_SWIPED || event_types.MESSAGE_SWIPED || 'character_message_swiped';
        if (swipeEvent && typeof swipeEvent === 'string') {
            eventSource.on(swipeEvent, handleMessageEvent);
        }

        setTimeout(updateUIState, 1000);

    } catch (err) {
        console.error('[Simply-LoreAndTracker] Initialization error:', err);
    }
});