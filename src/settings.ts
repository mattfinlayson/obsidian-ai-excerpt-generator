import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	AIExcerptPlugin,
	AIExcerptSettings,
	CLAUDE_MODELS,
	LLMProvider,
	OPENAI_MODELS,
	BUILTIN_PROMPT_IDS,
} from "./types";
import { PromptLoader } from "./utils/prompt-loader";
import { Prompts } from "./utils/prompts";
import { PromptEditorModal } from "./modals/prompt-editor-modal";

export const DEFAULT_SETTINGS: AIExcerptSettings = {
	provider: LLMProvider.CLAUDE,
	promptType: BUILTIN_PROMPT_IDS.DEFAULT,
	claudeApiKey: "",
	claudeModel: "claude-3-7-sonnet-20250219",
	openaiApiKey: "",
	openaiModel: "gpt-4o",
	ollamaLocalEndpoint: "http://localhost:11434",
	ollamaLocalModel: "",
	ollamaCloudApiKey: "",
	ollamaCloudModel: "",
	maxLength: 140,
};

// Base examples for different prompt types (will be adapted based on length)
export const PROMPT_EXAMPLES: Record<string, { short: string; medium: string; long: string }> = {
	[BUILTIN_PROMPT_IDS.DEFAULT]: {
		short: "This concise summary captures the essence while maintaining the author's unique voice and idiomatic expressions.",
		medium: "This concise summary preserves the original author's distinctive voice and writing style. It captures key points while maintaining the same tone, word choice, and sentence structures found in the source material.",
		long: "This comprehensive summary perfectly mirrors the original author's distinctive voice and writing style. It captures all key points while maintaining the same tone, pacing, idiomatic expressions, and sentence structures found in the source material. Every sentence feels authentic to the author's writing - never generic or AI-generated.",
	},
	[BUILTIN_PROMPT_IDS.ACADEMIC]: {
		short: "The research reveals significant correlations between variables, suggesting important theoretical implications for understanding causal mechanisms.",
		medium: "The research demonstrates statistically significant correlations between variables X and Y (p<.001), suggesting theoretical implications for our understanding of underlying mechanisms as proposed in recent literature.",
		long: "The research methodology reveals statistically significant correlations between variables X and Y (p<.001), suggesting important theoretical implications for our understanding of causal mechanisms. These findings align with hypotheses proposed in recent literature while extending the conceptual framework through novel analytical approaches and methodological innovations.",
	},
	[BUILTIN_PROMPT_IDS.PROFESSIONAL]: {
		short: "Analysis shows 24% revenue growth, driven by APAC expansion and improved enterprise retention rates.",
		medium: "Our analysis indicates a 24% increase in quarterly revenue, driven primarily by expansion in the APAC region and improved customer retention rates across enterprise accounts.",
		long: "Our comprehensive analysis indicates a 24% increase in quarterly revenue, driven primarily by strategic expansion in the APAC region and significantly improved customer retention rates across enterprise accounts. These results exceed projections by 7 percentage points and position us favorably for continued growth in the next fiscal period.",
	},
	[BUILTIN_PROMPT_IDS.BLOG]: {
		short: "I've been exploring this fascinating concept and I'm excited to share my discoveries!",
		medium: "I've been exploring this fascinating concept for weeks now, and I'm excited to share what I've discovered. It's completely changed how I think about this topic!",
		long: "I've been absolutely obsessed with exploring this fascinating concept for the past few weeks, and I'm super excited to finally share what I've discovered with all of you! It's completely changed how I think about this topic, and I'm betting it might just revolutionize your perspective too!",
	},
	[BUILTIN_PROMPT_IDS.SIMPLIFIED]: {
		short: "This idea shows how things connect in new ways, helping us understand how everything works together.",
		medium: "This idea is about how things connect in ways we didn't see before. When we look at the patterns, we can better understand how everything works together.",
		long: "This idea is about how different things connect in ways we didn't notice before. When we take time to look at the patterns more carefully, we can better understand how everything works together. This helps us solve problems by seeing the whole picture instead of just separate parts.",
	},
	[BUILTIN_PROMPT_IDS.SOCIAL]: {
		short: "Major breakthrough on this project! This changes everything about our approach.",
		medium: "Just had a major breakthrough on this project! Can't believe it took me so long to see the connection. This changes everything about how we approach the problem.",
		long: "Just had the BIGGEST breakthrough on this project! 🤯 Can't believe it took me so long to see the connection that was right in front of me the whole time. This completely changes everything about how we've been approaching the problem. So excited to share more details soon!",
	},
};

function getExampleForLength(type: string, length: number): string | null {
	const examples = PROMPT_EXAMPLES[type];
	if (!examples) return null;
	if (length <= 100) {
		return examples.short;
	} else if (length <= 200) {
		return examples.medium;
	} else {
		return examples.long;
	}
}

export class AIExcerptSettingTab extends PluginSettingTab {
	plugin: AIExcerptPlugin;

	constructor(app: App, plugin: Plugin & AIExcerptPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "AI Excerpt Generator Settings" });

		// LLM Provider Selection
		new Setting(containerEl)
			.setName("AI Provider")
			.setDesc("Select which AI provider to use for generating excerpts")
			.addDropdown((dropdown) => {
				dropdown
					.addOption(LLMProvider.CLAUDE, "Claude (Anthropic)")
					.addOption(LLMProvider.OPENAI, "OpenAI")
					.addOption(LLMProvider.OLLAMA_LOCAL, "Ollama (Local)")
					.addOption(LLMProvider.OLLAMA_CLOUD, "Ollama (Cloud)")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value: string) => {
						this.plugin.settings.provider = value as LLMProvider;
						await this.plugin.saveSettings();
						// Reload the settings UI to show/hide provider-specific settings
						this.display();
					});
			});

		// Claude Settings - Only show if Claude is selected
		if (this.plugin.settings.provider === LLMProvider.CLAUDE) {
			new Setting(containerEl)
				.setName("Claude API Key")
				.setDesc("Your Anthropic API key for Claude")
				.addText((text) => {
					text
						.setPlaceholder("Enter your API key")
						.setValue(this.plugin.settings.claudeApiKey)
						.onChange(async (value) => {
							this.plugin.settings.claudeApiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});

			new Setting(containerEl)
				.setName("Claude Model")
				.setDesc(
					"Select which Claude model to use. Claude 3.7 Sonnet offers the best balance of quality and speed. Claude 3.5 Haiku is faster but simpler. Claude 3 Opus is highest quality but slower."
				)
				.addDropdown((dropdown) => {
					CLAUDE_MODELS.forEach((model) => {
						dropdown.addOption(model, model);
					});
					dropdown
						.setValue(this.plugin.settings.claudeModel)
						.onChange(async (value) => {
							this.plugin.settings.claudeModel = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// OpenAI Settings - Only show if OpenAI is selected
		if (this.plugin.settings.provider === LLMProvider.OPENAI) {
			new Setting(containerEl)
				.setName("OpenAI API Key")
				.setDesc("Your OpenAI API key")
				.addText((text) => {
					text
						.setPlaceholder("Enter your API key")
						.setValue(this.plugin.settings.openaiApiKey)
						.onChange(async (value) => {
							this.plugin.settings.openaiApiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});

			new Setting(containerEl)
				.setName("OpenAI Model")
				.setDesc(
					"Select which OpenAI model to use. GPT-4o offers excellent quality and speed. The 'o' series models are specialized for reasoning tasks. GPT-4.5 offers the highest quality but may be slower."
				)
				.addDropdown((dropdown) => {
					OPENAI_MODELS.forEach((model) => {
						dropdown.addOption(model, model);
					});
					dropdown
						.setValue(this.plugin.settings.openaiModel)
						.onChange(async (value) => {
							this.plugin.settings.openaiModel = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// Ollama Settings - Only show if Ollama is selected
		if (this.plugin.settings.provider === LLMProvider.OLLAMA_LOCAL) {
			new Setting(containerEl)
				.setName("Ollama Local Endpoint")
				.setDesc(
					"Base URL for the local Ollama service. Defaults to http://localhost:11434. Change this for Docker/LAN setups."
				)
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(this.plugin.settings.ollamaLocalEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.ollamaLocalEndpoint = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Ollama Local Model")
				.setDesc(
					"Enter the model name (e.g. 'llama3.2', 'mistral:latest'). Install via 'ollama pull <model>' first."
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g. llama3.2")
						.setValue(this.plugin.settings.ollamaLocalModel)
						.onChange(async (value) => {
							this.plugin.settings.ollamaLocalModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		if (this.plugin.settings.provider === LLMProvider.OLLAMA_CLOUD) {
			new Setting(containerEl)
				.setName("Ollama Cloud API Key")
				.setDesc(
					"Your API key for Ollama Cloud (https://ollama.com). Required for cloud access."
				)
				.addText((text) => {
					text
						.setPlaceholder("Enter your API key")
						.setValue(this.plugin.settings.ollamaCloudApiKey)
						.onChange(async (value) => {
							this.plugin.settings.ollamaCloudApiKey = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});

			new Setting(containerEl)
				.setName("Ollama Cloud Model")
				.setDesc(
					"Enter the model name (e.g. 'gemma3:4b'). Omit the -cloud suffix (use 'gemma3:4b' not 'gemma3:4b-cloud')."
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g. gemma3:4b")
						.setValue(this.plugin.settings.ollamaCloudModel)
						.onChange(async (value) => {
							this.plugin.settings.ollamaCloudModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// Max Length Slider (moved before prompt type)
		let currentMaxLength = this.plugin.settings.maxLength;
		const lengthSetting = new Setting(containerEl)
			.setName("Max Excerpt Length")
			.setDesc("Maximum number of characters for generated excerpts")
			.addSlider((slider) =>
				slider
					.setLimits(50, 300, 10)
					.setValue(currentMaxLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						currentMaxLength = value;
						this.plugin.settings.maxLength = value;

						// Update example text if it exists and the current prompt has examples
						const exampleText = containerEl.querySelector(
							".prompt-example-text"
						);
						if (exampleText) {
							const example = getExampleForLength(
								this.plugin.settings.promptType,
								value
							);
							exampleText.textContent = example || "";
						}

						await this.plugin.saveSettings();
					})
			);

		// Prompt Type Selection with Examples
		const customSlugs = Prompts.getCustomPromptSlugs();
		const currentPromptType = this.plugin.settings.promptType;
		const isBuiltin = Object.values(BUILTIN_PROMPT_IDS).includes(
			currentPromptType as typeof BUILTIN_PROMPT_IDS[keyof typeof BUILTIN_PROMPT_IDS]
		);

		new Setting(containerEl)
			.setName("Prompt Type")
			.setDesc("Select the style of excerpt to generate")
			.addDropdown((dropdown) => {
				// Add built-in options
				dropdown
					.addOption(BUILTIN_PROMPT_IDS.DEFAULT, "Default")
					.addOption(BUILTIN_PROMPT_IDS.ACADEMIC, "Academic")
					.addOption(BUILTIN_PROMPT_IDS.PROFESSIONAL, "Professional")
					.addOption(BUILTIN_PROMPT_IDS.BLOG, "Blog")
					.addOption(BUILTIN_PROMPT_IDS.SIMPLIFIED, "Simplified")
					.addOption(BUILTIN_PROMPT_IDS.SOCIAL, "Social Media");

				// Add separator and custom options if any exist
				if (customSlugs.length > 0) {
					dropdown.addOption("---custom---", "─── Custom Prompts ───");
				}

				for (const slug of customSlugs) {
					dropdown.addOption(slug, PromptLoader.slugToDisplayName(slug));
				}

				// Handle orphaned promptType — if not in any option list
				if (!isBuiltin && !customSlugs.includes(currentPromptType)) {
					dropdown.addOption(
						currentPromptType,
						"⚠ Missing custom prompt — select another"
					);
					new Notice(
						`The custom prompt "${currentPromptType}" is no longer available. Please select a different prompt type.`
					);
				}

				dropdown.setValue(currentPromptType);
				dropdown.onChange(async (value: string) => {
					if (value === "---custom---") return;

					this.plugin.settings.promptType = value;

					// Re-render to show/hide example section and custom prompt CRUD
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// Example Output Section — only for built-in prompts
		if (isBuiltin) {
			const exampleResult = getExampleForLength(
				currentPromptType,
				currentMaxLength
			);

			if (exampleResult) {
				const exampleContainer = containerEl.createDiv(
					"prompt-example-container"
				);
				exampleContainer.createEl("h4", { text: "Example Output" });

				exampleContainer.createEl("div", {
					cls: "prompt-example-text",
					text: exampleResult,
				});
			}
		}

		// Custom Prompts Section
		containerEl.createEl("h3", { text: "Custom Prompts" });

		if (customSlugs.length === 0) {
			containerEl.createEl("p", {
				text: "No custom prompts. Click \"Add Custom Prompt\" to create one.",
				cls: "setting-item-description",
			});
		} else {
			for (const slug of customSlugs) {
				const displayName = PromptLoader.slugToDisplayName(slug);
				const isActive = this.plugin.settings.promptType === slug;

				new Setting(containerEl)
					.setName(displayName)
					.setDesc(isActive ? "Currently active" : `Slug: ${slug}`)
					.addButton((button) =>
						button
							.setButtonText("Edit")
							.onClick(() => {
								const modal = new PromptEditorModal(
									this.app,
									this.plugin as Plugin & AIExcerptPlugin,
									slug,
									() => this.display()
								);
								modal.open();
							})
					)
					.addButton((button) =>
						button
							.setButtonText("Delete")
							.setWarning()
							.onClick(() => {
								const message = isActive
									? `This prompt is currently in use. Delete "${displayName}" and switch to Default prompt?`
									: `Delete custom prompt "${displayName}"? This cannot be undone.`;

							if (window.confirm(message)) {
								PromptLoader.deleteCustomPrompt(slug)
									.then(() => {
										PromptLoader.removeFromCustomPromptRegistry(slug);
										Prompts.invalidateCustomPrompt(slug);
										if (isActive) {
											this.plugin.settings.promptType =
												BUILTIN_PROMPT_IDS.DEFAULT;
										}
										this.plugin.saveSettings().then(() => {
											this.display();
											new Notice(`Deleted custom prompt "${displayName}"`);
										});
									})
										.catch((e) => {
											new Notice(`Failed to delete prompt: ${e.message}`);
										});
								}
							})
					);
			}
		}

		new Setting(containerEl)
			.setName("Add Custom Prompt")
			.setDesc("Create a new custom prompt template")
			.addButton((button) =>
				button
					.setButtonText("Add Custom Prompt")
					.setCta()
					.onClick(() => {
						const modal = new PromptEditorModal(
							this.app,
							this.plugin as Plugin & AIExcerptPlugin,
							null,
							() => this.display()
						);
						modal.open();
					})
			);
	}
}
