import { requestUrl } from "obsidian";
import { AIExcerptProvider } from "../types";
import { Prompts } from "../utils/prompts";

const OLLAMA_CLOUD_ENDPOINT = "https://ollama.com";

export class OllamaCloudProvider implements AIExcerptProvider {
	private model: string;
	private promptType: string;
	private apiKey: string;

	constructor(
		model: string,
		promptType = "excerpt-generation",
		apiKey = ""
	) {
		this.model = model;
		this.promptType = promptType;
		this.apiKey = apiKey;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		const timeoutMs = parseInt(
			localStorage.getItem("ai-excerpt-ollama-timeout") || "300000",
			10
		);

		const systemPrompt = await Prompts.getPrompt(this.promptType);
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

		const requestBody = JSON.stringify({
			model: this.model,
			messages: [
				{ role: "system", content: enhancedSystemPrompt },
				{ role: "user", content },
			],
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
					url: `${OLLAMA_CLOUD_ENDPOINT}/api/chat`,
					method: "POST",
					headers,
					body: requestBody,
					throw: false,
				}),
				timeoutPromise,
			]);

			if (timer) clearTimeout(timer);

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
			if (response.status === 404) {
				const data = response.json;
				if (data.error?.includes("not found")) {
					throw new Error(
						`Model '${this.model}' not found. Check that the model name is correct.`
					);
				}
				throw new Error(
					`Ollama Cloud error (404): ${data.error || "Unknown error"}`
				);
			}
			if (response.status === 502) {
				const data = response.json;
				throw new Error(
					"Ollama Cloud is unreachable. Run 'ollama signin' or check your network connectivity. [502: " +
						(data.error || "TLS timeout") +
						"]"
				);
			}
			if (response.status === 503) {
				throw new Error(
					"Ollama Cloud server is busy. Please try again shortly."
				);
			}
			if (response.status >= 400) {
				const data = response.json;
				throw new Error(
					`Ollama Cloud error (${response.status}): ${data.error || "Unknown error"}`
				);
			}

			const data = response.json;
			const excerptText = (data.message?.content || "").trim();

			if (!excerptText) {
				throw new Error(
					"Ollama Cloud returned an empty response. The model may not support this prompt format. Try a different model."
				);
			}

			return this._ensureCompleteSentence(excerptText, maxLength);
		} catch (error) {
			if (timer) clearTimeout(timer);

			if (error instanceof Error && error.message === "TIMEOUT") {
				throw new Error(
					"Ollama Cloud request timed out. Please try again."
				);
			}

			if (error instanceof Error) {
				throw error;
			}

			throw new Error(`Ollama Cloud error: ${String(error)}`);
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
}