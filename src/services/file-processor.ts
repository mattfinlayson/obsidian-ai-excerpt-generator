import {
	App,
	FileManager,
	Notice,
	TFile,
	TFolder,
	Vault,
	normalizePath,
} from "obsidian";
import { AIExcerptPlugin, AIExcerptSettings, AIExcerptProvider, LLMProvider } from "../types";
import { ProviderFactory } from "../providers/provider-factory";
import { FileUtils } from "../utils/file-utils";

export class FileProcessor {
	private vault: Vault;
	private fileManager: FileManager;
	private settings: AIExcerptSettings;
	private plugin: AIExcerptPlugin | null = null;

	constructor(
		vault: Vault,
		fileManager: FileManager,
		settings: AIExcerptSettings,
		plugin?: AIExcerptPlugin
	) {
		this.vault = vault;
		this.fileManager = fileManager;
		this.settings = settings;
		this.plugin = plugin || null;
	}

	private _getProviderName(provider: LLMProvider): string {
		switch (provider) {
			case LLMProvider.CLAUDE:
				return "Claude";
			case LLMProvider.OPENAI:
				return "OpenAI";
			case LLMProvider.OLLAMA_LOCAL:
				return "Ollama (Local)";
			case LLMProvider.OLLAMA_CLOUD:
				return "Ollama (Cloud)";
			default:
				return provider;
		}
	}

	private async _tryWithFallback(
		provider: AIExcerptProvider,
		content: string,
		showNotices: boolean
	): Promise<string> {
		try {
			const excerptText = await provider.generateExcerpt(
				content,
				this.settings.maxLength
			);
			ProviderFactory.releaseProvider(provider);
			return excerptText;
		} catch (providerError) {
			ProviderFactory.reportProviderFailure(this.settings.provider);

			if (this.settings.provider === LLMProvider.OLLAMA_LOCAL || this.settings.provider === LLMProvider.OLLAMA_CLOUD) {
				throw providerError;
			}

			const fallbackResult = ProviderFactory.createFallbackProvider(
				this.settings,
				this.settings.provider
			);

			if (fallbackResult.provider) {
				const fallbackName =
					fallbackResult.fallbackType === LLMProvider.OPENAI
						? "OpenAI"
						: "Claude";

				if (showNotices) {
					const primaryName = this._getProviderName(
						this.settings.provider
					);
					new Notice(
						`${primaryName} API failed. Trying ${fallbackName} as fallback...`
					);
				}

				try {
					const excerptText =
						await fallbackResult.provider.generateExcerpt(
							content,
							this.settings.maxLength
						);

					ProviderFactory.releaseProvider(fallbackResult.provider);
					return excerptText;
				} catch (fallbackError) {
					if (fallbackResult.fallbackType) {
						ProviderFactory.reportProviderFailure(
							fallbackResult.fallbackType
						);
					}
					throw fallbackError;
				}
			} else if (fallbackResult.needsConfiguration) {
				const primaryName = this._getProviderName(
					this.settings.provider
				);
				const missingProvider =
					fallbackResult.fallbackType === LLMProvider.OPENAI
						? "OpenAI"
						: "Claude";

				if (showNotices) {
					new Notice(
						`${primaryName} API is currently unavailable, and ${missingProvider} API key is not configured for fallback. Please add your ${missingProvider} API key in settings to enable automatic fallback.`,
						10000
					);
				}

				throw providerError;
			} else {
				throw providerError;
			}
		}
	}

	async processFile(file: TFile, showNotices: boolean = true): Promise<void> {
		if (!file.extension || file.extension !== "md") {
			if (showNotices) new Notice("Not a markdown file");
			return;
		}

		const provider = ProviderFactory.createProvider(this.settings);
		if (!provider) {
			const errorMessage = `AI provider not properly configured. Please check settings.`;
			if (showNotices) new Notice(errorMessage);
			console.error(errorMessage);
			return;
		}

		try {
			const content = await this.vault.read(file);
			const { hasFrontmatter, frontmatter } =
				FileUtils.extractFrontmatter(content);

			if (!hasFrontmatter) {
				const excerptText = await this._tryWithFallback(
					provider,
					content,
					showNotices
				);

				await this.vault.process(file, (data) => {
					return FileUtils.createContentWithExcerpt(
						content,
						excerptText
					);
				});

				if (showNotices)
					new Notice(
						`Added frontmatter with generated excerpt to ${file.name}`
					);
			} else {
				const contentWithoutFrontmatter =
					FileUtils.removeFrontmatter(content);
				const { hasExcerpt } = FileUtils.extractExcerptFromFrontmatter(
					frontmatter!
				);

				const excerptText = await this._tryWithFallback(
					provider,
					contentWithoutFrontmatter,
					showNotices
				);

				await this.fileManager.processFrontMatter(
					file,
					(frontmatter) => {
						frontmatter["excerpt"] = excerptText;
					}
				);

				if (showNotices) {
					if (hasExcerpt) {
						new Notice(
							`Updated excerpt in frontmatter for ${file.name}`
						);
					} else {
						new Notice(
							`Added excerpt field to frontmatter in ${file.name}`
						);
					}
				}
			}
		} catch (error) {
			if (showNotices)
				new Notice(
					`Error processing file ${file.name}: ${
						error instanceof Error ? error.message : "Unknown error"
					}`
				);
			console.error("Error processing file:", file.name, error);
		}
	}

	private async _processBatch(
		files: TFile[],
		description: string,
		showProgress: boolean
	): Promise<void> {
		if (files.length === 0) {
			new Notice(`No markdown files found${description ? ` in ${description}` : ""}`);
			if (this.plugin) {
				this.plugin.updateStatusBar(0, 0);
			}
			return;
		}

		if (description) {
			new Notice(
				`Processing ${files.length} files in ${description}...`
			);
		} else {
			new Notice(`Processing ${files.length} files...`);
		}

		if (this.plugin) {
			this.plugin.updateStatusBar(0, files.length);
		}

		let processed = 0;
		let errors = 0;
		const batchSize = 5;

		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);

			for (const file of batch) {
				try {
					await this.processFile(file, false);
					processed++;

					if (this.plugin) {
						this.plugin.updateStatusBar(processed, files.length);
					}

					if (processed % 5 === 0 || processed === files.length) {
						const suffix = description
							? ` in ${description} and subfolders`
							: "";
						new Notice(
							`Processed ${processed}/${files.length} files${suffix}`
						);
					}
				} catch (error) {
					console.error(`Error processing ${file.path}:`, error);
					errors++;
				}
			}

			if (i + batchSize < files.length) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		}

		const suffix = description
			? ` in ${description} and subfolders`
			: "";
		new Notice(
			`Completed. Processed ${processed}/${files.length} files${suffix}.` +
				(errors > 0 ? ` Errors: ${errors}` : "")
		);

		setTimeout(() => {
			if (this.plugin) {
				this.plugin.updateStatusBar(0, 0);
			}
		}, 5000);
	}

	async processDirectory(folder: TFolder): Promise<void> {
		const collectMarkdownFiles = (folder: TFolder): TFile[] => {
			let markdownFiles: TFile[] = [];

			folder.children.forEach((child) => {
				if (child instanceof TFile && child.extension === "md") {
					markdownFiles.push(child);
				} else if (child instanceof TFolder) {
					markdownFiles = markdownFiles.concat(
						collectMarkdownFiles(child)
					);
				}
			});

			return markdownFiles;
		};

		const files = collectMarkdownFiles(folder);
		await this._processBatch(files, folder.path, true);
	}

	async processAllFiles(): Promise<void> {
		const files = this.vault.getMarkdownFiles();
		await this._processBatch(files, "", true);
	}
}