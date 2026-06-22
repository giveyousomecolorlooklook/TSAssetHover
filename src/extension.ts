import * as path from 'path';
import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { isPreviewImageType, isWorkspaceFileType, PREVIEW_MAX_SIZE } from './config';
import { localize } from './messages';
import { decodeBlpForPreview } from './utils/blpDecoder';

const OPEN_FILE_COMMAND = 'extension.openFile';
const SEND_TO_CHATGPT_COMMAND = 'extension.sendAssetContextToChatGPT';
const CHATGPT_ADD_FILE_TO_THREAD_COMMAND = 'chatgpt.addFileToThread';

type FileLiteralMatch = {
	rawPath: string;
	range: vscode.Range;
};

type ImagePreview = {
	source: string;
	width: number;
	height: number;
};

type AssetCodeContext = {
	fileUri: string;
};

export function activate(context: vscode.ExtensionContext) {
	const openFileDisposable = vscode.commands.registerCommand(OPEN_FILE_COMMAND, async (uriText: string) => {
		try {
			const uri = vscode.Uri.parse(uriText);
			await vscode.commands.executeCommand('vscode.open', uri);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(localize('error.openFile', { detail }));
		}
	});

	const sendToChatGptDisposable = vscode.commands.registerCommand(
		SEND_TO_CHATGPT_COMMAND,
		async (fileUriText: string) => {
			const availableCommands = await vscode.commands.getCommands(true);
			if (!availableCommands.includes(CHATGPT_ADD_FILE_TO_THREAD_COMMAND)) {
				vscode.window.showWarningMessage(localize('warning.chatGptCommandMissing'));
				return;
			}

			try {
				await vscode.commands.executeCommand(CHATGPT_ADD_FILE_TO_THREAD_COMMAND, vscode.Uri.parse(fileUriText));
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(localize('error.sendToChatGpt', { detail }));
			}
		}
	);

	const hoverDisposable = vscode.languages.registerHoverProvider(
		[
			{ language: 'typescript', scheme: 'file' },
			{ language: 'typescriptreact', scheme: 'file' }
		],
		{
			async provideHover(document, position) {
				const match = findFileLiteralAtPosition(document, position);
				if (!match) {
					return undefined;
				}

				const fileUri = resolveWorkspaceFileUri(match.rawPath, document);
				if (!fileUri || !(await fileExists(fileUri))) {
					return new vscode.Hover(localize('hover.fileNotFound'), match.range);
				}

				const assetContext = createAssetCodeContext(document, match, fileUri);
				if (!isPreviewImageType(fileUri.fsPath)) {
					return new vscode.Hover(createOpenFileMarkdown(fileUri, assetContext), match.range);
				}

				try {
					return new vscode.Hover(await createImagePreviewMarkdown(fileUri, assetContext), match.range);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return new vscode.Hover(createPreviewErrorMarkdown(fileUri, message, assetContext), match.range);
				}
			}
		}
	);

	context.subscriptions.push(openFileDisposable, sendToChatGptDisposable, hoverDisposable);
}

export function deactivate() {}

function findFileLiteralAtPosition(document: vscode.TextDocument, position: vscode.Position): FileLiteralMatch | undefined {
	const line = document.lineAt(position.line).text;
	const literalPattern = /(["'`])((?:\\.|(?!\1).)*?)\1/g;
	let match: RegExpExecArray | null;

	while ((match = literalPattern.exec(line)) !== null) {
		const literalStart = match.index;
		const literalEnd = literalStart + match[0].length;

		if (position.character < literalStart || position.character > literalEnd) {
			continue;
		}

		if (!isFilePathLike(decodeTypeScriptStringPath(match[2]).trim())) {
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

function resolveWorkspaceFileUri(rawPath: string, document: vscode.TextDocument): vscode.Uri | undefined {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return undefined;
	}

	const workspaceRoot = workspaceFolder.uri.fsPath;
	const decodedPath = decodeTypeScriptStringPath(rawPath).trim();
	if (!isFilePathLike(decodedPath)) {
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

function isFilePathLike(filePath: string): boolean {
	const extension = path.extname(filePath);
	return (
		filePath.length > 0 &&
		(/[\\/]/.test(filePath) || isWorkspaceFileType(filePath)) &&
		/^\.[A-Za-z0-9]{1,10}$/.test(extension) &&
		isWorkspaceFileType(filePath)
	);
}

function decodeTypeScriptStringPath(rawPath: string): string {
	return rawPath
		.replace(/\\\\/g, '\\')
		.replace(/\\\//g, '/')
		.replace(/\\"/g, '"')
		.replace(/\\'/g, '\'')
		.replace(/\\`/g, '`');
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

function createAssetCodeContext(
	_document: vscode.TextDocument,
	_match: FileLiteralMatch,
	fileUri: vscode.Uri
): AssetCodeContext {
	return {
		fileUri: fileUri.toString()
	};
}

async function createImagePreviewMarkdown(
	imageUri: vscode.Uri,
	assetContext: AssetCodeContext
): Promise<vscode.MarkdownString> {
	const commandUri = vscode.Uri.parse(
		`command:${OPEN_FILE_COMMAND}?${encodeURIComponent(JSON.stringify([imageUri.toString()]))}`
	);
	const markdown = new vscode.MarkdownString(undefined, true);
	const preview = await createImagePreview(imageUri);

	markdown.isTrusted = { enabledCommands: [OPEN_FILE_COMMAND, SEND_TO_CHATGPT_COMMAND] };
	markdown.supportHtml = true;
	markdown.appendMarkdown(
		`<img src="${escapeHtmlAttribute(preview.source)}" width="${preview.width}" height="${preview.height}" alt="${escapeHtmlAttribute(localize('image.alt'))}" />\n\n`
	);
	markdown.appendMarkdown(createActionLinks(commandUri, assetContext));

	return markdown;
}

function createPreviewErrorMarkdown(
	imageUri: vscode.Uri,
	message: string,
	assetContext: AssetCodeContext
): vscode.MarkdownString {
	const commandUri = vscode.Uri.parse(
		`command:${OPEN_FILE_COMMAND}?${encodeURIComponent(JSON.stringify([imageUri.toString()]))}`
	);
	const markdown = new vscode.MarkdownString(undefined, true);

	markdown.isTrusted = { enabledCommands: [OPEN_FILE_COMMAND, SEND_TO_CHATGPT_COMMAND] };
	markdown.appendMarkdown(`${localize('preview.failed', { detail: message })}\n\n`);
	markdown.appendMarkdown(createActionLinks(commandUri, assetContext));

	return markdown;
}

function createOpenFileMarkdown(fileUri: vscode.Uri, assetContext: AssetCodeContext): vscode.MarkdownString {
	const commandUri = vscode.Uri.parse(
		`command:${OPEN_FILE_COMMAND}?${encodeURIComponent(JSON.stringify([fileUri.toString()]))}`
	);
	const markdown = new vscode.MarkdownString(undefined, true);

	markdown.isTrusted = { enabledCommands: [OPEN_FILE_COMMAND, SEND_TO_CHATGPT_COMMAND] };
	markdown.appendMarkdown(createActionLinks(commandUri, assetContext));

	return markdown;
}

function createActionLinks(openFileCommandUri: vscode.Uri, assetContext: AssetCodeContext): string {
	const sendToChatGptCommandUri = vscode.Uri.parse(
		`command:${SEND_TO_CHATGPT_COMMAND}?${encodeURIComponent(JSON.stringify([assetContext.fileUri]))}`
	);

	return `[${localize('action.openFile')}](${openFileCommandUri.toString()}) | [${localize('action.sendToChatGpt')}](${sendToChatGptCommandUri.toString()})`;
}

async function createImagePreview(imageUri: vscode.Uri): Promise<ImagePreview> {
	const bytes = await vscode.workspace.fs.readFile(imageUri);
	const extension = path.extname(imageUri.fsPath).toLowerCase();

	if (extension === '.png') {
		const size = readPngSize(bytes);
		return {
			source: imageUri.toString(),
			...fitPreviewSize(size.width, size.height)
		};
	}

	if (extension === '.jpg' || extension === '.jpeg') {
		const size = readJpegSize(bytes);
		return {
			source: imageUri.toString(),
			...fitPreviewSize(size.width, size.height)
		};
	}

	if (extension === '.blp') {
		const blpImage = decodeBlpForPreview(bytes);
		const previewImage = resizeToFit(blpImage, PREVIEW_MAX_SIZE);
		const pngBytes = encodePng(previewImage.width, previewImage.height, previewImage.rgba);

		return {
			source: `data:image/png;base64,${pngBytes.toString('base64')}`,
			width: previewImage.width,
			height: previewImage.height
		};
	}

	if (extension !== '.tga') {
		throw new Error(localize('preview.unsupportedExtension', { extension }));
	}

	const tgaImage = decodeTga(bytes);
	const previewImage = resizeToFit(tgaImage, PREVIEW_MAX_SIZE);
	const pngBytes = encodePng(previewImage.width, previewImage.height, previewImage.rgba);

	return {
		source: `data:image/png;base64,${pngBytes.toString('base64')}`,
		width: previewImage.width,
		height: previewImage.height
	};
}

type RgbaImage = {
	width: number;
	height: number;
	rgba: Uint8Array;
};

type ImageSize = {
	width: number;
	height: number;
};

function readPngSize(bytes: Uint8Array): ImageSize {
	const data = Buffer.from(bytes);
	const pngSignature = '89504e470d0a1a0a';

	if (data.length < 24 || data.subarray(0, 8).toString('hex') !== pngSignature) {
		throw new Error(localize('png.incompleteHeader'));
	}

	return {
		width: data.readUInt32BE(16),
		height: data.readUInt32BE(20)
	};
}

function readJpegSize(bytes: Uint8Array): ImageSize {
	const data = Buffer.from(bytes);
	let offset = 2;

	if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
		throw new Error(localize('jpeg.incompleteHeader'));
	}

	while (offset < data.length) {
		while (data[offset] === 0xFF) {
			offset += 1;
		}

		const marker = data[offset++];
		if (marker === 0xD9 || marker === 0xDA) {
			break;
		}

		if (offset + 2 > data.length) {
			break;
		}

		const segmentLength = data.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > data.length) {
			break;
		}

		if (isJpegStartOfFrame(marker)) {
			return {
				height: data.readUInt16BE(offset + 3),
				width: data.readUInt16BE(offset + 5)
			};
		}

		offset += segmentLength;
	}

	throw new Error(localize('jpeg.unreadableSize'));
}

function isJpegStartOfFrame(marker: number): boolean {
	return [
		0xC0, 0xC1, 0xC2, 0xC3,
		0xC5, 0xC6, 0xC7,
		0xC9, 0xCA, 0xCB,
		0xCD, 0xCE, 0xCF
	].includes(marker);
}

function fitPreviewSize(width: number, height: number): ImageSize {
	const scale = Math.min(1, PREVIEW_MAX_SIZE / width, PREVIEW_MAX_SIZE / height);

	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

function resizeToFit(image: RgbaImage, maxSize: number): RgbaImage {
	const targetSize = fitPreviewSize(image.width, image.height);

	if (targetSize.width === image.width && targetSize.height === image.height) {
		return image;
	}

	const targetRgba = new Uint8Array(targetSize.width * targetSize.height * 4);

	for (let y = 0; y < targetSize.height; y++) {
		const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / targetSize.height));
		for (let x = 0; x < targetSize.width; x++) {
			const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / targetSize.width));
			const sourceOffset = (sourceY * image.width + sourceX) * 4;
			const targetOffset = (y * targetSize.width + x) * 4;

			targetRgba[targetOffset] = image.rgba[sourceOffset];
			targetRgba[targetOffset + 1] = image.rgba[sourceOffset + 1];
			targetRgba[targetOffset + 2] = image.rgba[sourceOffset + 2];
			targetRgba[targetOffset + 3] = image.rgba[sourceOffset + 3];
		}
	}

	return {
		width: targetSize.width,
		height: targetSize.height,
		rgba: targetRgba
	};
}

function decodeTga(bytes: Uint8Array): RgbaImage {
	if (bytes.length < 18) {
		throw new Error(localize('tga.incompleteHeader'));
	}

	const data = Buffer.from(bytes);
	const idLength = data[0];
	const colorMapType = data[1];
	const imageType = data[2];
	const width = data.readUInt16LE(12);
	const height = data.readUInt16LE(14);
	const bitsPerPixel = data[16];
	const imageDescriptor = data[17];
	const bytesPerPixel = bitsPerPixel / 8;

	if (colorMapType !== 0) {
		throw new Error(localize('tga.unsupportedPalette'));
	}

	if (![2, 3, 10, 11].includes(imageType)) {
		throw new Error(localize('tga.unsupportedType', { type: imageType }));
	}

	if (!Number.isInteger(bytesPerPixel) || ![1, 2, 3, 4].includes(bytesPerPixel)) {
		throw new Error(localize('tga.unsupportedBitDepth', { bits: bitsPerPixel }));
	}

	const pixelCount = width * height;
	const rgba = new Uint8Array(pixelCount * 4);
	let offset = 18 + idLength;
	let pixelIndex = 0;

	const originTop = (imageDescriptor & 0x20) !== 0;
	const originRight = (imageDescriptor & 0x10) !== 0;
	const isRle = imageType === 10 || imageType === 11;
	const isGrayscale = imageType === 3 || imageType === 11;

	const writePixel = (pixel: [number, number, number, number]) => {
		const sourceX = pixelIndex % width;
		const sourceY = Math.floor(pixelIndex / width);
		const targetX = originRight ? width - 1 - sourceX : sourceX;
		const targetY = originTop ? sourceY : height - 1 - sourceY;
		const targetOffset = (targetY * width + targetX) * 4;

		rgba[targetOffset] = pixel[0];
		rgba[targetOffset + 1] = pixel[1];
		rgba[targetOffset + 2] = pixel[2];
		rgba[targetOffset + 3] = pixel[3];
		pixelIndex += 1;
	};

	const readPixel = (): [number, number, number, number] => {
		if (offset + bytesPerPixel > data.length) {
			throw new Error(localize('tga.incompletePixelData'));
		}

		if (isGrayscale) {
			const value = data[offset];
			const alpha = bytesPerPixel === 2 ? data[offset + 1] : 255;
			offset += bytesPerPixel;
			return [value, value, value, alpha];
		}

		if (bytesPerPixel === 2) {
			const value = data.readUInt16LE(offset);
			offset += 2;
			const blue = Math.round((value & 0x1F) * 255 / 31);
			const green = Math.round(((value >> 5) & 0x1F) * 255 / 31);
			const red = Math.round(((value >> 10) & 0x1F) * 255 / 31);
			const alpha = (imageDescriptor & 0x0F) > 0 && (value & 0x8000) === 0 ? 0 : 255;
			return [red, green, blue, alpha];
		}

		const blue = data[offset];
		const green = data[offset + 1];
		const red = data[offset + 2];
		const alpha = bytesPerPixel === 4 ? data[offset + 3] : 255;
		offset += bytesPerPixel;
		return [red, green, blue, alpha];
	};

	while (pixelIndex < pixelCount) {
		if (!isRle) {
			writePixel(readPixel());
			continue;
		}

		if (offset >= data.length) {
			throw new Error(localize('tga.incompleteRleData'));
		}

		const packetHeader = data[offset++];
		const runLength = (packetHeader & 0x7F) + 1;

		if ((packetHeader & 0x80) !== 0) {
			const pixel = readPixel();
			for (let i = 0; i < runLength && pixelIndex < pixelCount; i++) {
				writePixel(pixel);
			}
		} else {
			for (let i = 0; i < runLength && pixelIndex < pixelCount; i++) {
				writePixel(readPixel());
			}
		}
	}

	return { width, height, rgba };
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
	const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (stride + 1);
		raw[rowStart] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
	}

	return Buffer.concat([
		signature,
		createPngChunk('IHDR', ihdr),
		createPngChunk('IDAT', zlib.deflateSync(raw)),
		createPngChunk('IEND', Buffer.alloc(0))
	]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	const crc = Buffer.alloc(4);

	length.writeUInt32BE(data.length, 0);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);

	return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes: Buffer): number {
	let crc = 0xFFFFFFFF;

	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
	}

	return (crc ^ 0xFFFFFFFF) >>> 0;
}

const CRC_TABLE = createCrcTable();

function createCrcTable(): number[] {
	const table: number[] = [];

	for (let i = 0; i < 256; i++) {
		let value = i;
		for (let bit = 0; bit < 8; bit++) {
			value = (value & 1) !== 0 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
		}
		table[i] = value >>> 0;
	}

	return table;
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
