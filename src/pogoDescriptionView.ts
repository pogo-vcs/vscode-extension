import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

export class PogoDescriptionViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "pogoDescription";
	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _workspaceRoot: string,
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
			case "getDescription":
				await this.getCurrentDescription();
				break;
			case "updateDescription":
				await this.updateDescription(message.description);
				break;
			}
		});

		// Load initial description
		this.getCurrentDescription();
	}

	public async refresh(): Promise<void> {
		if (this._view) {
			await this.getCurrentDescription();
		}
	}

	private async getCurrentDescription(): Promise<void> {
		try {
			const execAsync = promisify(exec);
			const { stdout } = await execAsync('pogo info --format "{{.ChangeDescription}}"', {
				cwd: this._workspaceRoot
			});
			const description = stdout.trim();

			if (this._view) {
				this._view.webview.postMessage({
					command: "setDescription",
					description: description,
				});
			}
		} catch (error) {
			console.error("Failed to get current description:", error);
			if (this._view) {
				this._view.webview.postMessage({
					command: "setDescription",
					description: "",
				});
			}
		}
	}

	private async updateDescription(description: string): Promise<void> {
		try {
			const execAsync = promisify(exec);
			const escapedDescription = description.replace(/"/g, '\\"');
			await execAsync(`pogo describe -m "${escapedDescription}"`, {
				cwd: this._workspaceRoot
			});

			vscode.window.showInformationMessage("Change description updated successfully");

			// Refresh to show the updated description
			await this.getCurrentDescription();
		} catch (error) {
			console.error("Failed to update description:", error);
			vscode.window.showErrorMessage(`Failed to update change description: ${error}`);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Pogo Change Description</title>
				<style>
					body {
						padding: 10px;
						font-family: var(--vscode-font-family);
						font-size: var(--vscode-font-size);
						background-color: var(--vscode-editor-background);
						color: var(--vscode-editor-foreground);
					}
					textarea {
						width: 100%;
						min-height: 100px;
						padding: 8px;
						border: 1px solid var(--vscode-input-border);
						border-radius: 3px;
						background-color: var(--vscode-input-background);
						color: var(--vscode-input-foreground);
						font-family: inherit;
						font-size: inherit;
						resize: vertical;
					}
					button {
						margin-top: 10px;
						padding: 6px 12px;
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						border-radius: 3px;
						cursor: pointer;
						font-size: inherit;
					}
					button:hover {
						background-color: var(--vscode-button-hoverBackground);
					}
					button:disabled {
						opacity: 0.6;
						cursor: not-allowed;
					}
					.label {
						margin-bottom: 5px;
						font-weight: bold;
					}
				</style>
			</head>
			<body>
				<div class="label">Change Description:</div>
				<textarea id="description" placeholder="Enter change description..."></textarea>
				<button id="saveButton">Update Description</button>

				<script nonce="${nonce}">
					const vscode = acquireVsCodeApi();
					const textarea = document.getElementById('description');
					const saveButton = document.getElementById('saveButton');

					// Handle messages from extension
					window.addEventListener("message", event => {
						const message = event.data;
						switch (message.command) {
							case "setDescription":
								textarea.value = message.description;
								break;
						}
					});

					// Save button click
					saveButton.addEventListener('click', () => {
						const description = textarea.value.trim();
						vscode.postMessage({
							command: 'updateDescription',
							description: description
						});
					});

					// Auto-resize textarea
					textarea.addEventListener('input', () => {
						textarea.style.height = 'auto';
						textarea.style.height = textarea.scrollHeight + 'px';
					});
				</script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}