import { requestUrl } from "obsidian";
import { AIExcerptProvider, PromptType } from "../types";
import { Prompts } from "../utils/prompts";

export class OllamaLocalProvider implements AIExcerptProvider {
	private endpoint: string;
	private model: string;
	private promptType: PromptType;

	constructor(
		endpoint: string,
		model: string,
		promptType = PromptType.DEFAULT
	) {
		this.endpoint = endpoint;
		this.model = model;
		this.promptType = promptType;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		const timeoutMs = parseInt(
			localStorage.getItem("ai-excerpt-ollama-timeout") || "300000",
			10
		);

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

		const requestBody = JSON.stringify({
			model: this.model,
			prompt: `Document:\n${content}`,
			system: enhancedSystemPrompt,
			stream: false,
			options: {
				temperature: 0.3,
				num_predict: 150,
			},
		});

		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error("TIMEOUT"));
			}, timeoutMs);
		});

		try {
			const response = await Promise.race([
				requestUrl({
					url: `${this.endpoint}/api/generate`,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: requestBody,
					throw: false,
				}),
				timeoutPromise,
			]);

			if (timer) clearTimeout(timer);

			if (response.status === 404) {
				const data = response.json;
				if (data.error?.includes("not found")) {
					throw new Error(
						`Model '${this.model}' not found. Run 'ollama pull ${this.model}' to download it.`
					);
				}
				throw new Error(
					`Ollama error (404): ${data.error || "Unknown error"}`
				);
			}
			if (response.status === 503) {
				throw new Error(
					"Ollama server is busy. Please try again shortly."
				);
			}
			if (response.status >= 400) {
				const data = response.json;
				throw new Error(
					`Ollama error (${response.status}): ${data.error || "Unknown error"}`
				);
			}

			const data = response.json;
			const excerptText = (data.response || "").trim();

			if (!excerptText) {
				throw new Error(
					"Ollama returned an empty response. The model may not support this prompt format. Try a different model or check the endpoint."
				);
			}

			return this._ensureCompleteSentence(excerptText, maxLength);
		} catch (error) {
			if (timer) clearTimeout(timer);

			if (error instanceof Error && error.message === "TIMEOUT") {
				throw new Error(
					"Ollama request timed out. The model may be too slow or too large for your hardware."
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