---
title: "feat: Add Custom Prompt Management"
type: feat
status: active
date: 2026-05-23
---

# feat: Add Custom Prompt Management

## Summary

Replace the closed `PromptType` enum with unified string IDs, refactor the 4 duplicated `_getPromptForType()` switch statements into a single `Prompts.getPrompt(id)` registry, add CRUD for user-created custom prompts stored as `.md` files in the plugin directory, and wire the settings dropdown + modal editor so users can create, select, edit, and delete custom prompts alongside the 6 built-in types.

---

## Problem Frame

The plugin ships 6 hardcoded prompt types. Users who want a different excerpt style have no way to create or customize prompts without editing source files and rebuilding. The `PromptType` enum is closed, making it impossible to represent user-defined prompts, and every provider duplicates the same prompt-resolution switch statement 4 times.

---

## Requirements

- R1. Users can create new custom prompts with a name and body text via a modal editor
- R2. Users can edit existing custom prompts via the same modal editor
- R3. Users can delete custom prompts, with a fallback to DEFAULT when the active prompt is deleted
- R4. Custom prompts appear alongside built-in types in the prompt type dropdown
- R5. `promptType` is stored as a plain string, unified across built-in and custom IDs
- R6. Built-in prompts remain read-only; only custom prompts are editable/deletable
- R7. Custom prompt names that collide with built-in IDs are rejected at creation time
- R8. Custom prompt names that slugify to an existing custom prompt slug are rejected at creation time (unless editing the same prompt)
- R9. The "Example Output" section is hidden when a custom prompt is selected
- R10. Generating an excerpt with a custom prompt loads the prompt text at generation time, with fallback to DEFAULT if the file is missing
- R11. Custom prompts survive settings reload and plugin restart
- R12. When the active custom prompt is missing (deleted externally), the settings UI shows a warning and prompts the user to select another

---

## Scope Boundaries

- No import/export of custom prompts between vaults
- No template variable rendering (`{{ original_text }}` remains decorative, as in built-in prompts)
- No parsing of XML-like `<prompt>` tags in custom prompt files
- No editing of built-in prompts
- No concurrent-edit detection or file-watching for custom prompt `.md` files
- No test framework introduction (this repo has no test infrastructure)

### Deferred to Follow-Up Work

- Export/import mechanism for sharing custom prompts across vaults
- Template variable rendering for `{{ }}` placeholders
- File-watching or auto-reload of custom prompt files edited externally
- Obsidian `Editor` API integration for the prompt editor (richer markdown editing)

---

## Context & Research

### Relevant Code and Patterns

- `src/types.ts` — `PromptType` enum (6 values), `AIExcerptSettings.promptType` typed as `PromptType`
- `src/utils/prompts.ts` — `Prompts` class with static getters per built-in type, `promptCache` record, `loadAllPrompts()`, `reload()`
- `src/utils/prompt-loader.ts` — `PromptLoader` with `load(filename)`, `processMarkdown()` strips H1, plugin-directory path strategies, static `cache`
- `src/providers/claude-provider.ts` — `_getPromptForType()` switch on `PromptType` → `Prompts` getters (identical in all 4 providers)
- `src/settings.ts` — `PROMPT_EXAMPLES` object keyed by `PromptType`, `getExampleForLength()` with no fallback for unknown types, `AIExcerptSettingTab.display()` rebuilds DOM
- `src/main.ts` — `loadSettings()` migration pattern, `saveSettings()` calls `Prompts.reload()`, `Prompts.initialize(this.app)`
- `src/modals/commands-modal.ts` — Modal pattern: `onOpen()` with `Setting` API, `onClose()` with `contentEl.empty()`
- `src/providers/provider-factory.ts` — Creates providers with `settings.promptType`, typed as `PromptType`

### Institutional Learnings

- No `docs/solutions/` directory exists yet in this repo

### External References

- Obsidian `Modal` API for editor dialogs
- Obsidian `vault.adapter` API for filesystem operations under `.obsidian/plugins/`

---

## Key Technical Decisions

- **Unified string IDs replace the `PromptType` enum entirely**: The enum is removed. Built-in IDs become exported string constants (`BUILTIN_PROMPT_IDS`). `AIExcerptSettings.promptType` changes from `PromptType` to `string`. This avoids a dual-field model and eliminates the conversion layer at every boundary. Rationale: simpler data model, no ambiguity between enum and string, one namespace.
- **Custom prompts stored as `.md` files in `custom-prompts/` under the plugin directory**: Path is `.obsidian/plugins/ai-excerpt-generator/custom-prompts/<slug>.md`. This mirrors the existing `prompts/` directory convention, keeps files accessible to users who want to edit directly, and avoids polluting the vault file tree.
- **`Prompts.getPrompt(id: string)` replaces all `_getPromptForType()` switch statements**: A single lookup method on `Prompts` handles both built-in and custom IDs. All 4 providers call this method instead of their own switch statements.
- **Lazy creation of `custom-prompts/` directory**: Created on first custom prompt write via `vault.adapter.mkdir()`, not at plugin install.
- **Slug-based filenames**: Display names are slugified (lowercase, spaces→hyphens, strip special chars) for filenames, matching `academic-summary` pattern.
- **Delete of active custom prompt falls back to DEFAULT**: Settings `promptType` is reset to the DEFAULT constant, and a Notice informs the user. No re-generation of existing excerpts.
- **Cache granularity**: All prompt caching goes through `Prompts.promptCache` using **kebab-case keys** (matching `BUILTIN_PROMPT_IDS` values and custom slugs). The existing camelCase keys in `promptCache` are changed to kebab-case (`excerptGeneration` → `excerpt-generation`, etc.) so `getPrompt(id)` can directly index by id without a mapping layer. Individual custom prompt cache entries are invalidated on save/edit. Full `reload()` is not called for custom prompt edits — only for settings changes that affect built-in loading. A new `Prompts.invalidateCustomPrompt(slug)` method handles targeted invalidation.
- **Custom prompt names cached at startup**: `Prompts.loadCustomPrompts()` (called in `onload()`) discovers custom prompt slugs and populates a static registry. `PromptLoader.listCustomPrompts()` returns slugs **synchronously** from this registry — it does not read the filesystem. CRUD handlers (save, delete) update the registry in-place on success, keeping `display()` synchronous.

---

## Open Questions

### Resolved During Planning

- **How to represent custom prompts in the type system?** Unified string IDs — `PromptType` enum removed entirely.
- **Where to store custom prompt files?** Plugin directory `custom-prompts/` subfolder.
- **Built-in prompts editable?** No — read-only. Only custom prompts support CRUD.
- **Editor UI?** Modal dialog with name field + textarea + save/cancel.
- **Example output for custom prompts?** Skip the "Example Output" section when a custom prompt is selected.

### Deferred to Implementation

- **Exact slugification rules and edge cases**: What happens with names like "My--Prompt" (double hyphens) or names that are all special chars after slugification? Implementation should handle these with clear validation messages.
- **Custom-to-custom slug collision handling**: When a newly entered name slugifies to the same value as an existing custom prompt (e.g., "My Prompt" and "my-prompt"), the save should be rejected with a validation error. Exception: editing the same prompt (slug unchanged) is allowed.
- **Orphaned promptType in dropdown**: When `settings.promptType` references a custom slug that no longer exists (file deleted externally), the dropdown should add a temporary disabled option like "⚠ Missing custom prompt — select another" and the user must pick a valid option. On next `display()`, if the slug is missing from both built-in and custom lists, reset to DEFAULT with a Notice.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Data Flow: Prompt Resolution

```
settings.promptType (string, kebab-case)
        │
        ▼
  Prompts.getPrompt(id)
        │
        ├── id in promptCache? ──► return promptCache[id]   (kebab-case keys for both built-in and custom)
        │
        ├── id is built-in constant? ──► load built-in .md ──► cache in promptCache[id] ──► return text
        │
        └── else (custom slug) ──► PromptLoader.loadCustom(slug)
                                        │
                                        ├── file exists? ──► processMarkdown() ──► cache in promptCache[id] ──► return text
                                        └── missing? ──► fallback to DEFAULT + Notice
```

### Custom Prompt Lifecycle

```
Create:  User clicks "Add" → PromptEditorModal (empty) → Save → slugify(name) → ensure dir → write .md → addToCustomPromptRegistry → invalidate cache → refresh dropdown
Edit:    User clicks "Edit" on custom prompt → PromptEditorModal (pre-filled via async load) → Save → overwrite .md → invalidate cache
Delete:  User clicks "Delete" → window.confirm() → if active: reset to DEFAULT → delete .md → removeFromCustomPromptRegistry → invalidate cache → refresh dropdown
Select:  User picks from dropdown (built-in + custom mixed) → save settings.promptType → used at next generation
```

---

## Implementation Units

### U1. Replace PromptType enum with string constants and update settings type

**Goal:** Remove the closed `PromptType` enum, replace it with exported string constants for built-in IDs, and change `AIExcerptSettings.promptType` from `PromptType` to `string`.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`

**Approach:**
- In `types.ts`: Remove `PromptType` enum. Export `BUILTIN_PROMPT_IDS` object mapping display names to ID strings (same values as current enum: `"excerpt-generation"`, `"academic-summary"`, etc.). Change `AIExcerptSettings.promptType` from `PromptType` to `string`.
- In `settings.ts`: Replace `PromptType` imports with `BUILTIN_PROMPT_IDS`. Update `DEFAULT_SETTINGS.promptType` to `"excerpt-generation"` string. Replace `PROMPT_EXAMPLES` keys from enum references to string constants. Update `getExampleForLength` parameter type from `PromptType` to `string`.

**Patterns to follow:**
- Existing `LLMProvider` enum pattern for constant definition style
- Current `DEFAULT_SETTINGS` flat assignment

**Test scenarios:**
- Happy path: settings load with string `promptType`, dropdown shows all 6 built-in options, selection saves correctly
- Edge case: existing `data.json` with `promptType: "excerpt-generation"` loads without migration (values are identical strings)
- Error path: unknown `promptType` string in `data.json` doesn't crash settings display

**Verification:**
- Plugin builds without errors
- Settings dropdown shows all 6 built-in prompt types
- Selecting a prompt type persists the string value

---

### U2. Unified `Prompts.getPrompt(id)` and custom prompt loading

**Goal:** Refactor `Prompts` class to support both built-in and custom prompt lookup via a single `getPrompt(id)` method, and add `PromptLoader.loadCustom(slug)` for loading from the `custom-prompts/` directory.

**Requirements:** R5, R10

**Dependencies:** U1

**Files:**
- Modify: `src/utils/prompts.ts`
- Modify: `src/utils/prompt-loader.ts`

**Approach:**
- In `prompts.ts`: Remove the 6 static getters (`excerptGeneration`, `academicSummary`, etc.). Change `promptCache` keys from camelCase to kebab-case (e.g., `excerptGeneration` → `excerpt-generation`) to match `BUILTIN_PROMPT_IDS` values and custom slugs directly. Add `public static async getPrompt(id: string): Promise<string>` that checks `id` in `promptCache` first (both built-in and custom), else loads: built-in via existing path, custom via `PromptLoader.loadCustom(id)` with DEFAULT fallback. All loaded custom prompts are cached in `promptCache[id]`. Update `loadAllPrompts()` to use the new string constants and kebab-case keys. Add `invalidateCustomPrompt(slug)` that deletes `promptCache[slug]` for targeted cache invalidation. Add `public static async loadCustomPrompts(): Promise<void>` that discovers all custom prompt slugs from the `custom-prompts/` directory and populates a static `customPromptSlugs: string[]` registry. Do not eagerly load content — only register slugs for the dropdown. Add `public static getCustomPromptSlugs(): string[]` (synchronous, reads from the registry).
- In `prompt-loader.ts`: Add `public static async loadCustom(slug: string): Promise<string>` that resolves `custom-prompts/<slug>.md` under the plugin directory. Add `public static getCustomPromptSlugs(): string[]` that returns slugs synchronously from the registry populated by `Prompts.loadCustomPrompts()`. Add `public static addToCustomPromptRegistry(slug: string): void` and `public static removeFromCustomPromptRegistry(slug: string): void` for CRUD handlers to keep the registry in sync. Add `public static async saveCustomPrompt(slug: string, content: string): Promise<void>` for writing. Add `public static async deleteCustomPrompt(slug: string): Promise<void>` for deletion. Add `public static async ensureCustomPromptsDir(): Promise<void>` for lazy directory creation.
- Keep `processMarkdown()` as-is for custom prompt files (strip H1, return body).

**Patterns to follow:**
- Existing `PromptLoader.load()` path-strategy pattern for `loadCustom()`
- Existing `vault.adapter.exists/read` pattern for filesystem ops
- Existing `processMarkdown()` for content processing

**Test scenarios:**
- Happy path: `getPrompt("excerpt-generation")` returns built-in prompt text
- Happy path: `getPrompt("my-custom")` loads and returns custom prompt from `custom-prompts/my-custom.md`
- Happy path: `getCustomPromptSlugs()` returns slugs synchronously from startup-populated registry
- Edge case: custom prompt file missing at generation time → falls back to DEFAULT prompt with Notice
- Edge case: `getCustomPromptSlugs()` returns empty array when no custom prompts exist
- Error path: file read permission error → throws with descriptive message

**Verification:**
- `Prompts.getPrompt()` works for both built-in and custom IDs
- Custom prompt files are loaded from the correct directory
- Missing custom prompts fall back gracefully

---

### U3. Remove `_getPromptForType()` from all 4 providers, use `Prompts.getPrompt(id)`; update ProviderFactory

**Goal:** Eliminate the 4 duplicated switch statements by having each provider call `Prompts.getPrompt(id)` instead, and update `ProviderFactory` to pass `promptType` as a plain string.

**Requirements:** R5

**Dependencies:** U2

**Files:**
- Modify: `src/providers/claude-provider.ts`
- Modify: `src/providers/openai-provider.ts`
- Modify: `src/providers/ollama-local-provider.ts`
- Modify: `src/providers/ollama-cloud-provider.ts`
- Modify: `src/providers/provider-factory.ts`

**Approach:**
- In each provider: Remove `_getPromptForType()` method. Remove `promptType` private field (or change it from `PromptType` to `string`). In `generateExcerpt()`, replace the `_getPromptForType()` call with `await Prompts.getPrompt(this.promptType)`. Since `generateExcerpt` is already async, this change is compatible.
- Change constructor parameter types from `PromptType` to `string` for the prompt type argument.
- In `provider-factory.ts`: Remove `PromptType` import. Change `settings.promptType` references from `PromptType` to plain `string` (already changed in types.ts). Update log messages. The factory already passes `settings.promptType` to constructors — no structural change beyond the type.

**Patterns to follow:**
- Existing `generateExcerpt()` async signature
- Existing factory pattern for provider creation

**Test scenarios:**
- Happy path: each provider resolves built-in prompt correctly via `Prompts.getPrompt()`
- Happy path: each provider resolves custom prompt correctly via `Prompts.getPrompt()`
- Edge case: missing custom prompt → provider receives DEFAULT fallback text from `Prompts.getPrompt()`
- Happy path: factory creates providers with string prompt type for all 4 provider types

**Verification:**
- All 4 providers call `Prompts.getPrompt()` instead of `_getPromptForType()`
- No `_getPromptForType` method remains in any provider
- Factory creates providers correctly with string prompt type
- Plugin builds without errors

---

### U5. PromptEditorModal for creating and editing custom prompts

**Goal:** Build a modal dialog with name field + textarea + save/cancel for creating and editing custom prompts.

**Requirements:** R1, R2, R6, R7, R8

**Dependencies:** U2

**Files:**
- Create: `src/modals/prompt-editor-modal.ts`

**Approach:**
- Modal receives the plugin reference and an optional `slug` parameter (when editing an existing prompt).
- `onOpen()`: Build UI with name text field (disabled when editing existing prompt to prevent slug change), large textarea for prompt content, save and cancel buttons.
- Name field validates on input: reject empty names, reject names matching built-in IDs, reject names that slugify to an existing custom prompt slug (unless editing that same prompt), slugify for display. Validation errors are shown as red text in a description element below the name field, updated on every keystroke. Save button is disabled while validation fails.
- Save flow: on save click → disable save button, show "Saving…" text → slugify the name, call `PromptLoader.ensureCustomPromptsDir()` then `PromptLoader.saveCustomPrompt(slug, content)` with the textarea content (prefixed by an H1 heading from the name), call `Prompts.invalidateCustomPrompt(slug)`, call `PromptLoader.addToCustomPromptRegistry(slug)` → close modal on success. On failure → show Notice, re-enable save button, keep modal open.
- When editing (slug provided): show modal immediately with name field disabled and textarea showing "Loading…" placeholder with save button disabled. Call `PromptLoader.loadCustom(slug)` asynchronously. On success → populate textarea with content, enable save button. On failure → show error Notice, keep modal open with empty textarea.
- The prompt content stored in the `.md` file starts with `# <display name>` as H1, followed by the textarea content — consistent with built-in prompt file format.

**Patterns to follow:**
- `src/modals/commands-modal.ts` — Modal pattern with `onOpen()`, `onClose()`, `Setting` API, button event handlers
- Existing `contentEl.createEl()`, `contentEl.createDiv()` patterns

**Test scenarios:**
- Happy path (create): enter name and content → save → file written to `custom-prompts/`
- Happy path (edit): open with existing slug → name disabled, content pre-filled → save → file overwritten
- Edge case: name matches built-in ID → validation error shown, save blocked
- Edge case: name contains special characters → slugified correctly for filename
- Edge case: empty content → show `window.confirm("This prompt has no body text. Excerpts generated with it will use only default instructions. Save anyway?")`, allow on confirm
- Error path: directory creation fails → Notice shown, modal stays open
- Error path: file write fails → Notice shown, modal stays open

**Verification:**
- Modal opens for create (empty) and edit (pre-filled) modes
- Validation prevents built-in name collisions
- Files are written to the correct directory

---

### U6. Settings tab: custom prompt dropdown, CRUD section, example-output handling

**Goal:** Update the settings tab to show custom prompts in the dropdown, add a "Custom Prompts" CRUD section, and hide the example output section when a custom prompt is selected.

**Requirements:** R1, R2, R3, R4, R9, R12

**Dependencies:** U2, U5

**Files:**
- Modify: `src/settings.ts`

**Approach:**
- In `settings.ts`:
  - Replace `PromptType` imports/references with `BUILTIN_PROMPT_IDS`.
  - Update the prompt type dropdown to dynamically list both built-in and custom prompts. On `display()`, call `PromptLoader.getCustomPromptSlugs()` (synchronous, cache-backed) to get available custom prompt slugs, then add options for each. Add a disabled separator option `─── Custom Prompts ───` between built-in and custom entries. Custom options use the slug as value and a title-cased display name derived from the slug (e.g., `my-custom-prompt` → "My Custom Prompt"). Do not read file H1s (avoids reintroducing async).
  - If `settings.promptType` does not match any built-in or custom option, add a temporary disabled option `⚠ Missing custom prompt — select another` to the dropdown and show a Notice suggesting the user select a different prompt.
  - Add a "Custom Prompts" section below the prompt type dropdown with:
    - List of existing custom prompts (each with Edit and Delete buttons)
    - "Add Custom Prompt" button that opens `PromptEditorModal`
    - Edit button opens `PromptEditorModal` with the slug
    - Delete button: show `window.confirm()` with text "Delete custom prompt \"<name>\"? This cannot be undone." If the deleted prompt is the active one, add: "This prompt is currently in use. Delete it and switch to Default prompt?" → reset `promptType` to DEFAULT and show Notice on confirm.
  - When `promptType` matches a custom slug, hide the "Example Output" section entirely.
  - In the max-length slider `onChange` handler: add a guard — if `settings.promptType` is not in `PROMPT_EXAMPLES`, skip the `getExampleForLength()` call entirely (prevents crash on custom slugs).
  - On dropdown change for custom prompts, the example section hides; on change back to built-in, it shows.
  - Call `this.display()` after modal close to refresh the custom prompts list and dropdown.

**Patterns to follow:**
- Existing `AIExcerptSettingTab.display()` pattern of full DOM rebuild
- Existing `if (this.plugin.settings.provider === ...)` conditional rendering
- Existing `new Setting(containerEl).addButton()` pattern for CRUD buttons

**Test scenarios:**
- Happy path: dropdown shows 6 built-in, separator, then any custom prompts
- Happy path: selecting a custom prompt saves the slug as `promptType`, hides example section
- Happy path: selecting a built-in prompt shows example section
- Happy path: "Add Custom Prompt" opens modal → save → prompt appears in list and dropdown
- Happy path: "Edit" on custom prompt opens modal pre-filled → save → list refreshed
- Happy path: "Delete" on inactive custom prompt → `window.confirm()` → removed from list and dropdown
- Happy path: "Delete" on active custom prompt → `window.confirm()` with active-use warning → `promptType` reset to DEFAULT, Notice shown
- Edge case: no custom prompts → list section shows "No custom prompts" message
- Edge case: custom prompt deleted externally → dropdown shows "⚠ Missing custom prompt" disabled option on next `display()`
- Edge case: max-length slider onChange with custom prompt selected → no crash, example section already hidden

**Verification:**
- Settings tab shows built-in and custom prompts in dropdown
- CRUD operations work (add, edit, delete)
- Example output section hides for custom selections
- Deleting active prompt falls back to DEFAULT

---

### U7. Settings migration and startup loading of custom prompts

**Goal:** Ensure custom prompts are loaded at plugin startup, that settings migration handles the `PromptType` enum removal, and that the slug registry is populated for synchronous dropdown rendering.

**Requirements:** R5, R11

**Dependencies:** U1, U2

**Files:**
- Modify: `src/main.ts`

**Approach:**
- In `onload()`, after `Prompts.loadAllPrompts()`, call `Prompts.loadCustomPrompts()` which discovers all custom prompt slugs from `custom-prompts/` and populates the static `customPromptSlugs` registry. Content is not loaded eagerly — only slugs are registered for synchronous access by `getCustomPromptSlugs()`.
- In `loadSettings()`: the `promptType` field is now a string. Since current enum values (`"excerpt-generation"`, etc.) are identical to the new string constants, no migration is needed for the `promptType` field itself. Add a safety check: if `promptType` is not a string (e.g., `undefined` or an unexpected type), reset it to `DEFAULT_SETTINGS.promptType`. Remove any `PromptType` type cast that may have been present. Consolidate all `main.ts` migration logic here (including the PromptType-to-string safety check that was previously split across U6).
- Ensure `saveSettings()` continues to call `Prompts.reload()` (which should now also reload custom prompt slugs via `Prompts.loadCustomPrompts()`).

**Patterns to follow:**
- Existing `loadSettings()` migration pattern (used for Ollama provider split)

**Test scenarios:**
- Happy path: plugin loads with existing settings, custom prompts appear
- Happy path: plugin loads with no custom prompts directory → created lazily on first use
- Edge case: `data.json` has a `promptType` value matching a deleted custom prompt → falls back to DEFAULT at generation time
- Edge case: corrupted `data.json` → `DEFAULT_SETTINGS` fallback applies

**Verification:**
- Plugin starts successfully with the new string-based `promptType`
- Custom prompts are loaded at startup
- Existing user settings are preserved without migration errors

---

## System-Wide Impact

- **Interaction graph:** All 4 provider constructors change their `promptType` parameter type from `PromptType` to `string`. `ProviderFactory.createProvider()` passes the string through. `FileProcessor` is unchanged — it doesn't interact with prompts directly. `promptCache` keys change from camelCase to kebab-case (internal refactor, no external impact).
- **Error propagation:** Missing custom prompt at generation time → `Prompts.getPrompt()` returns DEFAULT text + shows Notice, does not throw. This prevents provider-level errors from propagating up to `FileProcessor`.
- **State lifecycle risks:** Deleting the active custom prompt creates a state where `settings.promptType` references a non-existent prompt. Settings tab handles this at delete time by resetting to DEFAULT. If the file is deleted externally, the dropdown shows a "⚠ Missing custom prompt" disabled option on next `display()`, and `Prompts.getPrompt()` catches it at generation time with a DEFAULT fallback.
- **`getExampleForLength()` guard:** The slider onChange handler in settings now guards against custom prompt slugs that have no entry in `PROMPT_EXAMPLES`, preventing a TypeError crash.
- **API surface parity:** No external API changes. All changes are internal to the plugin.
- **Integration coverage:** The delete-then-generate path (active custom prompt deleted, then excerpt triggered) should be verified as an integration scenario — unit-level cache fallback doesn't prove the full user-facing flow.
- **Unchanged invariants:** `FileProcessor`, `GenerateAllModal`, `SelectDirectoryModal`, `CommandsModal` are not modified. The excerpt output format and frontmatter writing behavior remain the same.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Users with existing `data.json` see type errors | No migration needed — `PromptType` enum values are identical to new string constants |
| Custom prompt file deleted externally while active | `Prompts.getPrompt()` falls back to DEFAULT + Notice at generation time |
| Slugification produces empty string (all-special-char names) | Validate that slugified name is non-empty before allowing save |
| `custom-prompts/` directory doesn't exist at startup | Lazy creation on first write, `getCustomPromptSlugs()` returns empty array when dir missing |
| Cache staleness after external edit of custom prompt files | User can trigger reload via settings save; full auto-reload deferred |

---

## Sources & References

- Related code: `src/utils/prompts.ts`, `src/utils/prompt-loader.ts`, `src/types.ts`, `src/settings.ts`
- Related plans: `docs/plans/2026-05-23-001-feat-ollama-provider-plan.md`, `docs/plans/2026-05-23-002-feat-ollama-cloud-api-key-plan.md`