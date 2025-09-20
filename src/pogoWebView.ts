import * as vscode from "vscode";
import { exec } from "child_process";

export class PogoWebViewProvider {
	public static readonly viewType = "pogo.info";
	private static _instance: PogoWebViewProvider | undefined;

	private constructor(
        private readonly _workspaceRoot: string
	) {}

	public static getInstance(workspaceRoot: string): PogoWebViewProvider {
		if (!PogoWebViewProvider._instance) {
			PogoWebViewProvider._instance = new PogoWebViewProvider(workspaceRoot);
		}
		return PogoWebViewProvider._instance;
	}

	public async show(): Promise<void> {
		const panel = vscode.window.createWebviewPanel(
			PogoWebViewProvider.viewType,
			"Pogo Info",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);

		panel.webview.html = await this._getWebviewContent();

		panel.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.command) {
				case "refresh":
					panel.webview.html = await this._getWebviewContent();
					break;
				}
			}
		);
	}

	private async _getWebviewContent(): Promise<string> {
		const pogoInfo = await this._getPogoInfo();
        
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pogo Info</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        
        .info-container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .status {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 20px;
            padding: 10px;
            border-radius: 4px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
        }
        
        .error {
            color: var(--vscode-errorForeground);
            border-left-color: var(--vscode-errorForeground);
        }
        
        .refresh-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
        }
        
        .refresh-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .workspace-info {
            margin-top: 20px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="info-container">
        <h1>Pogo Repository Information</h1>
        
        <div class="status ${pogoInfo.isError ? "error" : ""}">
            ${pogoInfo.content}
        </div>
        
        <button class="refresh-button" onclick="refresh()">Refresh</button>
        
        <div class="workspace-info">
            <strong>Workspace:</strong> ${this._workspaceRoot}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
	}

	private async _getPogoInfo(): Promise<{ content: string; isError: boolean }> {
		return new Promise((resolve) => {
			const command = "pogo info --format '{{if .Error}}{{.Error}}{{else}}{{if .IsInConflict}}💥{{end}}{{.ChangeName}}{{end}}'";
            
			exec(command, { cwd: this._workspaceRoot }, (error, stdout, stderr) => {
				if (error) {
					resolve({
						content: `Error executing pogo command: ${error.message}`,
						isError: true
					});
					return;
				}
                
				if (stderr) {
					resolve({
						content: `Pogo error: ${stderr.trim()}`,
						isError: true
					});
					return;
				}
                
				const output = stdout.trim();
				resolve({
					content: output || "No information available",
					isError: false
				});
			});
		});
	}
}