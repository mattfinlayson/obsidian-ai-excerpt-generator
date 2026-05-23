import { AIExcerptProvider, PromptType } from "../types";
import { Prompts } from "../utils/prompts";

export class OllamaProvider implements AIExcerptProvider {
	private endpoint: string;
	private model: string;
	private promptType: PromptType;
	private apiKey: string;

	constructor(
		endpoint: string,
		model: string,
		promptType = PromptType.DEFAULT,
		apiKey = ""
	) {
		this.endpoint = endpoint;
		this.model = model;
		this.promptType = promptType;
		this.apiKey = apiKey;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60000);

		try {
			const systemPrompt = this._getPromptForType();

			const enhancedSystemPrompt = `${systemPrompt}

Generate a concise excerpt (maximum ${maxLength} characters) that captures the essence of this document.

IMPORTANT RULES:
- Your entire response must be under ${maxLength} characters
- Always end with a complete sentence - NEVER end mid-sentence or with a truncated word
- Do not use ellipses (...) in your response
- Match the author's writing style and voice
- If approaching the character limit, find a natural ending point for a complete thought
- Count your characters carefully to ensure you don't exceed the limit`;

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const trimmedKey = this.apiKey.trim();
			if (trimmedKey) {
				headers["Authorization"] = `Bearer ${trimmedKey}`;
			}

			const response = await fetch(
				`${this.endpoint}/api/generate`,
				{
					method: "POST",
					headers,
					signal: controller.signal,
					body: JSON.stringify({
						model: this.model,
						prompt: `Document:\n${content}`,
						system: enhancedSystemPrompt,
						stream: false,
						options: {
							temperature: 0.3,
							num_predict: 150,
						},
					}),
				}
			);

			clearTimeout(timeoutId);

			const data = await response.json();

			if (!response.ok || data.error) {
				if (response.status === 401) {
					throw new Error(
						"Invalid Ollama API key. Check your API key in the plugin settings."
					);
				}
				if (response.status === 403) {
					throw new Error(
						"Ollama access denied. Your plan may not support this model or you may have hit usage limits."
					);
				}
				if (
					response.status === 404 &&
					data.error?.includes("not found")
				) {
					throw new Error(
						`Model '${this.model}' not found. Run 'ollama pull ${this.model}' to download it.`
					);
				}
				if (response.status === 503) {
					throw new Error(
						"Ollama server is busy. Please try again shortly."
					);
				}
				throw new Error(
					`Ollama error (${response.status}): ${data.error || "Unknown error"}`
				);
			}

			const excerptText = (data.response || "").trim();
			return this._ensureCompleteSentence(excerptText, maxLength);
		} catch (error) {
			clearTimeout(timeoutId);

			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(
					"Ollama request timed out. The model may be too slow or too large for your hardware."
				);
			}

			if (error instanceof TypeError) {
				throw new Error(
					`Cannot connect to Ollama. Make sure Ollama is running at ${this.endpoint}.`
				);
			}

			if (error instanceof Error) {
				throw error;
			}

			throw new Error(`Ollama error: ${String(error)}`);
		}
	}

	private _ensureCompleteSentence(
		text: string,
		maxLength: number
	): string {
		if (text.length <= maxLength) {
			return text;
		}

		const sentenceEndRegex = /[.!?]\s*(?=[A-Z]|$)/g;
		let lastMatchIndex = -1;

		try {
			const matches = [...text.matchAll(sentenceEndRegex)];

			for (const match of matches) {
				if (match.index !== undefined) {
					const position = match.index + match[0].length;
					if (position <= maxLength) {
						lastMatchIndex = position;
					} else {
						break;
					}
				}
			}
		} catch (error) {
			console.warn("Error matching sentence boundaries:", error);
		}

		if (lastMatchIndex > 0) {
			return text.substring(0, lastMatchIndex).trim();
		}

		const lastPeriodIndex = text.lastIndexOf(".", maxLength - 1);
		const lastQuestionIndex = text.lastIndexOf("?", maxLength - 1);
		const lastExclamationIndex = text.lastIndexOf("!", maxLength - 1);

		const endIndex = Math.max(
			lastPeriodIndex > 0 ? lastPeriodIndex : 0,
			lastQuestionIndex > 0 ? lastQuestionIndex : 0,
			lastExclamationIndex > 0 ? lastExclamationIndex : 0
		);

		if (endIndex > 0) {
			return text.substring(0, endIndex + 1).trim();
		}

		if (text.length > maxLength) {
			const lastSpaceIndex = text.lastIndexOf(" ", maxLength - 1);
			if (lastSpaceIndex > maxLength * 0.75) {
				return text.substring(0, lastSpaceIndex).trim() + ".";
			}
		}

		return text.substring(0, maxLength - 1).trim() + ".";
	}

	private _getPromptForType(): string {
		switch (this.promptType) {
			case PromptType.ACADEMIC:
				return Prompts.academicSummary;
			case PromptType.PROFESSIONAL:
				return Prompts.professionalSummary;
			case PromptType.BLOG:
				return Prompts.blogSummary;
			case PromptType.SIMPLIFIED:
				return Prompts.simplifiedSummary;
			case PromptType.SOCIAL:
				return Prompts.socialSummary;
			case PromptType.DEFAULT:
			default:
				return Prompts.excerptGeneration;
		}
	}
}
