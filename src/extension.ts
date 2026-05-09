import * as path from 'path';
import * as vscode from 'vscode';

const OPEN_IMAGE_COMMAND = 'extension.openImage';
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tga']);

type ImageLiteralMatch = {
	rawPath: string;
	range: vscode.Range;
};

export function activate(context: vscode.ExtensionContext) {
	const openImageDisposable = vscode.commands.registerCommand(OPEN_IMAGE_COMMAND, async (uriText: string) => {
		try {
			const uri = vscode.Uri.parse(uriText);
			await vscode.commands.executeCommand('vscode.open', uri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`无法打开图片：${message}`);
		}
	});

	const hoverDisposable = vscode.languages.registerHoverProvider(
		[
			{ language: 'typescript', scheme: 'file' },
			{ language: 'typescriptreact', scheme: 'file' }
		],
		{
			async provideHover(document, position) {
				const match = findImageLiteralAtPosition(document, position);
				if (!match) {
					return undefined;
				}

				const imageUri = resolveWorkspaceImageUri(match.rawPath, document);
				if (!imageUri || !(await fileExists(imageUri))) {
					return new vscode.Hover('文件未找到', match.range);
				}

				return new vscode.Hover(createImagePreviewMarkdown(imageUri), match.range);
			}
		}
	);

	context.subscriptions.push(openImageDisposable, hoverDisposable);
}

export function deactivate() {}

function findImageLiteralAtPosition(document: vscode.TextDocument, position: vscode.Position): ImageLiteralMatch | undefined {
	const line = document.lineAt(position.line).text;
	const literalPattern = /(["'`])((?:\\.|(?!\1).)*?\.(?:png|jpe?g|tga))\1/gi;
	let match: RegExpExecArray | null;

	while ((match = literalPattern.exec(line)) !== null) {
		const literalStart = match.index;
		const literalEnd = literalStart + match[0].length;

		if (position.character < literalStart || position.character > literalEnd) {
			continue;
		}

		const pathStart = literalStart + 1;
		const pathEnd = literalEnd - 1;

		return {
			rawPath: match[2],
			range: new vscode.Range(position.line, pathStart, position.line, pathEnd)
		};
	}

	return undefined;
}

function resolveWorkspaceImageUri(rawPath: string, document: vscode.TextDocument): vscode.Uri | undefined {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return undefined;
	}

	const workspaceRoot = workspaceFolder.uri.fsPath;
	const decodedPath = decodeTypeScriptStringPath(rawPath).trim();
	if (!decodedPath || !isSupportedImagePath(decodedPath)) {
		return undefined;
	}

	const candidates = buildPathCandidates(decodedPath, workspaceRoot);
	const insideWorkspace = candidates.find((candidate) => isInsideDirectory(candidate, workspaceRoot));

	return insideWorkspace ? vscode.Uri.file(insideWorkspace) : undefined;
}

function buildPathCandidates(imagePath: string, workspaceRoot: string): string[] {
	const normalizedPath = imagePath.replace(/[\\/]+/g, path.sep);
	const candidates = new Set<string>();

	if (path.isAbsolute(normalizedPath)) {
		candidates.add(path.normalize(normalizedPath));
	}

	// Treat "/assets/a.png" or "\assets\a.png" as workspace-root relative paths.
	const workspaceRelativePath = normalizedPath.replace(/^[\\/]+/, '');
	candidates.add(path.resolve(workspaceRoot, workspaceRelativePath));

	return [...candidates];
}

function decodeTypeScriptStringPath(rawPath: string): string {
	return rawPath
		.replace(/\\\\/g, '\\')
		.replace(/\\\//g, '/')
		.replace(/\\"/g, '"')
		.replace(/\\'/g, '\'')
		.replace(/\\`/g, '`');
}

function isSupportedImagePath(imagePath: string): boolean {
	return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase());
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
	const relativePath = path.relative(directoryPath, filePath);
	return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.File;
	} catch {
		return false;
	}
}

function createImagePreviewMarkdown(imageUri: vscode.Uri): vscode.MarkdownString {
	const commandUri = vscode.Uri.parse(
		`command:${OPEN_IMAGE_COMMAND}?${encodeURIComponent(JSON.stringify([imageUri.toString()]))}`
	);
	const markdown = new vscode.MarkdownString(undefined, true);

	markdown.isTrusted = { enabledCommands: [OPEN_IMAGE_COMMAND] };
	markdown.supportHtml = true;
	markdown.appendMarkdown(`<img src="${escapeHtmlAttribute(imageUri.toString())}" width="200" alt="图片预览" />\n\n`);
	markdown.appendMarkdown(`[打开图片](${commandUri.toString()})\n\n`);
	markdown.appendMarkdown(`\`${path.basename(imageUri.fsPath)}\``);

	return markdown;
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
