import * as vscode from 'vscode';

type MessageKey =
	| 'action.openFile'
	| 'action.sendToChatGpt'
	| 'error.openFile'
	| 'warning.chatGptCommandMissing'
	| 'error.sendToChatGpt'
	| 'hover.fileNotFound'
	| 'image.alt'
	| 'preview.failed'
	| 'preview.unsupportedExtension'
	| 'png.incompleteHeader'
	| 'jpeg.incompleteHeader'
	| 'jpeg.unreadableSize'
	| 'tga.incompleteHeader'
	| 'tga.unsupportedPalette'
	| 'tga.unsupportedType'
	| 'tga.unsupportedBitDepth'
	| 'tga.incompletePixelData'
	| 'tga.incompleteRleData'
	| 'blp2.unsupportedPreview'
	| 'blp.invalidFile'
	| 'blp1.incompleteHeader'
	| 'blp1.invalidSize'
	| 'blp1.unsupportedCompression'
	| 'blp1.incompletePalette'
	| 'blp1.unsupportedPictureType'
	| 'blp1.jpegIncompleteHeader'
	| 'blp1.jpegSharedHeaderOutOfRange'
	| 'blp1.jpegEmptyMipmap'
	| 'blp1.jpegIncompleteMipmap'
	| 'blp1.incompletePixelData';

const MESSAGES: Record<MessageKey, { en: string; zh: string }> = {
	'action.openFile': {
		en: 'Open File',
		zh: '打开文件'
	},
	'action.sendToChatGpt': {
		en: 'Send to ChatGPT',
		zh: '发送到chatgpt'
	},
	'error.openFile': {
		en: 'Unable to open file: {detail}',
		zh: '无法打开文件：{detail}'
	},
	'warning.chatGptCommandMissing': {
		en: 'ChatGPT extension command chatgpt.addFileToThread was not found.',
		zh: '未找到 ChatGPT 插件命令 chatgpt.addFileToThread。'
	},
	'error.sendToChatGpt': {
		en: 'Failed to send file to ChatGPT: {detail}',
		zh: '发送文件给 ChatGPT 失败：{detail}'
	},
	'hover.fileNotFound': {
		en: 'File not found',
		zh: '文件未找到'
	},
	'image.alt': {
		en: 'Image preview',
		zh: '图片预览'
	},
	'preview.failed': {
		en: 'Image preview failed: {detail}',
		zh: '图片预览生成失败：{detail}'
	},
	'preview.unsupportedExtension': {
		en: 'Preview is not supported for {extension} files',
		zh: '暂不支持预览 {extension} 文件'
	},
	'png.incompleteHeader': {
		en: 'Incomplete PNG header',
		zh: 'PNG 文件头不完整'
	},
	'jpeg.incompleteHeader': {
		en: 'Incomplete JPEG header',
		zh: 'JPEG 文件头不完整'
	},
	'jpeg.unreadableSize': {
		en: 'Unable to read JPEG dimensions',
		zh: '无法读取 JPEG 尺寸'
	},
	'tga.incompleteHeader': {
		en: 'Incomplete TGA header',
		zh: 'TGA 文件头不完整'
	},
	'tga.unsupportedPalette': {
		en: 'Paletted TGA preview is not supported',
		zh: '暂不支持调色板 TGA 预览'
	},
	'tga.unsupportedType': {
		en: 'Unsupported TGA type: {type}',
		zh: '暂不支持的 TGA 类型：{type}'
	},
	'tga.unsupportedBitDepth': {
		en: 'Unsupported TGA bit depth: {bits}',
		zh: '暂不支持的 TGA 位深：{bits}'
	},
	'tga.incompletePixelData': {
		en: 'Incomplete TGA pixel data',
		zh: 'TGA 像素数据不完整'
	},
	'tga.incompleteRleData': {
		en: 'Incomplete TGA RLE data',
		zh: 'TGA RLE 数据不完整'
	},
	'blp2.unsupportedPreview': {
		en: 'BLP2 preview is not supported',
		zh: '暂不支持 BLP2 预览'
	},
	'blp.invalidFile': {
		en: 'Not a valid BLP file',
		zh: '不是有效的 BLP 文件'
	},
	'blp1.incompleteHeader': {
		en: 'Incomplete BLP1 header',
		zh: 'BLP1 文件头不完整'
	},
	'blp1.invalidSize': {
		en: 'Invalid BLP1 image dimensions',
		zh: 'BLP1 图片尺寸无效'
	},
	'blp1.unsupportedCompression': {
		en: 'Unsupported BLP1 compression type: {compression}',
		zh: '暂不支持的 BLP1 压缩类型：{compression}'
	},
	'blp1.incompletePalette': {
		en: 'Incomplete BLP1 palette data',
		zh: 'BLP1 调色板数据不完整'
	},
	'blp1.unsupportedPictureType': {
		en: 'Unsupported BLP1 picture type: {pictureType}/{pictureSubType}',
		zh: '暂不支持的 BLP1 图片类型：{pictureType}/{pictureSubType}'
	},
	'blp1.jpegIncompleteHeader': {
		en: 'Incomplete BLP1 JPEG header',
		zh: 'BLP1 JPEG 头不完整'
	},
	'blp1.jpegSharedHeaderOutOfRange': {
		en: 'BLP1 JPEG shared header is out of range',
		zh: 'BLP1 JPEG 共享头超出文件范围'
	},
	'blp1.jpegEmptyMipmap': {
		en: 'BLP1 JPEG mipmap data is empty',
		zh: 'BLP1 JPEG mipmap 数据为空'
	},
	'blp1.jpegIncompleteMipmap': {
		en: 'Incomplete BLP1 JPEG mipmap data',
		zh: 'BLP1 JPEG mipmap 数据不完整'
	},
	'blp1.incompletePixelData': {
		en: 'Incomplete BLP1 pixel data',
		zh: 'BLP1 像素数据不完整'
	}
};

export function localize(key: MessageKey, values: Record<string, string | number> = {}): string {
	const locale = vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
	const template = MESSAGES[key][locale];

	return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}
