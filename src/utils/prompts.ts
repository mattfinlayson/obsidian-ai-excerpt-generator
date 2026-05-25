import { App, Notice } from "obsidian";
import { PromptLoader } from "./prompt-loader";
import { BUILTIN_PROMPT_IDS } from "../types";

export class Prompts {
	private static promptCache: Record<string, string> = {};
	private static isInitialized = false;
	private static defaultPrompt =
		"Generate a concise summary of the following text in less than 200 words, focusing on the key points and main ideas.";

	public static initialize(app: App): void {
		PromptLoader.initialize(app);
		this.isInitialized = true;
	}

	public static async loadAllPrompts(): Promise<void> {
		if (!this.isInitialized) {
			throw new Error(
				"Prompts system not initialized. Call initialize() first."
			);
		}

		const promptLoadErrors: string[] = [];

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

		const otherBuiltIns = [
			BUILTIN_PROMPT_IDS.ACADEMIC,
			BUILTIN_PROMPT_IDS.PROFESSIONAL,
			BUILTIN_PROMPT_IDS.BLOG,
			BUILTIN_PROMPT_IDS.SIMPLIFIED,
			BUILTIN_PROMPT_IDS.SOCIAL,
		];

		const results = await Promise.allSettled(
			otherBuiltIns.map(async (id) => {
				try {
					const content = await PromptLoader.load(id);
					this.promptCache[id] = content;
					return { success: true, id };
				} catch (e) {
					console.error(`Failed to load ${id} prompt`, e);
					promptLoadErrors.push(id);
					this.promptCache[id] = this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT];
					return { success: false, id, error: e };
				}
			})
		);

		if (promptLoadErrors.length > 0) {
			const errorMessage = `Failed to load ${
				promptLoadErrors.length
			} prompt templates: ${promptLoadErrors.join(", ")}`;
			console.error(errorMessage);
		}
	}

	public static async getPrompt(id: string): Promise<string> {
		if (this.promptCache[id]) {
			return this.promptCache[id];
		}

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

		try {
			const content = await PromptLoader.loadCustom(id);
			this.promptCache[id] = content;
			PromptLoader.addToCustomPromptRegistry(id);
			return content;
		} catch (e) {
			console.warn(`Custom prompt "${id}" not found, falling back to default`, e);
			new Notice(`Custom prompt "${id}" not found. Using default prompt.`);
			return this.promptCache[BUILTIN_PROMPT_IDS.DEFAULT] || this.defaultPrompt;
		}
	}

	public static async loadCustomPrompts(): Promise<void> {
		await PromptLoader.listCustomPrompts();
	}

	public static getCustomPromptSlugs(): string[] {
		return PromptLoader.getCustomPromptSlugs();
	}

	public static invalidateCustomPrompt(slug: string): void {
		delete this.promptCache[slug];
		delete this.promptCache[`custom:${slug}`];
	}

	public static addCustomPromptSlug(slug: string): void {
		PromptLoader.addToCustomPromptRegistry(slug);
	}

	public static async reload(): Promise<void> {
		PromptLoader.clearCache();
		this.promptCache = {};
		await this.loadAllPrompts();
		await this.loadCustomPrompts();
	}
}