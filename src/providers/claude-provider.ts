import "@anthropic-ai/sdk/shims/web";
import Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
import { AIExcerptProvider, LLMProvider } from "../types";
import { Prompts } from "../utils/prompts";
import { buildEnhancedSystemPrompt, ensureCompleteSentence } from "../utils/excerpt-utils";

export class ClaudeProvider implements AIExcerptProvider {
	readonly providerType = LLMProvider.CLAUDE;
	private client: Anthropic;
	private model: string;
	private useStreaming: boolean;
	private promptType: string;
	private lastUsage: { input: number; output: number } | null = null;
	private retryCount: number = 0;
	private maxRetries: number = 5;
	private lastRequestTime: number = 0;
	private minRequestInterval: number = 500;

	constructor(
		apiKey: string,
		model: string,
		useStreaming = false,
		promptType = "excerpt-generation"
	) {
		this.client = new Anthropic({
			apiKey: apiKey,
			timeout: 60 * 1000,
			maxRetries: 3,
			dangerouslyAllowBrowser: true,
		});
		this.model = model;
		this.useStreaming = useStreaming;
		this.promptType = promptType;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		try {
			const shouldUseStreaming =
				this.useStreaming && content.length > 10000;

			let excerptText = "";

			if (shouldUseStreaming) {
				excerptText = await this._generateWithStreaming(
					content,
					maxLength
				);
			} else {
				excerptText = await this._generateWithStandardAPI(
					content,
					maxLength
				);
			}

			this.retryCount = 0;
			return excerptText;
		} catch (error) {
			if (error instanceof APIError) {
				console.error("Anthropic API Error:", {
					status: error.status,
					name: error.name,
					message: error.message,
					request_id: error.request_id,
				});

				if (error.status === 429) {
					if (this.retryCount < this.maxRetries) {
						this.retryCount++;

						const retryAfter =
							typeof error.headers === "object" &&
							error.headers &&
							"retry-after" in error.headers
								? parseInt(
										error.headers["retry-after"] as string,
										10
								  ) * 1000
								: null;

						const delayMs =
							retryAfter ||
							Math.min(
								Math.pow(2, this.retryCount) * 1000 +
									Math.random() * 1000,
								30000
							);

						console.log(
							`Rate limited. Retrying in ${delayMs}ms (attempt ${this.retryCount}/${this.maxRetries})...`
						);

						await new Promise((resolve) =>
							setTimeout(resolve, delayMs)
						);

						return this.generateExcerpt(content, maxLength);
					} else {
						throw new Error(
							"Claude API rate limit exceeded. Maximum retries reached. Please try again in a few minutes."
						);
					}
				} else if (error.status === 529) {
					throw new Error(
						"Claude API is currently overloaded. Please try again in a few minutes."
					);
				} else if (error.status === 401) {
					throw new Error(
						"Invalid Claude API key. Please check your API key in the plugin settings."
					);
				} else if (error.status === 400) {
					throw new Error(
						"Invalid request to Claude API. The content may be too large or contain unsupported content."
					);
				} else if (error.status >= 500) {
					throw new Error(
						"Claude API server error. Please try again later or check Anthropic status page."
					);
				}
			} else {
				console.error("Error calling Anthropic API:", error);
			}

			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(`Claude API error: ${errorMessage}`);
		}
	}

	private async _enforceRateLimit(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;

		if (timeSinceLastRequest < this.minRequestInterval) {
			const waitTime = this.minRequestInterval - timeSinceLastRequest;
			await new Promise((resolve) => setTimeout(resolve, waitTime));
		}

		this.lastRequestTime = Date.now();
	}

	private async _generateWithStandardAPI(
		content: string,
		maxLength: number
	): Promise<string> {
		await this._enforceRateLimit();

		const systemPrompt = await Prompts.getPrompt(this.promptType);
		const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt, maxLength);

		const { data: response } = await this.client.messages
			.create({
				model: this.model,
				max_tokens: 300,
				messages: [
					{
						role: "user",
						content: `Document:\n${content}`,
					},
				],
				system: enhancedSystemPrompt,
			})
			.withResponse();

		if (response.usage) {
			this.lastUsage = {
				input: response.usage.input_tokens,
				output: response.usage.output_tokens,
			};
		}

		if (response.content && response.content.length > 0) {
			const contentBlock = response.content[0];
			if ("text" in contentBlock) {
				const excerptText = contentBlock.text.trim();
				return ensureCompleteSentence(excerptText, maxLength);
			}
		}

		throw new Error("Unexpected response format from Claude API");
	}

	private async _generateWithStreaming(
		content: string,
		maxLength: number
	): Promise<string> {
		await this._enforceRateLimit();

		const systemPrompt = await Prompts.getPrompt(this.promptType);
		const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt, maxLength);

		const stream = await this.client.messages.stream({
			model: this.model,
			max_tokens: 300,
			messages: [
				{
					role: "user",
					content: `Document:\n${content}`,
				},
			],
			system: enhancedSystemPrompt,
		});

		const message = await stream.finalMessage();

		if (message.usage) {
			this.lastUsage = {
				input: message.usage.input_tokens,
				output: message.usage.output_tokens,
			};
		}

		if (message.content && message.content.length > 0) {
			const contentBlock = message.content[0];
			if ("text" in contentBlock) {
				const excerptText = contentBlock.text.trim();
				return ensureCompleteSentence(excerptText, maxLength);
			}
		}

		throw new Error("Unexpected response format from Claude streaming API");
	}

	getTokenUsage(): { input: number; output: number } | null {
		return this.lastUsage;
	}
}