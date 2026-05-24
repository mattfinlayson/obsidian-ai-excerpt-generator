import { App, Notice } from "obsidian";
import { PromptLoader } from "./prompt-loader";
import { BUILTIN_PROMPT_IDS } from "../types";

/**
 * Central repository of all prompt templates used in the application
 */
export class Prompts {
	private static promptCache: Record<string, string> = {};
	private static isInitialized = false;
	private static defaultPrompt =
		"Generate a concise summary of the following text in less than 200 words, focusing on the key points and main ideas.";
	private static customPromptSlugs: string[] = [];

	/**
	 * Initialize the prompts system with the Obsidian app
	 */
	public static initialize(app: App): void {
		PromptLoader.initialize(app);
		this.isInitialized = true;
	}

	/**
	 * Load all built-in prompts into the cache
	 */
	public static async loadAllPrompts(): Promise<void> {
		if (!this.isInitialized) {
			throw new Error(
				"Prompts system not initialized. Call initialize() first."
			);
		}

		const promptLoadErrors: string[] = [];

		// Ensure default prompt is loaded first as it serves as a fallback
		try {
			this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT] = await PromptLoader.load(
				BUILTIN_PROMPT_IDS.DEFAULT
			);
		} catch (e) {
			console.error("Failed to load default prompt template", e);
			promptLoadErrors.push(BUILTIN_PROMPT_IDS.DEFAULT);
			this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT] = this.defaultPrompt;
			console.warn("Using hardcoded default prompt as fallback");
		}

		// Load all other built-in prompts
		const otherBuiltIns = [
			BUILTIN_PROMPT_IDS.ACADEMIC,
			BUILTIN_PROMPT_IDS.PROFESSIONAL,
			BUILTIN_PROMPT_IDS.BLOG,
			BUILTIN_PROMPT_IDS.SIMPLIFIED,
			BUILTIN_PROMPT_IDS.SOCIAL,
		];

		// Use Promise.allSettled to load all prompts in parallel without failing on an error
		const results = await Promise.allSettled(
			otherBuiltIns.map(async (id) => {
				try {
					const content = await PromptLoader.load(id);
					this.promptCache[id] = content;
					return { success: true, id };
				} catch (e) {
					console.error(`Failed to load ${id} prompt`, e);
					promptLoadErrors.push(id);
					// Use default prompt as fallback
					this.promptCache[id] = this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT];
					return { success: false, id, error: e };
				}
			})
		);

		// Report errors if any prompts failed to load
		if (promptLoadErrors.length > 0) {
			const errorMessage = `Failed to load ${
				promptLoadErrors.length
			} prompt templates: ${promptLoadErrors.join(", ")}`;
			console.error(errorMessage);
		}
	}

	/**
	 * Get a prompt by ID (built-in or custom)
	 * Returns from cache if available, loads from file if not
	 * Falls back to DEFAULT if the prompt is not found
	 */
	public static async getPrompt(id: string): Promise<string> {
		// Check cache first (both built-in and custom)
		if (this.promptCache[id]) {
			return this.promptCache[id];
		}

		// Check if it's a built-in that needs loading
		const builtInValues = Object.values(BUILTIN_PROMPT_IDS);
		if (builtInValues.includes(id as typeof builtInValues[number])) {
			try {
				const content = await PromptLoader.load(id);
				this.promptCache[id] = content;
				return content;
			} catch (e) {
				console.error(`Failed to load built-in prompt ${id}, using default`, e);
				return this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT] || this.defaultPrompt;
			}
		}

		// Try loading as a custom prompt
		try {
			const content = await PromptLoader.loadCustom(id);
			this.promptCache[id] = content;
			return content;
		} catch (e) {
			console.warn(`Custom prompt "${id}" not found, falling back to default`, e);
			new Notice(`Custom prompt "${id}" not found. Using default prompt.`);
			return this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT] || this.defaultPrompt;
		}
	}

	/**
	 * Load custom prompt slugs at startup
	 * Populates the registry for synchronous access by the settings dropdown
	 */
	public static async loadCustomPrompts(): Promise<void> {
		this.customPromptSlugs = await PromptLoader.listCustomPrompts();
	}

	/**
	 * Get the list of custom prompt slugs (synchronous, cache-backed)
	 */
	public static getCustomPromptSlugs(): string[] {
		return [...this.customPromptSlugs];
	}

	/**
	 * Invalidate a specific custom prompt's cache entry
	 */
	public static invalidateCustomPrompt(slug: string): void {
		delete this.promptCache[slug];
		// Also remove from the slugs list if needed
		const idx = this.customPromptSlugs.indexOf(slug);
		if (idx !== -1) {
			this.customPromptSlugs.splice(idx, 1);
		}
	}

	/**
	 * Add a custom prompt slug to the registry
	 */
	public static addCustomPromptSlug(slug: string): void {
		if (!this.customPromptSlugs.includes(slug)) {
			this.customPromptSlugs.push(slug);
		}
	}

	/**
	 * Reload all prompts from their source files
	 */
	public static async reload(): Promise<void> {
		PromptLoader.clearCache();
		this.promptCache = {};
		await this.loadAllPrompts();
		await this.loadCustomPrompts();
	}
}