import { eventSource, event_types } from '../../../../script.js';
import { saveWorldInfo, loadWorldInfo } from '../../../world-info.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

const MODULE_NAME = "auto_memory";

extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {
    targetComment: "actual scene",
    targetLorebook: "",
    targetTag: "Message #",
    startMsg: 1,
    endMsg: ""
};

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function processMessage(messageText, messageId) {
    if (!messageText || typeof messageText !== 'string') return false;

    // Vérification de la plage bornée (Début / Fin)
    const startBound = parseInt(extension_settings[MODULE_NAME].startMsg, 10) || 1;
    const endBound = parseInt(extension_settings[MODULE_NAME].endMsg, 10) || Infinity;

    const userTag = (extension_settings[MODULE_NAME].targetTag || "Message #").trim();
    const escapedTag = escapeRegExp(userTag);

    const regexMarker = new RegExp(`(?:\\*\\*|\\*)*?${escapedTag}\\s*(\\d+)`, 'i');
    const match = messageText.match(regexMarker);
    if (!match) return false;

    const detectedMsgNum = parseInt(match[1], 10);

    // Hors bornes définies
    if (detectedMsgNum < startBound || detectedMsgNum > endBound) {
        return false;
    }

    const markerIndex = messageText.search(regexMarker);
    const extractedBlock = messageText.substring(markerIndex).trim();

    const context = SillyTavern.getContext();
    const inputLorebookName = extension_settings[MODULE_NAME].targetLorebook?.trim();
    const fallbackLorebookName = context.worldInfoData?.name || context.world;
    const targetLorebookName = inputLorebookName || fallbackLorebookName;

    if (!targetLorebookName) return false;

    let worldInfoData = null;
    try {
        worldInfoData = await loadWorldInfo(targetLorebookName);
    } catch (err) {
        worldInfoData = context.worldInfoData || window.world_info;
    }

    if (!worldInfoData || !worldInfoData.entries) return false;

    const targetComment = (extension_settings[MODULE_NAME].targetComment || "actual scene").toLowerCase().trim();

    let targetEntry = null;
    for (const key in worldInfoData.entries) {
        const entry = worldInfoData.entries[key];
        if (entry.comment && entry.comment.toLowerCase().trim() === targetComment) {
            targetEntry = entry;
            break;
        }
    }

    if (!targetEntry) return false;

    const oldContent = targetEntry.content || "";
    const newContent = insertInOrder(oldContent, extractedBlock, detectedMsgNum, userTag);

    if (oldContent === newContent) return false;

    targetEntry.content = newContent;

    try {
        await saveWorldInfo(targetLorebookName, worldInfoData);
        eventSource.emit('worldinfo_updated', targetLorebookName, worldInfoData);
        console.log(`🎉 Msg #${detectedMsgNum} (dans la plage [${startBound} - ${endBound === Infinity ? 'Fin' : endBound}]) sauvegardé !`);
        return true;
    } catch (err) {
        console.error("❌ Erreur lors de la sauvegarde :", err);
        return false;
    }
}

async function harvestAllMessages() {
    console.group("🚀 [Auto-Mémoire] Lancement de la récolte ciblée");
    const context = SillyTavern.getContext();
    const chat = context.chat;

    if (!chat || !Array.isArray(chat) || chat.length === 0) {
        console.groupEnd();
        if (window.toastr) toastr.warning("Aucun message dans la conversation.");
        return;
    }

    const startBound = parseInt(extension_settings[MODULE_NAME].startMsg, 10) || 1;
    const endBoundInput = parseInt(extension_settings[MODULE_NAME].endMsg, 10);
    const endBound = isNaN(endBoundInput) ? chat.length : endBoundInput;

    let count = 0;
    // On boucle uniquement sur la plage demandée
    const startIndex = Math.max(0, startBound - 1);
    const endIndex = Math.min(chat.length, endBound);

    for (let i = startIndex; i < endIndex; i++) {
        const msg = chat[i];
        const textContent = msg?.mes || msg?.text;

        if (msg && !msg.is_user && textContent) {
            const added = await processMessage(textContent, i + 1);
            if (added) count++;
        }
    }

    console.groupEnd();

    if (window.toastr) {
        if (count > 0) {
            toastr.success(`${count} résumé(s) récolté(s) dans la plage !`, 'Auto-Mémoire');
        } else {
            toastr.info("Aucun nouveau résumé trouvé dans cette plage.", 'Auto-Mémoire');
        }
    }
}

jQuery(async () => {
    try {
        const template = await renderExtensionTemplateAsync('third-party/Auto Memory Saver', 'index');
        $('#extensions_settings').append(template);

        $('#auto_memory_lorebook_input').val(extension_settings[MODULE_NAME].targetLorebook || '');
        $('#auto_memory_comment_input').val(extension_settings[MODULE_NAME].targetComment || 'actual scene');
        $('#auto_memory_tag_input').val(extension_settings[MODULE_NAME].targetTag || 'Message #');
        $('#auto_memory_start_input').val(extension_settings[MODULE_NAME].startMsg || '');
        $('#auto_memory_end_input').val(extension_settings[MODULE_NAME].endMsg || '');

        $('#auto_memory_lorebook_input').on('input', function () {
            extension_settings[MODULE_NAME].targetLorebook = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
        });

        $('#auto_memory_comment_input').on('input', function () {
            extension_settings[MODULE_NAME].targetComment = $(this).val();
            SillyTavern.getContext().saveSettingsDebounced();
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

        $('#auto_memory_run_all_btn').on('click', () => {
            harvestAllMessages();
        });

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
            const chat = SillyTavern.getContext().chat;
            const msg = chat?.[messageId];
            const textContent = msg?.mes || msg?.text;
            if (textContent) {
                await processMessage(textContent, messageId);
            }
        });

        console.log('[Auto-Mémoire] Prêt avec filtrage par plage de messages.');
    } catch (err) {
        console.error('[Auto-Mémoire] Erreur au chargement :', err);
    }
});


// Écouteur pour la génération standard
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
    const chat = SillyTavern.getContext().chat;
    const msg = chat?.[messageId];
    const textContent = msg?.mes || msg?.text;
    if (textContent) {
        await processMessage(textContent, messageId);
    }
});

// Écouteur pour le Swipe (remplace et écrase le bloc existant)
eventSource.on(event_types.CHARACTER_MESSAGE_SWIPED, async (messageId) => {
    const chat = SillyTavern.getContext().chat;
    const msg = chat?.[messageId];
    const textContent = msg?.mes || msg?.text;
    if (textContent) {
        await processMessage(textContent, messageId);
    }
});