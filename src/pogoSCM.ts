import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { PogoHistoryViewProvider } from "./pogoHistoryView";

export class PogoSCMProvider implements vscode.Disposable {
	private _sourceControl: vscode.SourceControl;
	private _disposables: vscode.Disposable[] = [];
	private _isLoading: boolean = false;

	constructor(private _workspaceRoot: string, private _historyProvider?: PogoHistoryViewProvider) {
		this._sourceControl = vscode.scm.createSourceControl("pogo", "Pogo", vscode.Uri.file(this._workspaceRoot));
		
		// Remove quickDiffProvider to avoid potential blocking issues
		// this._sourceControl.quickDiffProvider = this;

		// Set up the input box for description editing
		this._sourceControl.inputBox.placeholder = "Enter change description...";
		
		// Set up accept input command
		this._sourceControl.acceptInputCommand = {
			command: "pogo.acceptInput",
			title: "Update Description"
		};
		
		// Register the command
		this._disposables.push(
			vscode.commands.registerCommand("pogo.acceptInput", this.onInputAccept, this)
		);

		this._disposables.push(this._sourceControl);
		
		// Load initial description asynchronously to avoid blocking constructor
		setTimeout(() => this.loadCurrentDescription(), 0);
	}

	get sourceControl(): vscode.SourceControl {
		return this._sourceControl;
	}

	get workspaceRoot(): string {
		return this._workspaceRoot;
	}



	private async loadCurrentDescription(): Promise<void> {
		if (this._isLoading) {
			return;
		}
		
		this._isLoading = true;
		
		try {
			const execAsync = promisify(exec);
			const { stdout } = await execAsync('pogo info --format "{{.ChangeDescription}}"', {
				cwd: this._workspaceRoot,
				timeout: 5000 // 5 second timeout to prevent hanging
			});
			const description = stdout.trim();
			this._sourceControl.inputBox.value = description;
		} catch (error) {
			console.error("Failed to get current description:", error);
			this._sourceControl.inputBox.value = "";
		} finally {
			this._isLoading = false;
		}
	}

	private async onInputAccept(): Promise<void> {
		const description = this._sourceControl.inputBox.value.trim();
		if (description) {
			await this.updateDescription(description);
		}
	}

	private async updateDescription(description: string): Promise<void> {
		try {
			const execAsync = promisify(exec);
			const escapedDescription = description.replace(/"/g, '\\"');
			await execAsync(`pogo describe -m "${escapedDescription}"`, {
				cwd: this._workspaceRoot,
				timeout: 10000 // 10 second timeout for update operation
			});

			vscode.window.showInformationMessage("Change description updated successfully");
			
			// Refresh the history view to show the updated description
			if (this._historyProvider) {
				this._historyProvider.refresh().catch(err => 
					console.error("Failed to refresh history view after description update:", err)
				);
			}
		} catch (error) {
			console.error("Failed to update description:", error);
			vscode.window.showErrorMessage(`Failed to update change description: ${error}`);
			
			// Reload the original description on error, but don't await it to avoid blocking
			this.loadCurrentDescription().catch(err => 
				console.error("Failed to reload description after error:", err)
			);
		}
	}

	async refresh(): Promise<void> {
		// Don't await to prevent blocking the refresh operation
		this.loadCurrentDescription().catch(err => 
			console.error("Failed to refresh description:", err)
		);
	}

	static async detectRepository(workspaceRoot: string): Promise<boolean> {
		try {
			const pogoConfigPath = path.join(workspaceRoot, ".pogo.yaml");
			return fs.existsSync(pogoConfigPath);
		} catch (error) {
			return false;
		}
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}