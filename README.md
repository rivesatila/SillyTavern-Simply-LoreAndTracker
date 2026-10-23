# SillyTavern-Simply-LoreAndTracker
A streamlined, lightweight extension for SillyTavern providing full control over scene tracking and automated Lorebook memory extraction in a single pass—without additional API calls or extra token cost.



# Simply LoreAndTracker

**Simply LoreAndTracker** est une extension légère et autonome pour **SillyTavern**. Elle automatise le suivi de scène (date, heure, météo, personnages présents) et l'extraction de résumés narratifs directement dans des Lorebooks dédiés par personnage, **sans aucun coût additionnel de tokens ou d'appels API secondaires**.

---

## 🎯 Problématique & Besoins

Les solutions classiques de mémoire pour SillyTavern (comme QvinkMemory ou les récapitulatifs automatiques via LLM) imposent souvent :
- Des requêtes API secondaires à chaque message, doublant le coût en tokens ou ralentissant la génération.
- L'utilisation de scripts complexes ou d'outils tiers externes.
- Une perte de contexte lors des changements de scènes ou lors de la régénération d'un message (swipes).

**Simply LoreAndTracker répond à ces besoins :**
1. **Zero Extra Cost** : Utilise une seule passe de génération. La consigne d'extraction est injectée dans le prompt système, et le modèle génère le bloc de suivi à la fin de sa réponse de roleplay.
2. **Organisation par personnage** : Crée et associe automatiquement un Lorebook dédié (`slt_mem_<NomDuPersonnage>`) pour éviter de mélanger les souvenirs entre différentes cartes.
3. **Mise à jour à la volée** : Capture, nettoie et trie les résumés par numéro de message (`#1`, `#2`, etc.) en temps réel, y compris lors des *swipes* ou de l'édition d'un message.

---

## ⚙️ Mécanique de Fonctionnement

```text
[ SillyTavern Prompt ]
       │
       ├──► 1. Injection automatique de la consigne d'extraction (Entrée Système à Depth 0)
       │
[ Réponse du Modèle ]
       │
       ├──► 2. Génération du texte RP
       └──► 3. Génération du bloc statut à la fin du message (Tag "Message #X")
       │
[ Event Listener Extension ]
       │
       ├──► 4. Capture du bloc via Regex (CHARACTER_MESSAGE_RENDERED / SWIPED)
       ├──► 5. Parsage & Tri chronologique par numéro de message (#1, #2...)
       └──► 6. Synchronisation instantanée dans la Scene Entry du Lorebook


       - - 
📅 Date & Time: ... · 🕒 ...
📍 Location: ...
🌤 Weather: ...
👥 Characters Present: ...

📝 Context Summary:
💬 Message #{{lastMessageId}} Short summary of the latest exchange...
- -


best position for memmory is @D⚙️ : as a system role message avec Depth 2 à 4
or -↑ AM : Top Author's Note