import { requestUrl } from "obsidian";
import { AIExcerptProvider, LLMProvider } from "../types";
import { Prompts } from "../utils/prompts";
import { buildEnhancedSystemPrompt, ensureCompleteSentence } from "../utils/excerpt-utils";

function getOllamaTimeout(): number {
	const raw = parseInt(
		localStorage.getItem("ai-excerpt-ollama-timeout") || "300000",
		10
	);
	return Math.min(Math.max(raw || 300000, 1000), 600000);
}

export class OllamaLocalProvider implements AIExcerptProvider {
	readonly providerType = LLMProvider.OLLAMA_LOCAL;
	private endpoint: string;
	private model: string;
	private promptType: string;

	constructor(
		endpoint: string,
		model: string,
		promptType = "excerpt-generation"
	) {
		this.endpoint = endpoint;
		this.model = model;
		this.promptType = promptType;
	}

	async generateExcerpt(content: string, maxLength: number): Promise<string> {
		const timeoutMs = getOllamaTimeout();

		const systemPrompt = await Prompts.getPrompt(this.promptType);
		const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt, maxLength);

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

			return ensureCompleteSentence(excerptText, maxLength);
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
}