
import * as vscode from 'vscode';
import * as path from 'path';
import { ExcludedFileInfo, ExclusionSummary, ReviewConfig } from './types';

export class FileFilterService {
    private config: ReviewConfig;

    constructor(config: ReviewConfig) {
        this.config = config;
    }

    // Check if a file should be excluded based on size
    async checkFileSize(filePath: string): Promise<{ excluded: boolean; size: number; readableSize: string }> {
        try {
            if (this.config.maxFileSize <= 0) {
                // No size limit
                return { excluded: false, size: 0, readableSize: '0 B' };
            }

            const stats = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            const size = stats.size;
            const readableSize = this.formatFileSize(size);

            const excluded = size > this.config.maxFileSize;
            return { excluded, size, readableSize };
        } catch (error) {
            // If file can't be read, consider it excluded
            return { excluded: true, size: 0, readableSize: '0 B' };
        }
    }

    // Check if a file is binary based on extension and/or content
    async isBinaryFile(filePath: string): Promise<{ isBinary: boolean; reason: string }> {
        if (!this.config.excludeBinaryFiles) {
            return { isBinary: false, reason: 'binary exclusion disabled' };
        }

        const ext = path.extname(filePath).toLowerCase();
        const binaryExtensions = this.parseBinaryExtensions(this.config.binaryFileExtensions);
        const textExtensions = this.parseBinaryExtensions(this.config.textFileExtensions);

        // Check text file extensions first (higher priority)
        if (textExtensions.includes(ext)) {
            return { isBinary: false, reason: 'text extension whitelist' };
        }

        switch (this.config.binaryDetectionMethod) {
            case 'extension':
                return this.checkByExtension(ext, binaryExtensions);
            
            case 'content':
                return await this.checkByContent(filePath);
            
            case 'both':
                // Check extension first
                const extResult = this.checkByExtension(ext, binaryExtensions);
                if (extResult.isBinary) {
                    return extResult;
                }
                // If extension says it's not binary, check content
                return await this.checkByContent(filePath);
            
            default:
                return { isBinary: false, reason: 'unknown detection method' };
        }
    }

    // Check binary status by file extension
    private checkByExtension(ext: string, binaryExtensions: string[]): { isBinary: boolean; reason: string } {
        const isBinary = binaryExtensions.includes(ext);
        return {
            isBinary,
            reason: isBinary ? 'binary extension' : 'non-binary extension'
        };
    }

    // Check binary status by file content
    private async checkByContent(filePath: string): Promise<{ isBinary: boolean; reason: string }> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            
            // Read first 512 bytes for binary detection
            const sample = content.slice(0, Math.min(512, content.length));
            
            if (sample.length === 0) {
                return { isBinary: false, reason: 'empty file' };
            }

            // Count non-ASCII characters and null bytes
            let nonAsciiCount = 0;
            for (const byte of sample) {
                if (byte > 127 || byte === 0) {
                    nonAsciiCount++;
                }
            }

            const binaryRatio = nonAsciiCount / sample.length;
            const isBinary = binaryRatio > this.config.binaryContentThreshold;

            return {
                isBinary,
                reason: `content analysis (${(binaryRatio * 100).toFixed(1)}% non-ASCII)`
            };
        } catch (error) {
            // If can't read file, assume it's binary
            return { isBinary: true, reason: 'content read error' };
        }
    }

    // Parse binary extensions string into array
    private parseBinaryExtensions(extensionsString: string): string[] {
        return extensionsString
            .split(',')
            .map(ext => ext.trim().toLowerCase())
            .filter(ext => ext.length > 0)
            .map(ext => ext.startsWith('.') ? ext : `.${ext}`);
    }

    // Filter a list of file paths and return exclusion summary
    async filterFiles(filePaths: string[]): Promise<{
        includedFiles: string[];
        exclusionSummary: ExclusionSummary;
    }> {
        const includedFiles: string[] = [];
        const excludedFiles: ExcludedFileInfo[] = [];
        let totalExcludedSize = 0;

        for (const filePath of filePaths) {
            let excluded = false;
            let excludeReason: 'fileSize' | 'binary' = 'fileSize';
            let fileSize = 0;
            let readableSize = '0 B';

            // Check file size
            const sizeCheck = await this.checkFileSize(filePath);
            if (sizeCheck.excluded) {
                excluded = true;
                excludeReason = 'fileSize';
                fileSize = sizeCheck.size;
                readableSize = sizeCheck.readableSize;
            } else {
                fileSize = sizeCheck.size;
                readableSize = sizeCheck.readableSize;

                // Check if binary (only if not already excluded by size)
                const binaryCheck = await this.isBinaryFile(filePath);
                if (binaryCheck.isBinary) {
                    excluded = true;
                    excludeReason = 'binary';
                }
            }

            if (excluded) {
                excludedFiles.push({
                    path: filePath,
                    size: fileSize,
                    reason: excludeReason,
                    readableSize: readableSize
                });
                totalExcludedSize += fileSize;
            } else {
                includedFiles.push(filePath);
            }
        }

        // Limit excluded files list if too long
        const limitedExcludedFiles = excludedFiles.slice(0, this.config.excludedFileLimit);

        const exclusionSummary: ExclusionSummary = {
            excludedFiles: limitedExcludedFiles,
            summary: {
                totalFiles: excludedFiles.length,
                totalSize: totalExcludedSize,
                readableTotalSize: this.formatFileSize(totalExcludedSize)
            }
        };

        return { includedFiles, exclusionSummary };
    }

    // Format file size for human reading
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = bytes / Math.pow(1024, unitIndex);
        
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    // Convert user-friendly file size to bytes
    static parseFileSize(sizeStr: string, unit: 'KB' | 'MB'): number {
        const size = parseFloat(sizeStr);
        if (isNaN(size)) return 0;
        
        switch (unit) {
            case 'KB':
                return size * 1024;
            case 'MB':
                return size * 1024 * 1024;
            default:
                return size;
        }
    }

    // Convert bytes to user-friendly size in specified unit
    static formatToUnit(bytes: number, unit: 'KB' | 'MB'): string {
        switch (unit) {
            case 'KB':
                return (bytes / 1024).toFixed(1);
            case 'MB':
                return (bytes / 1024 / 1024).toFixed(1);
            default:
                return bytes.toString();
        }
    }

    // Get file statistics by type
    getFileStatsByType(excludedFiles: ExcludedFileInfo[]): { [category: string]: { count: number; size: number } } {
        const stats: { [category: string]: { count: number; size: number } } = {};

        for (const file of excludedFiles) {
            const ext = path.extname(file.path).toLowerCase();
            let category = 'Other';

            // Categorize by file type
            const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.ico', '.raw'];
            const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'];
            const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
            const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'];
            const executableExts = ['.exe', '.dll', '.so', '.dylib', '.app', '.deb', '.rpm'];
            const fontExts = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];
            const documentExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];

            if (imageExts.includes(ext)) {
                category = 'Images';
            } else if (videoExts.includes(ext)) {
                category = 'Videos';
            } else if (audioExts.includes(ext)) {
                category = 'Audio';
            } else if (archiveExts.includes(ext)) {
                category = 'Archives';
            } else if (executableExts.includes(ext)) {
                category = 'Executables';
            } else if (fontExts.includes(ext)) {
                category = 'Fonts';
            } else if (documentExts.includes(ext)) {
                category = 'Documents';
            }

            if (!stats[category]) {
                stats[category] = { count: 0, size: 0 };
            }

            stats[category].count++;
            stats[category].size += file.size;
        }

        return stats;
    }

    // Generate exclusion report
    generateExclusionReport(exclusionSummary: ExclusionSummary): string {
        if (exclusionSummary.excludedFiles.length === 0) {
            return 'No files were excluded.';
        }

        const { excludedFiles, summary } = exclusionSummary;
        const fileStats = this.getFileStatsByType(excludedFiles);

        let report = `## Excluded Files Report\n\n`;
        report += `**Total Excluded:** ${summary.totalFiles} files (${summary.readableTotalSize})\n\n`;

        // File type statistics
        report += `### Exclusion by Type\n\n`;
        for (const [category, stats] of Object.entries(fileStats)) {
            const readableSize = this.formatFileSize(stats.size);
            report += `- **${category}:** ${stats.count} files (${readableSize})\n`;
        }

        // Detailed file list (limited)
        if (excludedFiles.length > 0) {
            report += `\n### Excluded Files\n\n`;
            for (const file of excludedFiles.slice(0, 20)) { // Show max 20 files
                const reason = file.reason === 'fileSize' ? 'Size limit' : 'Binary file';
                report += `- \`${file.path}\` - ${file.readableSize} (${reason})\n`;
            }

            if (excludedFiles.length > 20) {
                report += `\n... and ${excludedFiles.length - 20} more files.\n`;
            }
        }

        return report;
    }
}

