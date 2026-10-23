> ⚠️ **Note**: Coded quickly, the code is far from clean and this is currently an alpha release. If you have any feedback, suggestions, or bug reports, feel free to share them!


# SillyTavern-Simply-LoreAndTracker

A streamlined, lightweight extension for **SillyTavern** providing full control over scene tracking and automated Lorebook memory extraction in a single pass—without additional API calls or extra token costs.

---

## ⚡ Quick Start Tutorial

1. **Open your target chat / conversation.**
2. **Open the extension panel:** The active character name is automatically detected and formatted.
3. **Customize optional settings if needed:**
   - **Active Lorebook Name:** Shows the auto-generated lorebook name (`slt_mem_<CharacterName>`). *Not recommended to change manually, as custom overrides won't persist across session restarts.*
   - **Target Entry Comment:** Change this (e.g., from `actual scene` to `Chapter 2 - The Tavern`) whenever you want to start a new chapter or isolate a specific narrative arc into its own entry.
   - **Lorebook Prefix:** Change the default `slt_mem_` prefix if you prefer custom file naming. *This setting is saved globally and persists across session restarts.*
4. **Link the generated Lorebook:** Once created/synchronized, go to SillyTavern's **World Info / Lorebook** panel and select your new `slt_mem_<CharacterName>` lorebook as the character's primary or secondary World Info so SillyTavern includes it in the prompt context.
5. **Start chatting:** The system prompt will automatically enforce tracker generation at the end of every reply and capture memories in real time!

---


## 🎯 Purpose & Key Advantages

Traditional memory solutions in SillyTavern (such as background summarize passes via secondary LLM calls or complex external scripts) present major drawbacks:
- **Double Token Cost & Increased Latency:** They trigger a separate API call after every reply, doubling token consumption and forcing you to wait for extra background processing.
- **Hidden Context Footprint:** It is often hard to gauge exactly how many tokens your active memories consume inside the context window.
- **Fragility & Desynchronization:** Memory entries often get lost or desynchronized during message swipes, regenerations, or manual chat editing.

### **How Simply LoreAndTracker Solves This:**

1. **Zero Extra API Cost (Single-Pass Generation):** Injects a system directive directly into the primary prompt context. The model generates both the narrative roleplay response and the structured scene/tracker block at the very bottom of a single completion.
2. **Real-Time Visual Tracking & Full Manual Control:** 
   - Provides an immediate visual tracker block at the end of each assistant output.
   - Every extracted summary inside the Lorebook remains **100% human-editable**. You can tweak, delete, clean up, or enrich any scene record manually at any time.
3. **Flexible & Modular Memory Fields:** Want to track more than just time and location? You can freely expand the prompt directive to track inventory, faction status, health/mana, romance levels, or active quest objectives.
4. **Predictable Token Costs & External Summarization:**
   - Because memories are aggregated into plain, structured Lorebook entries, you can see the exact token size of your active memory block at a glance.
   - **Chapter Export Workflow:** Once a scene or chapter reaches its limit, you can easily copy-paste a full block of past scene summaries into *any* external LLM (Claude, ChatGPT, Local Models) to condense an entire arc into a single high-level recap entry.
5. **Automated Character Isolation:** Automatically builds and hooks a character-bound Lorebook (`slt_mem_<CharacterName>`), guaranteeing zero memory cross-contamination when switching character cards.
6. **Real-Time Extraction & Chronological Sorting:** Catches summary blocks dynamically on render or swipe events, strips them cleanly from the chat text, and inserts them sorted chronologically (`Message #1`, `Message #2`, etc.).

---

### ⚖️ Trade-offs & Mid-Story Activation

* ⚠️ **The Primary Trade-off (Past Messages):** Because extraction relies on the LLM generating the structured marker block at the bottom of its reply, **messages generated before installing this extension will not contain summary blocks**. The extension cannot magically invent past summaries for raw historical text without LLM output.
* 💡 **Mid-Game Activation Supported:** You can safely activate this extension at any point in an ongoing roleplay. From the moment it is turned on, all new assistant responses will feature the tracker block. For older chats, you can either let new summaries accumulate naturally or manually write starting entries in the Lorebook to seed past context.

---

## ⚙️ Architecture & Workflow

```text
[ SillyTavern Prompt Context ]
       │
       ├──► 1. Injects Extraction Directive (System Prompt Entry, constant @ Depth 0)
       │
[ LLM Generation Output ]
       │
       ├──► 2. Generates standard roleplay response
       └──► 3. Appends Tracker/Summary block at the bottom (Target Tag: "Message #X")
       │
[ Extension Event Listeners ]
       │
       ├──► 4. Catches response via CHARACTER_MESSAGE_RENDERED / SWIPED
       ├──► 5. Extracts block via regex matching
       └──► 6. Synchronizes & sorts entry inside character Lorebook
```

### **Generated Summary Block Sample:**

💡 Customizing the Extraction Directive & Tracker Fields

The default tracker structure includes Date/Time, Location, Weather, Present Characters, and Context Summary. However, you can freely adapt, add, or remove fields to fit your story needs (e.g., adding Faction Reputation, HP/Mana, or Current Quest).
How to Customize:

    Via Extension Panel: Edit the text directly inside the Extraction Directive Prompt textarea in the extension settings.

    Via Lorebook Entry: Once synchronized, open SillyTavern's World Info/Lorebook editor for slt_mem_<CharacterName> and edit the entry titled *Extraction Directive Prompt*.

    ⚠️ Important Requirement: You can change any formatting, text, or tracked variables, but you MUST preserve the Message #{{lastMessageId}} tag pattern (or your custom Target Tag). The extension uses this exact regex marker to detect, extract, and sort summary blocks.

EXEMPLE
```text
- 
📅 Date & Time: Monday, Oct 24 · 🕒 14:30
📍 Location: Tavern Inner Sanctum
🌤 Weather: Heavy Rain & Thunder
👥 Characters Present: Seraphina (concerned), User (attentive)

📝 Context Summary:
💬 Message #12 Seraphina explains the ancient ritual while seeking shelter from the rain.
- 
```

---

## 💡 Recommended Context Settings

For optimal memory recall without polluting character personality or main context flow:

| Setting | Recommended Value | Reason |
| :--- | :--- | :--- |
| **Insertion Position** | `@D⚙️ : as a system role message` | Injects memories neatly into the message stack without breaking character voice. |
| **Depth** | `2` to `4` | Keeps immediate past events right above recent conversation turns. |
| **Alternative Position** | `-↑ AM : Top Author's Note` | Useful for strict model architectures requiring high-priority system notes. |

---

## 🛠️ Interface Settings Breakdown

### **1. General & Status Indicators**
* **Active Lorebook Name:** Shows the auto-detected or manually specified Lorebook name (`slt_mem_<Name>`).
* **Status Badges:** 
  * `Lorebook`: Indicates whether the physical Lorebook file exists in SillyTavern.
  * `Scene Entry`: Indicates whether the targeted scene entry exists in the Lorebook.
  * `System Prompt`: Verifies if the Extraction Directive is present in the Lorebook.
  * `Link Status Indicator`: Highlights whether the target Lorebook is actively linked to the loaded character or world context.

### **2. Target Scene & Batch Processing**
* **Target Entry Comment:** The comment or title of the entry in the Lorebook where summaries are saved (e.g., `actual scene`, `1 - Beginning`, `2 - Tavern Arc`).
* **Start (Msg #) / End (Msg #):** Optional constraints to bound extraction within specific message ranges.
* **Harvest Messages Button:** Executes a manual scan of full chat history to extract and aggregate all existing status blocks into the Lorebook in one pass.

### **3. Injection & Priority Controls**
* **Insertion Order:** Priority weight in context assembly (higher values give precedence when ordering entries).
* **Insertion Position:** Determines where in the prompt sequence the memory block is injected.
* **Depth:** Number of messages from the bottom when using At Depth (`@D`) positions.
* **Ignore Budget (Bypass Token Limit):** Ensures memory entries are never truncated regardless of context token limits.

### **4. Identification & Directive Customization**
* **Lorebook Prefix:** Prefix prepended to character names to isolate generated memory files (default: `slt_mem_`).
* **Target Tag:** The tag used by the regex parser to spot where memory blocks start (default: `Message #`).
* **Extraction Directive Prompt Toggle:** Enable/disable injecting the constraint prompt into the LLM context.
* **Reset Prompt Button:** Restores the directive prompt back to factory default settings.

---

## 🚀 Installation

1. Open **SillyTavern**.
2. Open the **Extensions** menu (stacked blocks icon).
3. Click **Install Extension**.
4. Paste the repository URL: `https://github.com/YourUsername/SillyTavern-Simply-LoreAndTracker`
5. Click **Save** and refresh SillyTavern.


---

## 🙏 Credits & Acknowledgments

Special thanks to the creators of the following extensions and presets whose work directly inspired and shaped this project:

* **[SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)** by *aikohanasaki*: A beautiful and incredibly comprehensive extension that paved the way for advanced memory management, though slightly too complex for my day-to-day workflow.
* **[SillyTavern-MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)** by *qvink*: A brilliant concept for auto-summarization, which motivated me to build a system where harvested summaries could be directly structured and edited inside native Lorebook entries.
* **[SillyTavern-ScenePulse](https://github.com/xenofei/SillyTavern-ScenePulse)** by *xenofei*: Brought the crucial idea of combining RP generation and tracking into a single LLM pass.
* **@codesyazzz**: For the original concept behind the final status block layout from their **Gemma-4 Advance Immersive ERP Chat** preset (64K+ context). Without this prompt structure, this extension would simply not exist!

---

## 📜 License

MIT License. Designed for community use and open customization within SillyTavern setups.
