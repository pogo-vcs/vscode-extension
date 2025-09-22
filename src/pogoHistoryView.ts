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

export class PogoHistoryViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = "pogoHistory";

	private _view?: vscode.WebviewView;
	private _autoRefreshTimer?: NodeJS.Timeout;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _workspaceRoot: string
	) { }

	public dispose() {
		if (this._autoRefreshTimer) {
			clearInterval(this._autoRefreshTimer);
			this._autoRefreshTimer = undefined;
		}
	}

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

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
				case "changeClick":
					this._handleChangeClick(message.changeName);
					return;
				}
			},
			undefined,
			[]
		);

		// Load initial content
		this.refresh();

		// Start auto-refresh timer
		this._startAutoRefreshTimer();
	}

	public async refresh() {
		if (this._view) {
			this._view.webview.html = this._getLoadingHtml();
			const graphData = await this._getPogoGraph();
			this._view.webview.html = this._getHtmlForWebview(graphData);
		}

		// Reset auto-refresh timer after manual/file-triggered refresh
		this._resetAutoRefreshTimer();
	}

	private _startAutoRefreshTimer() {
		this._resetAutoRefreshTimer();
	}

	private _resetAutoRefreshTimer() {
		// Clear existing timer
		if (this._autoRefreshTimer) {
			clearInterval(this._autoRefreshTimer);
		}

		// Get refresh interval from configuration (in minutes, convert to milliseconds)
		const config = vscode.workspace.getConfiguration("pogo");
		const intervalMinutes = config.get("historyView.autoRefreshInterval", 5);
		const intervalMs = intervalMinutes * 60 * 1000;

		// Start new timer
		this._autoRefreshTimer = setInterval(() => {
			this.refresh();
		}, intervalMs);
	}

	private _handleChangeClick(changeName: string) {
		const command = `pogo edit ${changeName}`;

		exec(command, {
			cwd: this._workspaceRoot,
			timeout: 10000
		}, (error, _stdout, stderr) => {
			if (error) {
				vscode.window.showErrorMessage(`Error executing pogo edit: ${error.message}`);
				return;
			}

			if (stderr) {
				vscode.window.showErrorMessage(`Pogo error: ${stderr}`);
				return;
			}

			// Success - the .pogo.yaml file change will trigger automatic rerender
		});
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
	<div class="error">${graphData.error}</div>
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

		// Calculate SVG dimensions based on node positions
		const maxX = Math.max(...graph.changes.map(c => c.x), 0);
		const maxY = Math.max(...graph.changes.map(c => c.y), 0);
		const xScale = 8;
		const yScale = 20;
		const svgWidth = (maxX + 2) * xScale;
		const svgHeight = (maxY + 2) * yScale;

		// Generate SVG content with orthogonal edges
		const edges = graph.adjacency_list ? graph.adjacency_list.map(([from, to]) => {
			const fromChange = graph.changes.find(c => c.name === from);
			const toChange = graph.changes.find(c => c.name === to);
			if (!fromChange || !toChange) { return ""; }

			let x1 = (fromChange.x + 1) * xScale;
			let y1 = (fromChange.y + 1) * yScale;
			let x2 = (toChange.x + 1) * xScale;
			let y2 = (toChange.y + 1) * yScale;

			if (y2 > y1) {
				[x1, x2] = [x2, x1];
				[y1, y2] = [y2, y1];
			}

			// If nodes have same x coordinate, draw straight line
			if (x1 === x2) {
				return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--vscode-foreground)" stroke-width="1"/>`;
			}

			// Generate orthogonal path with quarter-circle arc
			const radius = 4; // Arc radius

			// Determine arc direction based on relative positions
			const deltaX = x2 - x1;
			const deltaY = y2 - y1;

			// Calculate arc start and end points
			const arcStartX = x2 - Math.sign(deltaX) * radius;
			const arcStartY = y1;
			const arcEndX = x2;
			const arcEndY = y1 + Math.sign(deltaY) * radius;

			// Determine sweep direction (0 for clockwise, 1 for counter-clockwise)
			const sweep = (deltaX > 0 && deltaY < 0) || (deltaX < 0 && deltaY > 0) ? 0 : 1;

			const pathData = `M ${x1} ${y1} L ${arcStartX} ${arcStartY} A ${radius} ${radius} 0 0 ${sweep} ${arcEndX} ${arcEndY} L ${x2} ${y2}`;
			return `<path d="${pathData}" stroke="var(--vscode-foreground)" stroke-width="1" fill="none"/>`;
		}).join("") : "";

		const nodes = graph.changes.map(change => {
			const cx = (change.x + 1) * xScale;
			const cy = (change.y + 1) * yScale;

			// Determine color based on conflict state
			const isInConflict = change.conflict_files && change.conflict_files.length > 0;
			const nodeColor = isInConflict ?
				"var(--vscode-errorForeground)" :
				"var(--vscode-foreground)";

			// Determine fill/stroke based on checkout state
			const isCheckedOut = change.is_checked_out;
			const fillColor = isCheckedOut ? nodeColor : "var(--vscode-editor-background)";
			const strokeColor = nodeColor;

			return `<circle cx="${cx}" cy="${cy}" r="4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" data-change-name="${change.name}" class="graph-node"/>`;
		}).join("");

		// Generate change info list
		const changeInfos = graph.changes.map(change => {
			const topPosition = (change.y + 1) * yScale - 8; // Align with node position (accounting for SVG padding)
			const description = change.description ?
				change.description :
				"<span style=\"color: var(--vscode-gitDecoration-addedResourceForeground);\">(no description)</span>";

			if (change.name === "~") {
				return `
				<div class="change-info" style="top: ${topPosition}px;">
					<div class="change-name">~</div>
					<div class="change-description">&nbsp;</div>
				</div>
			`;
			} else {
				// Split change name into prefix (pink/purple) and suffix (gray)
				const prefixHtml = `<span class="change-prefix">${change.unique_prefix}</span>`;
				const suffixHtml = `<span class="change-suffix">${change.unique_suffix}</span>`;

				// Make clickable if not checked out
				const isClickable = !change.is_checked_out;
				const clickableClass = isClickable ? "clickable" : "";
				const clickHandler = isClickable ? `onclick="handleChangeClick('${change.name}')"` : "";
				const hoverHandlers = isClickable ? `onmouseenter="handleChangeHover('${change.name}')" onmouseleave="handleChangeUnhover('${change.name}')"` : "";

				return `
				<div class="change-info ${clickableClass}" style="top: ${topPosition}px;" ${clickHandler} ${hoverHandlers} data-change-name="${change.name}" title="${(new Date(change.updated_at)).toLocaleString()}">
					<div class="change-name">${prefixHtml}${suffixHtml}</div>
					<div class="change-description">${description}</div>
				</div>
			`;
			}
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
			user-select: none;
		}
		
		.container {
			display: flex;
			gap: 4px;
			height: calc(100vh - 60px);
			overflow: auto;
		}
		
		.graph-panel {
			padding: 8px;
			overflow: visible;
			flex-shrink: 0;
			width: ${svgWidth + 16}px; /* SVG width + padding */
		}
		
		.info-panel {
			padding: 8px;
			position: relative;
			overflow: visible;
			min-height: ${svgHeight}px;
			flex: 1;
			min-width: 0; /* Allow flex item to shrink below content size */
		}
		
		.change-info {
			position: absolute;
			left: 0;
			right: 0;
			padding: 4px 8px;
			height: 32px; /* 2rem = 2 * 16px for the 2-unit spacing */
		}

		.change-info.clickable {
			cursor: pointer;
			border-radius: 3px;
		}

		.change-info.clickable:hover {
			background-color: var(--vscode-list-hoverBackground);
		}
		
		.change-name {
			font-weight: bold;
			font-family: var(--vscode-editor-font-family, monospace);
			line-height: 16px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		
		.change-prefix {
			color: var(--vscode-gitDecoration-modifiedResourceForeground, #e879f9);
		}
		
		.change-suffix {
			color: var(--vscode-descriptionForeground);
		}
		
		.change-description {
			font-size: 12px;
			font-family: var(--vscode-editor-font-family, monospace);
			line-height: 16px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		
		.graph-node {
			transition: stroke-width 0.2s ease, r 0.2s ease;
		}
		
		.graph-node.highlighted {
			stroke-width: 3px !important;
			r: 6px !important;
		}
		
		button:hover {
			background-color: var(--vscode-button-hoverBackground) !important;
		}
	</style>
</head>
<body>
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
		
		function handleChangeClick(changeName) {
			vscode.postMessage({
				command: 'changeClick',
				changeName: changeName
			});
		}
		
		function handleChangeHover(changeName) {
			const node = document.querySelector(\`circle[data-change-name="\${changeName}"]\`);
			if (node) {
				node.classList.add('highlighted');
			}
		}
		
		function handleChangeUnhover(changeName) {
			const node = document.querySelector(\`circle[data-change-name="\${changeName}"]\`);
			if (node) {
				node.classList.remove('highlighted');
			}
		}
	</script>
</body>
</html>`;
	}
}