import { App } from "obsidian";
import * as path from "path";
import { BUILTIN_PROMPT_IDS } from "../types";

/**
 * Prompt templates manager that loads prompts from markdown files in Obsidian
 */
export class PromptLoader {
	private static cache: Record<string, string> = {};
	private static app: App | null = null;
	private static pluginId = "ai-excerpt-generator";
	private static customPromptSlugs: string[] = [];

	/**
	 * Initialize the prompt loader with Obsidian's App instance
	 */
	public static initialize(app: App): void {
		this.app = app;
	}

	/**
	 * Get the base path for the plugin directory
	 */
	private static getPluginBasePath(): string | null {
		if (!this.app) return null;

		const plugins = (this.app as any).plugins;
		const plugin = plugins.getPlugin(this.pluginId);

		if (plugin) {
			if (plugin.manifest && plugin.manifest.dir) {
				return plugin.manifest.dir;
			}
			if (plugin.path) {
				return plugin.path;
			}
		}

		return `.obsidian/plugins/${this.pluginId}`;
	}

	/**
	 * Load a built-in prompt template from a markdown file
	 */
	public static async load(filename: string): Promise<string> {
		if (!this.app) {
			throw new Error(
				"PromptLoader not initialized. Call initialize() first."
			);
		}

		const cacheKey = filename;

		// Return from cache if available
		if (this.cache[cacheKey]) {
			return this.cache[cacheKey];
		}

		let content: string | null = null;

		try {
			// Get the plugin instance
			const plugins = (this.app as any).plugins;
			const plugin = plugins.getPlugin(this.pluginId);

			if (plugin) {
				const pluginPromptPath = `prompts/${filename}.md`;

				try {
					// Attempt multiple strategies to find the prompt file
					const possiblePaths = [];

					// Strategy 1: Using plugin.path if available
					if (plugin.path) {
						possiblePaths.push(
							path.join(plugin.path, pluginPromptPath)
						);
					}

					// Strategy 2: Using manifest.dir if available
					if (plugin.manifest && plugin.manifest.dir) {
						possiblePaths.push(
							path.join(plugin.manifest.dir, pluginPromptPath)
						);
					}

					// Strategy 3: Direct path in plugin directory
					possiblePaths.push(pluginPromptPath);

					// Strategy 4: Using baseDir from plugin settings if available
					if ((plugin as any).baseDir) {
						possiblePaths.push(
							path.join((plugin as any).baseDir, pluginPromptPath)
						);
					}

					// Try each path until we find one that works
					for (const pathToTry of possiblePaths) {
						if (await this.app.vault.adapter.exists(pathToTry)) {
							content = await this.app.vault.adapter.read(
								pathToTry
							);
							console.log(
								`Loaded prompt from path: ${pathToTry}`
							);
							break;
						}
					}

					// If still no content, look directly in plugin's bundled files
					if (!content && plugin.manifest) {
						const resourcePath = `.obsidian/plugins/${this.pluginId}/${pluginPromptPath}`;
						if (await this.app.vault.adapter.exists(resourcePath)) {
							content = await this.app.vault.adapter.read(
								resourcePath
							);
							console.log(
								`Loaded prompt from plugin resources: ${resourcePath}`
							);
						}
					}

					if (!content) {
						console.warn(
							`Could not find prompt file: ${filename} in any location`
						);
					}
				} catch (pluginError) {
					console.error(
						`Error loading from plugin directory: ${pluginError}`
					);
				}
			} else {
				console.error(`Plugin not found: ${this.pluginId}`);
			}

			// If content was loaded, process and cache it
			if (content) {
				const promptContent = this.processMarkdown(content);
				this.cache[cacheKey] = promptContent;
				return promptContent;
			}

			// Provide a basic default prompt if the file can't be loaded
			if (filename === "excerpt-generation") {
				const defaultPrompt =
					"Generate a concise summary of the following text in less than 200 words, focusing on the key points and main ideas.";
				console.warn("Using hardcoded default prompt as fallback");
				this.cache[cacheKey] = defaultPrompt;
				return defaultPrompt;
			}

			// If we couldn't load the content, throw an error
			throw new Error(`Failed to load prompt template: ${filename}`);
		} catch (error) {
			console.error(`Failed to load prompt template: ${filename}`, error);
			throw error;
		}
	}

	/**
	 * Load a custom prompt from the custom-prompts directory
	 */
	public static async loadCustom(slug: string): Promise<string> {
		if (!this.app) {
			throw new Error(
				"PromptLoader not initialized. Call initialize() first."
			);
		}

		const cacheKey = `custom:${slug}`;
		if (this.cache[cacheKey]) {
			return this.cache[cacheKey];
		}

		const basePath = this.getPluginBasePath();
		if (!basePath) {
			throw new Error("Could not determine plugin base path");
		}

		const filePath = path.join(basePath, "custom-prompts", `${slug}.md`);

		if (!(await this.app.vault.adapter.exists(filePath))) {
			throw new Error(`Custom prompt not found: ${slug}`);
		}

		const content = await this.app.vault.adapter.read(filePath);
		const processed = this.processMarkdown(content);
		this.cache[cacheKey] = processed;
		return processed;
	}

	/**
	 * List all custom prompt slugs from the custom-prompts directory
	 */
	public static async listCustomPrompts(): Promise<string[]> {
		if (!this.app) {
			return [];
		}

		const basePath = this.getPluginBasePath();
		if (!basePath) {
			return [];
		}

		const customDir = path.join(basePath, "custom-prompts");

		if (!(await this.app.vault.adapter.exists(customDir))) {
			return [];
		}

		try {
			const files = await this.app.vault.adapter.list(customDir);
			const slugs: string[] = [];

			for (const file of files.files) {
				if (file.endsWith(".md")) {
					const filename = file.split("/").pop() || file.split("\\").pop() || "";
					const slug = filename.replace(".md", "");
					slugs.push(slug);
				}
			}

			this.customPromptSlugs = slugs;
			return slugs;
		} catch (e) {
			console.error("Error listing custom prompts:", e);
			return [];
		}
	}

	/**
	 * Get custom prompt slugs synchronously from the cached registry
	 */
	public static getCustomPromptSlugs(): string[] {
		return [...this.customPromptSlugs];
	}

	/**
	 * Add a slug to the custom prompt registry
	 */
	public static addToCustomPromptRegistry(slug: string): void {
		if (!this.customPromptSlugs.includes(slug)) {
			this.customPromptSlugs.push(slug);
		}
	}

	/**
	 * Remove a slug from the custom prompt registry
	 */
	public static removeFromCustomPromptRegistry(slug: string): void {
		const idx = this.customPromptSlugs.indexOf(slug);
		if (idx !== -1) {
			this.customPromptSlugs.splice(idx, 1);
		}
	}

	/**
	 * Save a custom prompt to the custom-prompts directory
	 */
	public static async saveCustomPrompt(
		slug: string,
		content: string
	): Promise<void> {
		if (!this.app) {
			throw new Error(
				"PromptLoader not initialized. Call initialize() first."
			);
		}

		await this.ensureCustomPromptsDir();

		const basePath = this.getPluginBasePath();
		if (!basePath) {
			throw new Error("Could not determine plugin base path");
		}

		const filePath = path.join(basePath, "custom-prompts", `${slug}.md`);
		await this.app.vault.adapter.write(filePath, content);

		// Invalidate cache for this custom prompt
		const cacheKey = `custom:${slug}`;
		delete this.cache[cacheKey];
	}

	/**
	 * Delete a custom prompt from the custom-prompts directory
	 */
	public static async deleteCustomPrompt(slug: string): Promise<void> {
		if (!this.app) {
			throw new Error(
				"PromptLoader not initialized. Call initialize() first."
			);
		}

		const basePath = this.getPluginBasePath();
		if (!basePath) {
			throw new Error("Could not determine plugin base path");
		}

		const filePath = path.join(basePath, "custom-prompts", `${slug}.md`);

		if (await this.app.vault.adapter.exists(filePath)) {
			await this.app.vault.adapter.remove(filePath);
		}

		// Remove from caches
		const cacheKey = `custom:${slug}`;
		delete this.cache[cacheKey];
		this.removeFromCustomPromptRegistry(slug);
	}

	/**
	 * Ensure the custom-prompts directory exists
	 */
	public static async ensureCustomPromptsDir(): Promise<void> {
		if (!this.app) {
			throw new Error(
				"PromptLoader not initialized. Call initialize() first."
			);
		}

		const basePath = this.getPluginBasePath();
		if (!basePath) {
			throw new Error("Could not determine plugin base path");
		}

		const customDir = path.join(basePath, "custom-prompts");

		if (!(await this.app.vault.adapter.exists(customDir))) {
			await this.app.vault.adapter.mkdir(customDir);
		}
	}

	/**
	 * Slugify a display name into a filename-safe identifier
	 */
	public static slugify(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, "")
			.replace(/[\s_]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	/**
	 * Convert a slug to a display name (title case)
	 */
	public static slugToDisplayName(slug: string): string {
		return slug
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}

	/**
	 * Check if a slug conflicts with a built-in prompt ID
	 */
	public static isBuiltInId(slug: string): boolean {
		return Object.values(BUILTIN_PROMPT_IDS).includes(slug as any);
	}

	/**
	 * Process markdown content to extract usable prompt text
	 */
	private static processMarkdown(markdown: string): string {
		const lines = markdown.split("\n");

		// Remove title (first line starting with #)
		let startIndex = 0;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim().startsWith("#")) {
				startIndex = i + 1;
				break;
			}
		}

		return lines
			.slice(startIndex)
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	/**
	 * Clear the cache
	 */
	public static clearCache(): void {
		this.cache = {};
	}
}