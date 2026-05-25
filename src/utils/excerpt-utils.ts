export function ensureCompleteSentence(
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

export function buildEnhancedSystemPrompt(
	systemPrompt: string,
	maxLength: number
): string {
	return `${systemPrompt}

Generate a concise excerpt (maximum ${maxLength} characters) that captures the essence of this document.

IMPORTANT RULES:
- Your entire response must be under ${maxLength} characters
- Always end with a complete sentence - NEVER end mid-sentence or with a truncated word
- Do not use ellipses (...) in your response
- Match the author's writing style and voice
- If approaching the character limit, find a natural ending point for a complete thought
- Count your characters carefully to ensure you don't exceed the limit`;
}