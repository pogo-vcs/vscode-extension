import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class PogoSCMProvider implements vscode.Disposable {
	private _sourceControl: vscode.SourceControl;
	private _disposables: vscode.Disposable[] = [];

	constructor(private _workspaceRoot: string) {
		this._sourceControl = vscode.scm.createSourceControl("pogo", "Pogo", vscode.Uri.file(this._workspaceRoot));
		this._sourceControl.quickDiffProvider = this;

		this._disposables.push(this._sourceControl);
	}

	get sourceControl(): vscode.SourceControl {
		return this._sourceControl;
	}

	get workspaceRoot(): string {
		return this._workspaceRoot;
	}

	provideOriginalResource(_uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
		return undefined;
	}

	async refresh(): Promise<void> {
		// No-op since we removed the input box functionality
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