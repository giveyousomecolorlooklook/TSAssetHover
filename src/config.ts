import * as path from 'path';

// 支持生成图片预览的文件类型。写法支持 "png"、".png"、"*.png" 和 "*"。
export const IMAGE_FILE_TYPES = ['png', 'jpg', 'jpeg', 'tga'];

// 支持在 hover 中提供“打开文件”链接的工作区文件类型。
// "*" 表示任何有扩展名的工作区文件都可以生成打开链接。
export const WORKSPACE_FILE_TYPES = ['*'];

export const PREVIEW_MAX_SIZE = 200;

export function isPreviewImageType(filePath: string): boolean {
	return matchesFileType(filePath, IMAGE_FILE_TYPES);
}

export function isWorkspaceFileType(filePath: string): boolean {
	return matchesFileType(filePath, WORKSPACE_FILE_TYPES);
}

function matchesFileType(filePath: string, patterns: readonly string[]): boolean {
	const extension = path.extname(filePath).toLowerCase();
	if (!extension) {
		return false;
	}

	return patterns.some((pattern) => {
		const normalizedPattern = normalizeFileTypePattern(pattern);
		return normalizedPattern === '*' || normalizedPattern === extension;
	});
}

function normalizeFileTypePattern(pattern: string): string {
	const trimmedPattern = pattern.trim().toLowerCase();

	if (trimmedPattern === '*' || trimmedPattern === '*.*') {
		return '*';
	}

	if (trimmedPattern.startsWith('*.')) {
		return trimmedPattern.slice(1);
	}

	return trimmedPattern.startsWith('.') ? trimmedPattern : `.${trimmedPattern}`;
}
