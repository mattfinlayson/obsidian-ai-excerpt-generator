import { App, Modal, Notice, Setting } from "obsidian";
import { Plugin } from "obsidian";
import { AIExcerptPlugin, BUILTIN_PROMPT_IDS } from "../types";
import { PromptLoader } from "../utils/prompt-loader";
import { Prompts } from "../utils/prompts";

/**
 * Modal dialog for creating and editing custom prompts
 */
export class PromptEditorModal extends Modal {
	private plugin: Plugin & AIExcerptPlugin;
	private slug: string | null;
	private onSave: () => void;

	private nameInput: string = "";
	private contentInput: string = "";
	private nameError: string = "";
	private saveButton: HTMLButtonElement | null = null;
	private isEditing: boolean = false;
	private isLoading: boolean = false;
	private isSaving: boolean = false;

	constructor(
		app: App,
		plugin: Plugin & AIExcerptPlugin,
		slug: string | null,
		onSave: () => void
	) {
		super(app);
		this.plugin = plugin;
		this.slug = slug;
		this.isEditing = slug !== null;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", {
			text: this.isEditing ? "Edit Custom Prompt" : "Create Custom Prompt",
		});

		// Name field
		new Setting(contentEl)
			.setName("Name")
			.setDesc(
				this.isEditing
					? "Cannot change the name of an existing prompt"
					: "The name will be used to generate a unique identifier"
			)
			.addText((text) => {
				text
					.setPlaceholder("My Custom Prompt")
					.setValue(this.nameInput)
					.setDisabled(this.isEditing)
					.onChange((value) => {
						this.nameInput = value;
						this.validate();
					});
			});

		// Slug preview (only for new prompts)
		if (!this.isEditing) {
			const slugPreview = contentEl.createDiv({
				cls: "custom-prompt-slug-preview",
			});
			slugPreview.createEl("span", {
				text: "Identifier: ",
				cls: "custom-prompt-slug-label",
			});
			slugPreview.createEl("span", {
				text: this.nameInput ? PromptLoader.slugify(this.nameInput) : "(none)",
				cls: "custom-prompt-slug-value",
			});
			this.updateSlugPreview(slugPreview);
		}

		// Validation error display
		const nameErrorEl = contentEl.createDiv({
			cls: "custom-prompt-name-error",
		});
		nameErrorEl.style.color = "var(--text-error)";
		nameErrorEl.style.fontSize = "0.85em";
		nameErrorEl.style.marginTop = "-8px";
		nameErrorEl.style.marginBottom = "12px";
		nameErrorEl.style.paddingLeft = "24px";

		// Content textarea
		new Setting(contentEl)
			.setName("Prompt Content")
			.setDesc("The text sent to the AI model as system instructions")
			.addTextArea((text) => {
				text
					.setPlaceholder("Enter your prompt instructions here...")
					.setValue(this.contentInput)
					.onChange((value) => {
						this.contentInput = value;
					});
				text.inputEl.style.width = "100%";
				text.inputEl.style.minHeight = "200px";
			});

		// Action buttons
		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "8px";
		buttonContainer.style.marginTop = "16px";

		this.saveButton = buttonContainer.createEl("button", {
			text: this.isEditing ? "Save Changes" : "Create Prompt",
			cls: "mod-cta",
		});
		this.saveButton.addEventListener("click", () => this.handleSave());

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => this.close());

		// If editing, load existing content asynchronously
		if (this.isEditing && this.slug) {
			this.isLoading = true;
			this.saveButton.disabled = true;
			this.saveButton.textContent = "Loading...";

			PromptLoader.loadCustom(this.slug)
				.then((content) => {
					this.contentInput = content;
					this.nameInput = PromptLoader.slugToDisplayName(this.slug!);
					this.isLoading = false;
					if (this.saveButton) {
						this.saveButton.disabled = false;
						this.saveButton.textContent = "Save Changes";
					}
					// Refresh the text area with loaded content
					const textArea = contentEl.querySelector("textarea");
					if (textArea) {
						textArea.value = this.contentInput;
					}
					this.validate();
				})
				.catch((e) => {
					new Notice(`Failed to load prompt: ${e.message}`);
					this.isLoading = false;
					if (this.saveButton) {
						this.saveButton.disabled = false;
						this.saveButton.textContent = "Save Changes";
					}
				});
		}

		this.validate();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private updateSlugPreview(container: HTMLElement) {
		const valueEl = container.querySelector(".custom-prompt-slug-value");
		if (valueEl) {
			valueEl.textContent = this.nameInput
				? PromptLoader.slugify(this.nameInput)
				: "(none)";
		}
	}

	private validate(): void {
		this.nameError = "";

		if (!this.nameInput.trim()) {
			this.nameError = "Name is required";
		} else {
			const slug = PromptLoader.slugify(this.nameInput);

			if (!slug) {
				this.nameError = "Name must contain at least one letter or number";
			} else if (PromptLoader.isBuiltInId(slug)) {
				this.nameError = `"${slug}" is a reserved built-in prompt name`;
			} else if (this.isEditing && slug !== this.slug) {
				// This shouldn't happen since name is disabled when editing, but guard against it
				this.nameError = "Cannot change the name of an existing prompt";
			} else if (
				!this.isEditing &&
				PromptLoader.getCustomPromptSlugs().includes(slug)
			) {
				this.nameError = `A custom prompt named "${slug}" already exists`;
			}
		}

		// Update error display
		const errorEl = this.containerEl.querySelector(
			".custom-prompt-name-error"
		);
		if (errorEl) {
			errorEl.textContent = this.nameError;
		}

		// Update save button state
		if (this.saveButton && !this.isLoading) {
			this.saveButton.disabled = !!this.nameError;
		}

		// Update slug preview
		if (!this.isEditing) {
			const slugPreview = this.containerEl.querySelector(
				".custom-prompt-slug-preview"
			);
			if (slugPreview) {
				this.updateSlugPreview(slugPreview as HTMLElement);
			}
		}
	}

	private async handleSave(): Promise<void> {
		if (this.isSaving || this.isLoading) return;

		this.validate();
		if (this.nameError) return;

		const slug = this.isEditing
			? this.slug!
			: PromptLoader.slugify(this.nameInput);

		// Check for empty content with confirmation
		if (!this.contentInput.trim() && !this.isEditing) {
			const confirmed = window.confirm(
				'This prompt has no body text. Excerpts generated with it will use only default instructions. Save anyway?'
			);
			if (!confirmed) return;
		}

		this.isSaving = true;
		this.saveButton!.disabled = true;
		this.saveButton!.textContent = "Saving...";

		try {
			// Build the content with H1 heading
			const displayName = this.isEditing
				? PromptLoader.slugToDisplayName(slug)
				: this.nameInput.trim();
			const fileContent = `# ${displayName}\n\n${this.contentInput.trim()}`;

			await PromptLoader.ensureCustomPromptsDir();
			await PromptLoader.saveCustomPrompt(slug, fileContent);
			Prompts.invalidateCustomPrompt(slug);
			Prompts.addCustomPromptSlug(slug);

			new Notice(
				this.isEditing
					? "Custom prompt updated"
					: "Custom prompt created"
			);

			this.onSave();
			this.close();
		} catch (e) {
			new Notice(`Failed to save prompt: ${e.message}`);
			this.isSaving = false;
			this.saveButton!.disabled = false;
			this.saveButton!.textContent = this.isEditing
				? "Save Changes"
				: "Create Prompt";
		}
	}
}