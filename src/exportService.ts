
import * as vscode from 'vscode';
import * as path from 'path';
import { ExportData, ExportHistoryItem, ReviewConfig, ReviewResult } from './types';

export class ExportService {
    private config: ReviewConfig;

    constructor(config: ReviewConfig) {
        this.config = config;
    }

    // Export review results to JSON format
    async exportToJson(
        reviewResult: ReviewResult,
        gitInfo: any,
        diffConfig: any,
        statistics: any,
        customFilePath?: string
    ): Promise<{ success: boolean; message: string; filePath?: string }> {
        try {
            const exportData = this.buildExportData(reviewResult, gitInfo, diffConfig, statistics, 'json');
            const json = JSON.stringify(exportData, null, 2);
            
            let filePath: string;
            let filename: string;
            
            if (customFilePath) {
                filePath = customFilePath;
                filename = path.basename(customFilePath);
                await this.saveToCustomFile(customFilePath, json);
            } else {
                filename = this.generateFilename('json');
                filePath = await this.saveToFile(filename, json);
            }

            await this.addToExportHistory('json', filename, filePath, json.length);

            return {
                success: true,
                message: `JSONファイルにエクスポートしました: ${filename}`,
                filePath
            };
        } catch (error) {
            return {
                success: false,
                message: `JSONエクスポートに失敗しました: ${error}`
            };
        }
    }

    // Export review results to HTML format
    async exportToHtml(
        reviewResult: ReviewResult,
        gitInfo: any,
        diffConfig: any,
        statistics: any,
        customFilePath?: string
    ): Promise<{ success: boolean; message: string; filePath?: string }> {
        try {
            const exportData = this.buildExportData(reviewResult, gitInfo, diffConfig, statistics, 'html');
            const html = this.generateHtmlReport(exportData);
            
            let filePath: string;
            let filename: string;
            
            if (customFilePath) {
                filePath = customFilePath;
                filename = path.basename(customFilePath);
                await this.saveToCustomFile(customFilePath, html);
            } else {
                filename = this.generateFilename('html');
                filePath = await this.saveToFile(filename, html);
            }

            await this.addToExportHistory('html', filename, filePath, html.length);

            return {
                success: true,
                message: `HTMLファイルにエクスポートしました: ${filename}`,
                filePath
            };
        } catch (error) {
            return {
                success: false,
                message: `HTMLエクスポートに失敗しました: ${error}`
            };
        }
    }

    // Build the complete export data structure
    private buildExportData(
        reviewResult: ReviewResult,
        gitInfo: any,
        diffConfig: any,
        statistics: any,
        format: string
    ): ExportData {
        const now = new Date().toISOString();
        
        return {
            exportInfo: {
                format,
                version: '1.0.0',
                timestamp: now,
                generatedBy: 'DiffLens v1.0.1'
            },
            reviewMetadata: {
                modelName: reviewResult.modelName,
                provider: this.config.llmProvider,
                systemPrompt: this.config.systemPrompt,
                reviewPerspective: this.config.reviewPerspective,
                reviewDuration: 0, // TODO: Track actual duration
                tokenUsage: {
                    input: 0, // TODO: Get from AI service
                    output: 0
                }
            },
            diffConfiguration: {
                contextLines: this.config.contextLines,
                excludeDeletes: this.config.excludeDeletes,
                fileExtensions: this.config.fileExtensions,
                excludedFiles: diffConfig?.excludedFiles || [],
                binaryFilesExcluded: this.config.excludeBinaryFiles,
                maxFileSize: this.config.maxFileSize
            },
            gitInformation: {
                repository: gitInfo?.repository || 'Unknown',
                owner: gitInfo?.owner,
                currentBranch: gitInfo?.currentBranch || 'Unknown',
                targetBranch: gitInfo?.targetBranch,
                commitHash: gitInfo?.commitHash || 'Unknown',
                commitMessage: gitInfo?.commitMessage || 'Unknown',
                author: gitInfo?.author || 'Unknown',
                commitDate: gitInfo?.commitDate || now,
                changedFiles: gitInfo?.changedFiles || []
            },
            reviewContent: {
                summary: this.parseReviewSummary(reviewResult.review),
                categories: this.parseReviewCategories(reviewResult.review),
                fullReview: reviewResult.review,
                rawReview: reviewResult.review
            },
            statistics: {
                filesAnalyzed: statistics?.filesAnalyzed || 0,
                linesAnalyzed: statistics?.linesAnalyzed || 0,
                filesExcluded: statistics?.filesExcluded || 0,
                reviewWordCount: this.countWords(reviewResult.review)
            }
        };
    }

    // Generate HTML report from export data
    private generateHtmlReport(exportData: ExportData): string {
        const template = this.getHtmlTemplate();
        
        // Replace template variables
        return template
            .replace('{{title}}', `Code Review Report - ${exportData.gitInformation.repository}`)
            .replace('{{timestamp}}', new Date(exportData.exportInfo.timestamp).toLocaleString())
            .replace('{{repository}}', exportData.gitInformation.repository)
            .replace('{{branch}}', exportData.gitInformation.currentBranch)
            .replace('{{commit}}', exportData.gitInformation.commitHash.substring(0, 8))
            .replace('{{author}}', exportData.gitInformation.author)
            .replace('{{modelName}}', exportData.reviewMetadata.modelName)
            .replace('{{provider}}', exportData.reviewMetadata.provider)
            .replace('{{filesAnalyzed}}', exportData.statistics.filesAnalyzed.toString())
            .replace('{{filesExcluded}}', exportData.statistics.filesExcluded.toString())
            .replace('{{reviewContent}}', this.formatReviewForHtml(exportData.reviewContent.fullReview))
            .replace('{{systemPrompt}}', this.escapeHtml(exportData.reviewMetadata.systemPrompt))
            .replace('{{reviewPerspective}}', this.escapeHtml(exportData.reviewMetadata.reviewPerspective))
            .replace('{{gitInfoSection}}', this.config.includeGitInfo ? this.generateGitInfoSection(exportData.gitInformation) : '')
            .replace('{{statisticsSection}}', this.config.includeStatistics ? this.generateStatisticsSection(exportData.statistics) : '')
            .replace('{{diffConfigSection}}', this.generateDiffConfigSection(exportData.diffConfiguration));
    }

    // Get HTML template based on configuration
    private getHtmlTemplate(): string {
        // For now, return the standard template. In the future, this could load different templates based on config.exportTemplate
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2em;
        }
        .metadata {
            display: flex;
            justify-content: space-around;
            margin-top: 20px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .metadata span {
            background: rgba(255,255,255,0.2);
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.9em;
        }
        .content {
            padding: 30px;
        }
        .section {
            margin-bottom: 40px;
            border-bottom: 1px solid #eee;
            padding-bottom: 20px;
        }
        .section:last-child {
            border-bottom: none;
        }
        .section h2 {
            color: #667eea;
            border-left: 4px solid #667eea;
            padding-left: 15px;
            margin-bottom: 20px;
        }
        .review-content {
            background: #f8f9fa;
            border-left: 4px solid #28a745;
            padding: 20px;
            border-radius: 4px;
            white-space: pre-wrap;
            font-family: 'Monaco', 'Consolas', monospace;
            line-height: 1.4;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .info-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 3px solid #667eea;
        }
        .info-card h3 {
            margin: 0 0 10px 0;
            color: #667eea;
            font-size: 1em;
        }
        .info-card p {
            margin: 0;
            font-family: monospace;
            background: white;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
        }
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            color: #666;
            font-size: 0.9em;
        }
        @media print {
            body { background: white; }
            .container { box-shadow: none; }
            .header { background: #667eea !important; }
        }
        .collapsible {
            background-color: #f1f1f1;
            color: #444;
            cursor: pointer;
            padding: 18px;
            width: 100%;
            border: none;
            text-align: left;
            outline: none;
            font-size: 15px;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        .collapsible:hover {
            background-color: #ddd;
        }
        .collapsible-content {
            padding: 0 18px;
            display: none;
            overflow: hidden;
            background-color: #f9f9f9;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        .collapsible.active + .collapsible-content {
            display: block;
            padding: 18px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>🔍 DiffLens Code Review Report</h1>
            <div class="metadata">
                <span>📅 {{timestamp}}</span>
                <span>📂 {{repository}}</span>
                <span>🌿 {{branch}}</span>
                <span>🤖 {{modelName}}</span>
                <span>⚡ {{provider}}</span>
            </div>
        </header>

        <div class="content">
            <section class="section">
                <h2>📊 Review Summary</h2>
                <div class="info-grid">
                    <div class="info-card">
                        <h3>Files Analyzed</h3>
                        <p>{{filesAnalyzed}} files</p>
                    </div>
                    <div class="info-card">
                        <h3>Files Excluded</h3>
                        <p>{{filesExcluded}} files</p>
                    </div>
                    <div class="info-card">
                        <h3>Commit Hash</h3>
                        <p>{{commit}}</p>
                    </div>
                    <div class="info-card">
                        <h3>Author</h3>
                        <p>{{author}}</p>
                    </div>
                </div>
            </section>

            <section class="section">
                <h2>📝 AI Review Results</h2>
                <div class="review-content">{{reviewContent}}</div>
            </section>

            {{gitInfoSection}}
            {{statisticsSection}}
            {{diffConfigSection}}

            <section class="section">
                <h2>⚙️ AI Configuration</h2>
                <button type="button" class="collapsible">System Prompt</button>
                <div class="collapsible-content">
                    <pre>{{systemPrompt}}</pre>
                </div>
                <button type="button" class="collapsible">Review Perspective</button>
                <div class="collapsible-content">
                    <pre>{{reviewPerspective}}</pre>
                </div>
            </section>
        </div>

        <footer class="footer">
            <p>Generated by DiffLens Extension | {{timestamp}}</p>
        </footer>
    </div>

    <script>
        // Make collapsible sections work
        document.querySelectorAll('.collapsible').forEach(button => {
            button.addEventListener('click', function() {
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                content.style.display = content.style.display === 'block' ? 'none' : 'block';
            });
        });
    </script>
</body>
</html>`;
    }

    // Generate filename based on pattern
    private generateFilename(format: string): string {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
        
        const pattern = this.config.exportFilenamePattern;
        const filename = pattern
            .replace('{timestamp}', timestamp)
            .replace('{repository}', 'difflens') // TODO: Get actual repo name
            .replace('{branch}', 'current'); // TODO: Get actual branch name

        return `${filename}.${format}`;
    }

    // Save content to file
    private async saveToFile(filename: string, content: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const exportDir = this.config.exportDirectory.startsWith('.') 
            ? path.join(workspaceFolder.uri.fsPath, this.config.exportDirectory)
            : this.config.exportDirectory;

        // Ensure export directory exists
        const exportDirUri = vscode.Uri.file(exportDir);
        try {
            await vscode.workspace.fs.createDirectory(exportDirUri);
        } catch (error) {
            // Directory might already exist, which is fine
        }

        const filePath = path.join(exportDir, filename);
        const fileUri = vscode.Uri.file(filePath);
        
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
        
        return filePath;
    }

    // Save content to a custom file path
    private async saveToCustomFile(filePath: string, content: string): Promise<void> {
        const fileUri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    }

    // Add export to history
    private async addToExportHistory(format: string, filename: string, filePath: string, size: number): Promise<void> {
        const config = vscode.workspace.getConfiguration('diffLens');
        const history = config.get<ExportHistoryItem[]>('exportHistory', []);

        const newItem: ExportHistoryItem = {
            timestamp: new Date().toISOString(),
            format,
            filename,
            path: filePath,
            size
        };

        // Add to beginning and keep only last 20 items
        const updatedHistory = [newItem, ...history].slice(0, 20);
        
        await config.update('exportHistory', updatedHistory, vscode.ConfigurationTarget.Global);
    }

    // Helper methods for parsing review content
    private parseReviewSummary(review: string): any {
        // Simple summary parsing - in a real implementation, this could be more sophisticated
        return {
            overallScore: 'Good',
            criticalIssues: 0,
            majorIssues: 0,
            minorIssues: 0,
            suggestions: 0
        };
    }

    private parseReviewCategories(review: string): any[] {
        // Simple category parsing - in a real implementation, this could parse structured reviews
        return [];
    }

    private countWords(text: string): number {
        return text.split(/\s+/).filter(word => word.length > 0).length;
    }

    private formatReviewForHtml(review: string): string {
        // Convert markdown-like formatting to HTML
        return this.escapeHtml(review)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private generateGitInfoSection(gitInfo: any): string {
        return `
            <section class="section">
                <h2>🔄 Git Information</h2>
                <div class="info-grid">
                    <div class="info-card">
                        <h3>Repository</h3>
                        <p>${gitInfo.repository}</p>
                    </div>
                    <div class="info-card">
                        <h3>Current Branch</h3>
                        <p>${gitInfo.currentBranch}</p>
                    </div>
                    <div class="info-card">
                        <h3>Commit Hash</h3>
                        <p>${gitInfo.commitHash}</p>
                    </div>
                    <div class="info-card">
                        <h3>Commit Message</h3>
                        <p>${gitInfo.commitMessage}</p>
                    </div>
                </div>
            </section>
        `;
    }

    private generateStatisticsSection(statistics: any): string {
        return `
            <section class="section">
                <h2>📈 Statistics</h2>
                <div class="info-grid">
                    <div class="info-card">
                        <h3>Files Analyzed</h3>
                        <p>${statistics.filesAnalyzed}</p>
                    </div>
                    <div class="info-card">
                        <h3>Lines Analyzed</h3>
                        <p>${statistics.linesAnalyzed}</p>
                    </div>
                    <div class="info-card">
                        <h3>Files Excluded</h3>
                        <p>${statistics.filesExcluded}</p>
                    </div>
                    <div class="info-card">
                        <h3>Review Word Count</h3>
                        <p>${statistics.reviewWordCount}</p>
                    </div>
                </div>
            </section>
        `;
    }

    private generateDiffConfigSection(diffConfig: any): string {
        return `
            <section class="section">
                <h2>⚙️ Diff Configuration</h2>
                <div class="info-grid">
                    <div class="info-card">
                        <h3>Context Lines</h3>
                        <p>${diffConfig.contextLines}</p>
                    </div>
                    <div class="info-card">
                        <h3>Exclude Deletes</h3>
                        <p>${diffConfig.excludeDeletes ? 'Yes' : 'No'}</p>
                    </div>
                    <div class="info-card">
                        <h3>File Extensions</h3>
                        <p>${diffConfig.fileExtensions || 'All files'}</p>
                    </div>
                    <div class="info-card">
                        <h3>Max File Size</h3>
                        <p>${this.formatFileSize(diffConfig.maxFileSize)}</p>
                    </div>
                </div>
            </section>
        `;
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return 'No limit';
        
        const units = ['B', 'KB', 'MB', 'GB'];
        const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = bytes / Math.pow(1024, unitIndex);
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    // Get export history
    static getExportHistory(): ExportHistoryItem[] {
        const config = vscode.workspace.getConfiguration('diffLens');
        return config.get<ExportHistoryItem[]>('exportHistory', []);
    }

    // Clear export history
    static async clearExportHistory(): Promise<void> {
        const config = vscode.workspace.getConfiguration('diffLens');
        await config.update('exportHistory', [], vscode.ConfigurationTarget.Global);
    }
}

