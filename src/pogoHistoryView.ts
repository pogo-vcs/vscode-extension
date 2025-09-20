import * as vscode from "vscode";
import { exec } from "child_process";

interface Change {
	name: string;
	unique_prefix: string;
	unique_suffix: string;
	description: string;
	conflict_files: string[] | null;
	created_at: string; // ISO 8601 timestamp
	updated_at: string; // ISO 8601 timestamp
	is_checked_out: boolean;
	x: number;
	y: number;
}

interface ChangesGraph {
	changes: Change[];
	// Each tuple represents an edge between two change names
	adjacency_list: Array<[string, string]>;
}

export class PogoHistoryViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "pogoHistory";

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _workspaceRoot: string
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getLoadingHtml();

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
			case "refresh":
				this.refresh();
				break;
			}
		});

		// Load initial content
		this.refresh();
	}

	public async refresh() {
		if (this._view) {
			this._view.webview.html = this._getLoadingHtml();
			const graphData = await this._getPogoGraph();
			this._view.webview.html = this._getHtmlForWebview(graphData);
		}
	}

	private _getLoadingHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pogo History</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			margin: 0;
			padding: 10px;
		}
	</style>
</head>
<body>
	<div>Loading Pogo history...</div>
</body>
</html>`;
	}

	private _getHtmlForWebview(graphData: { graph?: ChangesGraph; error?: string }): string {
		const refreshButton = `
			<button onclick="refresh()" style="
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border: none;
				padding: 4px 8px;
				border-radius: 2px;
				cursor: pointer;
				font-size: 12px;
				margin-bottom: 10px;
			">Refresh</button>
		`;

		if (graphData.error) {
			return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pogo History</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			margin: 0;
			padding: 10px;
		}
		.error {
			color: var(--vscode-errorForeground);
			padding: 8px;
			background-color: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			border-radius: 3px;
		}
	</style>
</head>
<body>
	${refreshButton}
	<div class="error">${graphData.error}</div>
	<script>
		const vscode = acquireVsCodeApi();
		function refresh() { vscode.postMessage({ type: 'refresh' }); }
	</script>
</body>
</html>`;
		}

		return this._getGraphHtml(graphData.graph!);
	}

	private async _getPogoGraph(): Promise<{ graph?: ChangesGraph; error?: string }> {
		return new Promise((resolve) => {
			const command = "pogo log --json";
			
			const execProcess = exec(command, { 
				cwd: this._workspaceRoot,
				timeout: 10000
			}, (error, stdout, stderr) => {
				if (error) {
					resolve({
						error: `Error executing pogo log: ${error.message}`
					});
					return;
				}
				
				if (stderr) {
					resolve({
						error: `Pogo error: ${stderr}`
					});
					return;
				}
				
				try {
					const graph = JSON.parse(stdout || "{}") as ChangesGraph;
					resolve({ graph });
				} catch (parseError) {
					resolve({
						error: `Error parsing JSON: ${parseError}`
					});
				}
			});

			setTimeout(() => {
				if (execProcess.killed === false) {
					execProcess.kill();
					resolve({
						error: "Error: Command timed out"
					});
				}
			}, 12000);
		});
	}

	private _getGraphHtml(graph: ChangesGraph): string {
		const refreshButton = `
			<button onclick="refresh()" style="
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border: none;
				padding: 4px 8px;
				border-radius: 2px;
				cursor: pointer;
				font-size: 12px;
				margin-bottom: 10px;
			">Refresh</button>
		`;

		// Calculate SVG dimensions based on node positions
		const maxX = Math.max(...graph.changes.map(c => c.x), 0);
		const maxY = Math.max(...graph.changes.map(c => c.y), 0);
		const svgWidth = (maxX + 2) * 16; // 1rem = 16px
		const svgHeight = (maxY + 2) * 16;

		// Generate SVG content
		const edges = graph.adjacency_list.map(([from, to]) => {
			const fromChange = graph.changes.find(c => c.name === from);
			const toChange = graph.changes.find(c => c.name === to);
			if (!fromChange || !toChange) {return "";}
			
			const x1 = (fromChange.x + 1) * 16;
			const y1 = (fromChange.y + 1) * 16;
			const x2 = (toChange.x + 1) * 16;
			const y2 = (toChange.y + 1) * 16;
			
			return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--vscode-foreground)" stroke-width="1"/>`;
		}).join("");

		const nodes = graph.changes.map(change => {
			const cx = (change.x + 1) * 16;
			const cy = (change.y + 1) * 16;
			return `<circle cx="${cx}" cy="${cy}" r="6" fill="var(--vscode-foreground)" stroke="var(--vscode-editor-background)" stroke-width="2"/>`;
		}).join("");

		// Generate change info list
		const changeInfos = graph.changes.map(change => {
			const topPosition = change.y * 16; // Align with node position
			return `
				<div class="change-info" style="top: ${topPosition}px;">
					<div class="change-name">${change.name}</div>
				</div>
			`;
		}).join("");

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pogo History</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			margin: 0;
			padding: 10px;
		}
		
		.container {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 10px;
			height: calc(100vh - 60px);
		}
		
		.graph-panel {
			border: 1px solid var(--vscode-widget-border);
			border-radius: 3px;
			overflow: auto;
			padding: 8px;
		}
		
		.info-panel {
			border: 1px solid var(--vscode-widget-border);
			border-radius: 3px;
			overflow: auto;
			padding: 8px;
			position: relative;
		}
		
		.change-info {
			position: absolute;
			left: 0;
			right: 0;
			padding: 4px 8px;
		}
		
		.change-name {
			font-weight: bold;
			font-family: var(--vscode-editor-font-family, monospace);
		}
		
		button:hover {
			background-color: var(--vscode-button-hoverBackground) !important;
		}
	</style>
</head>
<body>
	${refreshButton}
	<div class="container">
		<div class="graph-panel">
			<svg width="${svgWidth}" height="${svgHeight}">
				${edges}
				${nodes}
			</svg>
		</div>
		<div class="info-panel">
			${changeInfos}
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		
		function refresh() {
			vscode.postMessage({ type: 'refresh' });
		}
	</script>
</body>
</html>`;
	}
}