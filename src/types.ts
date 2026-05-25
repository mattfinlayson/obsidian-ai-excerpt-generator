import { TFile, TFolder } from "obsidian";

// Define available LLM providers
export enum LLMProvider {
	CLAUDE = "claude",
	OPENAI = "openai",
	OLLAMA_LOCAL = "ollama_local",
	OLLAMA_CLOUD = "ollama_cloud",
}

// Define built-in prompt type IDs
export const BUILTIN_PROMPT_IDS = {
	DEFAULT: "excerpt-generation",
	ACADEMIC: "academic-summary",
	PROFESSIONAL: "professional-summary",
	BLOG: "blog-summary",
	SIMPLIFIED: "simplified-summary",
	SOCIAL: "social-summary",
} as const;

// Type for prompt type strings (built-in IDs or custom slugs)
export type PromptTypeId = string;

// Define available models for each provider
export const CLAUDE_MODELS = [
	// Latest Claude 3.7 models
	"claude-3-7-sonnet-20250219",
	// Claude 3.5 models
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
	"claude-3-5-sonnet-20240620",
	// Claude 3 models
	"claude-3-opus-20240229",
	"claude-3-sonnet-20240229",
	"claude-3-haiku-20240307",
];

export const OPENAI_MODELS = [
	// Latest reasoning models
	"o3-mini",
	"o1",
	"o1-mini",
	"o1-pro",
	// Flagship chat models
	"gpt-4.5-preview",
	"gpt-4o",
	"gpt-4",
	"gpt-4-turbo",
	"gpt-3.5-turbo",
];

export interface AIExcerptSettings {
	provider: LLMProvider;
	promptType: string;
	claudeApiKey: string;
	claudeModel: string;
	openaiApiKey: string;
	openaiModel: string;
	ollamaLocalEndpoint: string;
	ollamaLocalModel: string;
	ollamaCloudApiKey: string;
	ollamaCloudModel: string;
	maxLength: number;
}

export interface AIExcerptProvider {
	readonly providerType: LLMProvider;
	generateExcerpt(content: string, maxLength: number): Promise<string>;
}

export interface AIExcerptPlugin {
	settings: AIExcerptSettings;
	saveSettings(): Promise<void>;
	processFile(file: TFile, showNotices?: boolean): Promise<void>;
	processDirectory(folder: TFolder): Promise<void>;
	processAllFiles(): Promise<void>;
	updateStatusBar(processed: number, total: number): void;
}
