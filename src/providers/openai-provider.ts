import "openai/shims/web";
import OpenAI from "openai";
import { APIError } from "openai";
import { AIExcerptProvider, LLMProvider } from "../types";
import { Prompts } from "../utils/prompts";
import { buildEnhancedSystemPrompt, ensureCompleteSentence } from "../utils/excerpt-utils";

export class OpenAIProvider implements AIExcerptProvider {
	readonly providerType = LLMProvider.OPENAI;
	private client: OpenAI;
	private model: string;
	private useChatAPI: boolean;
	private promptType: string;
	private lastUsage: { input: number; output: number } | null = null;

	constructor(
		apiKey: string,
		model: string,
		promptType = "excerpt-generation",
		useChatAPI = true
	) {
		this.client = new OpenAI({
			apiKey: apiKey,
			dangerouslyAllowBrowser: true,
			timeout: 60 * 1000,
			maxRetries: 2,
		});
		this.model = model;
		this.promptType = promptType;
		this.useChatAPI = useChatAPI;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		try {
			let excerptText = "";

			if (this.useChatAPI) {
				excerptText = await this._generateWithChatAPI(
					content,
					maxLength
				);
			} else {
				try {
					excerptText = await this._generateWithResponsesAPI(
						content,
						maxLength
					);
				} catch (error) {
					console.warn(
						"Falling back to Chat Completions API due to error:",
						error
					);
					excerptText = await this._generateWithChatAPI(
						content,
						maxLength
					);
				}
			}

			return excerptText;
		} catch (error) {
			if (error instanceof APIError) {
				console.error("OpenAI API Error:", {
					status: error.status,
					name: error.name,
					message: error.message,
					request_id: error.request_id,
				});
			} else {
				console.error("Error calling OpenAI API:", error);
			}

			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(`OpenAI API error: ${errorMessage}`);
		}
	}

	private async _generateWithResponsesAPI(
		content: string,
		maxLength: number
	): Promise<string> {
		const systemPrompt = await Prompts.getPrompt(this.promptType);

		const instructions = `${systemPrompt}
		
Your task is to create a concise excerpt that is under ${maxLength} characters, but you MUST end with a complete sentence or thought.

IMPORTANT RULES:
- End with a complete sentence - never end mid-sentence
- Avoid ellipses (...) or any truncation indicators
- No quotation marks around the output
- No special formatting
- If your response is approaching the limit, find a way to complete the thought naturally
- Track your character count to ensure you don't exceed the limit`;

		const response = await this.client.responses.create({
			model: this.model,
			instructions,
			input: content,
			temperature: 0.7,
		});

		let excerptText = response.output_text?.trim() || "";
		return ensureCompleteSentence(excerptText, maxLength);
	}

	private async _generateWithChatAPI(
		content: string,
		maxLength: number
	): Promise<string> {
		const systemPrompt = await Prompts.getPrompt(this.promptType);
		const systemMessage = buildEnhancedSystemPrompt(systemPrompt, maxLength);

		const userMessage = `Document:\n${content}`;

		const response = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{
					role: "system",
					content: systemMessage,
				},
				{
					role: "user",
					content: userMessage,
				},
			],
			max_tokens: 300,
			temperature: 0.3,
		});

		if (!response || response.choices.length === 0) {
			throw new Error("Empty response from OpenAI API");
		}

		let excerptText = response.choices[0]?.message?.content?.trim() || "";
		return ensureCompleteSentence(excerptText, maxLength);
	}
}