import * as vscode from "vscode";
import { PogoSCMProvider } from "./pogoSCM";
import { PogoHistoryViewProvider } from "./pogoHistoryView";

let activePogoProviders: PogoSCMProvider[] = [];
let activeHistoryProviders: PogoHistoryViewProvider[] = [];

export async function activate(context: vscode.ExtensionContext) {
	console.log("Pogo VCS extension is now active!");

	const helloWorldDisposable = vscode.commands.registerCommand("pogo-vcs.helloWorld", () => {
		vscode.window.showInformationMessage("Hello World from pogo!");
	});

	const refreshDisposable = vscode.commands.registerCommand("pogo-vcs.refresh", async () => {
		for (const provider of activePogoProviders) {
			await provider.refresh();
		}
		for (const historyProvider of activeHistoryProviders) {
			await historyProvider.refresh();
		}
	});

	context.subscriptions.push(helloWorldDisposable, refreshDisposable);

	await initializeSCMProviders(context);
}

async function initializeSCMProviders(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders) {
		for (const workspaceFolder of vscode.workspace.workspaceFolders) {
			const workspaceRoot = workspaceFolder.uri.fsPath;
			const isPogoRepo = await PogoSCMProvider.detectRepository(workspaceRoot);

			if (isPogoRepo) {
				try {
					console.log(`Pogo repository detected at: ${workspaceRoot}`);
					console.log("Pogo SCM provider is now handling version control for this workspace");
					vscode.window.showInformationMessage(`Pogo repository detected! SCM provider active for: ${workspaceFolder.name}`);
					
					const provider = new PogoSCMProvider(workspaceRoot);
					activePogoProviders.push(provider);
					context.subscriptions.push(provider);
					
					const historyProvider = new PogoHistoryViewProvider(context.extensionUri, workspaceRoot);
					activeHistoryProviders.push(historyProvider);
					
					context.subscriptions.push(
						vscode.window.registerWebviewViewProvider(PogoHistoryViewProvider.viewType, historyProvider)
					);
					
					console.log("Pogo WebviewView created successfully");
				} catch (error) {
					console.error("Error initializing Pogo providers:", error);
					vscode.window.showErrorMessage(`Error initializing Pogo extension: ${error}`);
				}
			}
		}
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
