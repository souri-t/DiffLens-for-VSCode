import * as vscode from 'vscode';

// VS Code Git API types
export interface GitAPI {
	repositories: Repository[];
	getRepository(uri: vscode.Uri): Repository | null;
}

export interface Repository {
	rootUri: vscode.Uri;
	state: RepositoryState;
	getCommit(ref: string): Promise<Commit>;
	log(options?: LogOptions): Promise<Commit[]>;
	diff(cached?: boolean): Promise<Change[]>;
	diffWith(ref: string, path?: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path?: string): Promise<Change[]>;
	// Extended methods that might be available in VS Code Git API
	show?(ref: string, path?: string): Promise<string>;
	getObjectContent?(ref: string, path: string): Promise<string>;
	// Internal methods that might be available
	_model?: any;
	_repository?: any;
}

export interface RepositoryState {
	HEAD: Branch | undefined;
}

export interface Branch {
	name?: string;
	commit?: string;
}

export interface Commit {
	hash: string;
	message: string;
	authorDate?: Date;
	authorName?: string;
	authorEmail?: string;
}

export interface Change {
	uri: vscode.Uri;
	originalUri: vscode.Uri;
	status: Status;
	renameUri?: vscode.Uri;
}

export interface LogOptions {
	maxEntries?: number;
	reverse?: boolean;
}

export enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}

// Configuration interface
export interface ReviewConfig {
	systemPrompt: string;
	reviewPerspective: string;
	contextLines: number;
	excludeDeletes: boolean;
	llmProvider: 'bedrock' | 'vscode-lm';
	awsAccessKey: string;
	awsSecretKey: string;
	awsRegion: string;
	modelName: string;
	vscodeLmVendor: string;
	vscodeLmFamily: string;
	fileExtensions: string;
	maxFileSize: number;
	fileSizeUnit: 'KB' | 'MB';
	showExcludedFiles: boolean;
	excludedFileLimit: number;
	excludeBinaryFiles: boolean;
	binaryFileExtensions: string;
	textFileExtensions: string;
	binaryDetectionMethod: 'extension' | 'content' | 'both';
	binaryContentThreshold: number;
	defaultExportFormat: 'html' | 'json' | 'pdf';
	exportDirectory: string;
	exportFilenamePattern: string;
	exportTemplate: 'standard' | 'minimal' | 'detailed' | 'corporate';
	includeGitInfo: boolean;
	includeStatistics: boolean;
}

// Favorite Prompts interfaces
export interface FavoritePrompt {
	id: string;
	name: string;
	systemPrompt: string;
	reviewPerspective: string;
	createdAt: string;
	updatedAt: string;
	usage: {
		count: number;
		lastUsed: string;
	};
}

// File exclusion interfaces
export interface ExcludedFileInfo {
	path: string;
	size: number;
	reason: 'fileSize' | 'binary';
	readableSize: string;
}

export interface ExclusionSummary {
	excludedFiles: ExcludedFileInfo[];
	summary: {
		totalFiles: number;
		totalSize: number;
		readableTotalSize: string;
	};
}

// Export interfaces
export interface ExportData {
	exportInfo: {
		format: string;
		version: string;
		timestamp: string;
		generatedBy: string;
	};
	reviewMetadata: {
		modelName: string;
		provider: string;
		systemPrompt: string;
		reviewPerspective: string;
		reviewDuration: number;
		tokenUsage?: {
			input: number;
			output: number;
		};
	};
	diffConfiguration: {
		contextLines: number;
		excludeDeletes: boolean;
		fileExtensions: string;
		excludedFiles: string[];
		binaryFilesExcluded: boolean;
		maxFileSize: number;
	};
	gitInformation: {
		repository: string;
		owner?: string;
		currentBranch: string;
		targetBranch?: string;
		commitHash: string;
		commitMessage: string;
		author: string;
		commitDate: string;
		changedFiles: Array<{
			path: string;
			status: string;
			additions: number;
			deletions: number;
		}>;
	};
	reviewContent: {
		summary: {
			overallScore: string;
			criticalIssues: number;
			majorIssues: number;
			minorIssues: number;
			suggestions: number;
		};
		categories: Array<{
			name: string;
			severity: string;
			issueCount: number;
			items: Array<{
				title: string;
				description: string;
				file: string;
				line: number;
				severity: string;
				suggestion: string;
			}>;
		}>;
		fullReview: string;
		rawReview: string;
	};
	statistics: {
		filesAnalyzed: number;
		linesAnalyzed: number;
		filesExcluded: number;
		reviewWordCount: number;
	};
}

export interface ExportHistoryItem {
	timestamp: string;
	format: string;
	filename: string;
	path: string;
	size: number;
}

export interface ReviewResult {
	modelName: string;
	review: string;
}
