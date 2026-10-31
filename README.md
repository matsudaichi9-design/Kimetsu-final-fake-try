# Kimetsu World Engine v0.4.0

A bilingual Thai/English SillyTavern RPG extension starter for Kimetsu no Yaiba roleplay.

## RPG features
- Player character sheet: level, EXP, rank, HP, stamina, attack, defense, speed, money and skill points
- Level-up progression with stat growth and full HP/stamina recovery
- Custom breathing skills with stamina costs and damage multipliers
- Turn-based combat against three sample demon templates
- Enemy scaling based on player level
- Battle log, victory rewards, defeat and flee states
- Inventory with consumable healing and stamina items
- Custom mission creation, completion and EXP/money rewards
- Rest action to restore HP and stamina
- NPC creation/edit/delete, trust, memories and relationship records
- Per-chat world location, time, and event memories
- Character header/dialogue/monologue/narration/status prompt instructions
- Insertable RPG context prompt and JSON backup export

## Floating window (v0.4.0)
- Tap the red **滅** button (draggable) or the wand menu > **Kimetsu World Engine** to open the window.
- Drag the title bar to move, drag the bottom-right corner to resize, **▁** collapses the window to a small HP/Stamina HUD.
- Window position and size are remembered per browser. Settings tab > *Reset window position* if it ever goes off-screen.
- All forms (NPCs, skills, items, missions, memories) are in-window sheets, no browser pop-ups.

## Install
1. Put all files at the root of a public GitHub repository (no sub-folders).
2. SillyTavern > Extensions > Install extension > paste the repository URL.
3. Reload SillyTavern and enable **Kimetsu World Engine**.

Manual install: copy the folder into `SillyTavern/data/<user-handle>/extensions/`.

## Storage
- Global character/RPG/NPC/mission data: SillyTavern extension settings.
- World state, combat encounter and event memories: per-chat metadata.
- Use Overview > Export JSON to back up the global settings and current chat metadata.

## Important limitations
- Combat calculations, EXP, items, missions and stats are managed by the extension.
- The extension inserts a generated context block into the chat input for the user to review and send. It does not silently modify prompts or parse model replies automatically.
- NPC memory and relationships are manually recorded in this version; automatic extraction and relationship evolution are planned for a later version.
- The extension uses SillyTavern's `SillyTavern.getContext()` and the standard extension settings/chat metadata interfaces. Compatibility should be verified against the user's installed SillyTavern build.

## Roadmap
- Import/export character and NPC packs
- Automatic structured response parser and state update confirmation
- Mission objectives and branching quest lines
- More breathing styles, forms, demon blood arts and boss mechanics
- NPC relationship matrix and memory retrieval
- Localization file system and automated tests


## AI Memory Synchronization (v0.3.0)
- Conversation analysis prompt uses recent chat messages and registered NPC names.
- AI emits a `<KWE_MEMORY_PROPOSAL>` JSON block with NPC memories, relationship deltas and world events.
- `MESSAGE_RECEIVED` listener detects proposal blocks and places them in a pending review queue.
- Player can approve all, edit then approve, or reject.
- Only approved proposals update NPC memories, relationship scores or world memories.
- Duplicate NPC memories are filtered before saving.
- Pending proposals and processed-message signatures are stored in per-chat metadata.
- The AI protocol is inserted into the chat input for user review; the extension does not silently send prompts or make external model/API calls.

### Using Memory Sync
1. Register NPCs first in the NPC tab.
2. Open AI Memory and choose **Insert RPG + memory protocol** to add the protocol to the conversation, or choose **Analyze recent conversation** to create a one-time analysis prompt.
3. Send the inserted prompt to your model.
4. When the AI replies with a valid proposal block, it appears in AI Memory.
5. Review each proposed memory/relationship change. Approve, edit & approve, or reject.
6. Approved memories are included in subsequent RPG context insertion.

### Trust and safety
- No AI proposal is written to permanent NPC/world data before player confirmation.
- Relationship deltas are clamped to -20..+20 per proposal and cumulative affinity is clamped to -100..100.
- NPC names must match registered NPCs exactly (case-insensitive).
- The analyzer does not update RPG stats, inventory, EXP, missions or combat state.
- The analyzer depends on the AI following the structured output protocol; malformed or unsupported blocks are ignored.
