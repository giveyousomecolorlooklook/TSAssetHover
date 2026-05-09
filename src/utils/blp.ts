import { localize } from '../messages';

export type BlpRgbaImage = {
	kind: 'rgba';
	width: number;
	height: number;
	rgba: Uint8Array;
};

export type BlpEncodedImage = {
	kind: 'encoded';
	width: number;
	height: number;
	mime: 'image/jpeg';
	bytes: Buffer;
};

export type BlpPreviewImage = BlpRgbaImage | BlpEncodedImage;

const BLP1_HEADER_SIZE = 156;
const BLP_PALETTE_SIZE = 256 * 4;
const MIPMAP_COUNT = 16;

export function decodeBlpForPreview(bytes: Uint8Array, maxSize: number): BlpPreviewImage {
	const data = Buffer.from(bytes);
	const magic = data.subarray(0, 4).toString('ascii');

	if (magic === 'BLP1') {
		return decodeBlp1(data, maxSize);
	}

	if (magic === 'BLP2') {
		throw new Error(localize('blp2.unsupportedPreview'));
	}

	throw new Error(localize('blp.invalidFile'));
}

function decodeBlp1(data: Buffer, maxSize: number): BlpPreviewImage {
	if (data.length < BLP1_HEADER_SIZE) {
		throw new Error(localize('blp1.incompleteHeader'));
	}

	const compression = data.readUInt32LE(4);
	const alphaBits = data.readUInt32LE(8);
	const width = data.readUInt32LE(12);
	const height = data.readUInt32LE(16);
	const pictureType = data.readUInt32LE(20);
	const pictureSubType = data.readUInt32LE(24);
	const mipmapOffsets = readUInt32Array(data, 28, MIPMAP_COUNT);
	const mipmapSizes = readUInt32Array(data, 92, MIPMAP_COUNT);

	if (width === 0 || height === 0) {
		throw new Error(localize('blp1.invalidSize'));
	}

	if (compression === 0) {
		return decodeBlp1Jpeg(data, width, height, maxSize, mipmapOffsets, mipmapSizes);
	}

	if (compression !== 1) {
		throw new Error(localize('blp1.unsupportedCompression', { compression }));
	}

	if (data.length < BLP1_HEADER_SIZE + BLP_PALETTE_SIZE) {
		throw new Error(localize('blp1.incompletePalette'));
	}

	// Warcraft III 常见 BLP1 RAW 图片通常是 pictureType 4/5，使用 256 色 BGRA 调色板。
	if (pictureType !== 4 && pictureType !== 5) {
		throw new Error(localize('blp1.unsupportedPictureType', { pictureType, pictureSubType }));
	}

	const mipmapLevel = chooseMipmapLevel(width, height, maxSize, mipmapOffsets, mipmapSizes);
	const mipmapWidth = getMipmapSize(width, mipmapLevel);
	const mipmapHeight = getMipmapSize(height, mipmapLevel);

	return decodeBlp1Paletted(
		data,
		mipmapWidth,
		mipmapHeight,
		alphaBits,
		mipmapOffsets[mipmapLevel],
		mipmapSizes[mipmapLevel]
	);
}

function decodeBlp1Jpeg(
	data: Buffer,
	width: number,
	height: number,
	maxSize: number,
	mipmapOffsets: number[],
	mipmapSizes: number[]
): BlpEncodedImage {
	if (data.length < BLP1_HEADER_SIZE + 4) {
		throw new Error(localize('blp1.jpegIncompleteHeader'));
	}

	const jpegHeaderSize = data.readUInt32LE(BLP1_HEADER_SIZE);
	const jpegHeaderOffset = BLP1_HEADER_SIZE + 4;
	const jpegHeaderEnd = jpegHeaderOffset + jpegHeaderSize;

	if (jpegHeaderEnd > data.length) {
		throw new Error(localize('blp1.jpegSharedHeaderOutOfRange'));
	}

	const mipmapLevel = chooseMipmapLevel(width, height, maxSize, mipmapOffsets, mipmapSizes);
	const mipmapOffset = mipmapOffsets[mipmapLevel];
	const mipmapSize = mipmapSizes[mipmapLevel];

	if (mipmapOffset === 0 && jpegHeaderSize === 0) {
		throw new Error(localize('blp1.jpegEmptyMipmap'));
	}

	if (mipmapOffset + mipmapSize > data.length) {
		throw new Error(localize('blp1.jpegIncompleteMipmap'));
	}

	const jpegHeader = data.subarray(jpegHeaderOffset, jpegHeaderEnd);
	const mipmapData = data.subarray(mipmapOffset, mipmapOffset + mipmapSize);
	const jpegBytes = stripAfterJpegEnd(Buffer.concat([jpegHeader, mipmapData]));

	return {
		kind: 'encoded',
		width: getMipmapSize(width, mipmapLevel),
		height: getMipmapSize(height, mipmapLevel),
		mime: 'image/jpeg',
		bytes: jpegBytes
	};
}

function decodeBlp1Paletted(
	data: Buffer,
	width: number,
	height: number,
	alphaBits: number,
	mipmapOffset: number,
	mipmapSize: number
): BlpRgbaImage {
	const pixelCount = width * height;
	const paletteOffset = BLP1_HEADER_SIZE;
	const imageOffset = mipmapOffset || BLP1_HEADER_SIZE + BLP_PALETTE_SIZE;
	const imageSize = mipmapSize || pixelCount;

	if (imageOffset + imageSize > data.length || imageOffset + pixelCount > data.length) {
		throw new Error(localize('blp1.incompletePixelData'));
	}

	const rgba = new Uint8Array(pixelCount * 4);
	const alphaOffset = imageOffset + pixelCount;
	const alphaByteCount = Math.max(0, imageSize - pixelCount);

	for (let i = 0; i < pixelCount; i++) {
		const paletteIndex = data[imageOffset + i];
		const paletteEntryOffset = paletteOffset + paletteIndex * 4;
		const targetOffset = i * 4;

		rgba[targetOffset] = data[paletteEntryOffset + 2];
		rgba[targetOffset + 1] = data[paletteEntryOffset + 1];
		rgba[targetOffset + 2] = data[paletteEntryOffset];
		rgba[targetOffset + 3] = readBlp1Alpha(data, alphaOffset, alphaByteCount, alphaBits, i);
	}

	return { kind: 'rgba', width, height, rgba };
}

function chooseMipmapLevel(
	width: number,
	height: number,
	maxSize: number,
	mipmapOffsets: number[],
	mipmapSizes: number[]
): number {
	let fallbackLevel = 0;

	for (let level = 0; level < MIPMAP_COUNT; level++) {
		if (mipmapOffsets[level] === 0 && mipmapSizes[level] === 0) {
			continue;
		}

		fallbackLevel = level;

		if (getMipmapSize(width, level) <= maxSize && getMipmapSize(height, level) <= maxSize) {
			return level;
		}
	}

	return fallbackLevel;
}

function getMipmapSize(size: number, level: number): number {
	return Math.max(1, size >> level);
}

function stripAfterJpegEnd(bytes: Buffer): Buffer {
	for (let i = bytes.length - 2; i >= 0; i--) {
		if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) {
			return bytes.subarray(0, i + 2);
		}
	}

	return bytes;
}

function readBlp1Alpha(data: Buffer, alphaOffset: number, alphaByteCount: number, alphaBits: number, pixelIndex: number): number {
	if (alphaBits === 0 || alphaByteCount === 0) {
		return 255;
	}

	// Some BLP1 writers use this field as a boolean alpha flag, while others store bit depth.
	// Prefer byte alpha when the mipmap contains enough alpha bytes because Warcraft III assets often do this.
	if (alphaByteCount >= pixelIndex + 1 && (alphaBits === 1 || alphaBits === 8 || alphaBits > 8)) {
		return data[alphaOffset + pixelIndex];
	}

	if (alphaBits === 4 && alphaByteCount >= Math.floor(pixelIndex / 2) + 1) {
		const packedAlpha = data[alphaOffset + Math.floor(pixelIndex / 2)];
		const value = pixelIndex % 2 === 0 ? packedAlpha & 0x0F : packedAlpha >> 4;
		return Math.round(value * 255 / 15);
	}

	if (alphaBits === 1 && alphaByteCount >= Math.floor(pixelIndex / 8) + 1) {
		const packedAlpha = data[alphaOffset + Math.floor(pixelIndex / 8)];
		return (packedAlpha & (1 << (pixelIndex % 8))) === 0 ? 0 : 255;
	}

	return 255;
}

function readUInt32Array(data: Buffer, offset: number, length: number): number[] {
	const values: number[] = [];

	for (let i = 0; i < length; i++) {
		values.push(data.readUInt32LE(offset + i * 4));
	}

	return values;
}
