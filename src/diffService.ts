import * as vscode from 'vscode';
import { Status, Change, Repository, Commit } from './types';
import { getGitRepository, getChangesFromGitAPI } from './gitService';
import { logGitOperation } from './logger';

const jsdiff = require('diff');

// Advanced file content reconstruction using VS Code Git API
// This function attempts to get accurate file content by leveraging all available VS Code Git capabilities
async function getAdvancedFileContent(repository: Repository, commitHash: string, relativeFilePath: string): Promise<string> {
	try {
		// For HEAD, read current file directly
		if (commitHash === 'HEAD') {
			const fileUri = vscode.Uri.joinPath(repository.rootUri, relativeFilePath);
			try {
				const content = await vscode.workspace.fs.readFile(fileUri);
				return Buffer.from(content).toString('utf8');
			} catch {
				return '';
			}
		}

		// Try multiple VS Code Git URI schemes
		const gitUriSchemes = [
			// Standard git scheme with path and ref
			`git:/${relativeFilePath}?${commitHash}`,
			// Alternative scheme with repository path
			`git:${repository.rootUri.fsPath}/${relativeFilePath}?${commitHash}`,
			// Scheme with ref parameter
			`git:${relativeFilePath}?ref=${commitHash}`,
			// Scheme with different parameter format
			`git:${relativeFilePath}?${encodeURIComponent(commitHash)}`,
		];

		// Try each URI scheme
		for (const uriString of gitUriSchemes) {
			try {
				const gitUri = vscode.Uri.parse(uriString);
				logGitOperation(`Trying git URI scheme: ${uriString} for ${relativeFilePath}`);
				
				// Check if any open text document matches this git URI
				const existingDoc = vscode.workspace.textDocuments.find(doc => 
					doc.uri.scheme === 'git' && 
					doc.uri.path.endsWith(relativeFilePath) &&
					(doc.uri.query.includes(commitHash) || doc.uri.fragment.includes(commitHash))
				);
				
				if (existingDoc) {
					logGitOperation(`Found existing git document for ${relativeFilePath} at ${commitHash}`);
					return existingDoc.getText();
				}

				// Try to open the document using the git scheme
				try {
					const gitDoc = await vscode.workspace.openTextDocument(gitUri);
					if (gitDoc && gitDoc.getText()) {
						logGitOperation(`Successfully opened git document for ${relativeFilePath} at ${commitHash} using scheme: ${uriString}`);
						return gitDoc.getText();
					}
				} catch (openError) {
					logGitOperation(`Failed to open git document with scheme ${uriString}`, openError);
				}

			} catch (parseError) {
				logGitOperation(`Failed to parse git URI ${uriString}`, parseError);
			}
		}

		// Try to access the SCM (Source Control Management) API
		try {
			const scm = vscode.scm.createSourceControl('git', 'Git', repository.rootUri);
			// Check if SCM has a way to get file content at revision
			if ((scm as any).getContent) {
				const content = await (scm as any).getContent(relativeFilePath, commitHash);
				if (content) {
					logGitOperation(`Successfully got content using SCM API for ${relativeFilePath}`);
					return content;
				}
			}
		} catch (scmError) {
			logGitOperation(`SCM API approach failed for ${relativeFilePath}`, scmError);
		}

		// Fallback: return empty content to indicate historical content is not available
		logGitOperation(`Could not retrieve historical content for ${relativeFilePath} at ${commitHash}, returning empty content`);
		return '';
		
	} catch (error) {
		logGitOperation(`Error in advanced file content retrieval for ${relativeFilePath}`, error);
		return '';
	}
}

// Get file content at a specific commit using enhanced VS Code Git API methods
async function getFileContentAtCommit(repository: Repository, commitHash: string, relativeFilePath: string, workspacePath: string): Promise<string> {
	try {
		// Try the enhanced API methods first
		if (repository.show) {
			try {
				const content = await repository.show(commitHash, relativeFilePath);
				if (content) {
					logGitOperation(`Successfully got content using repository.show for ${relativeFilePath}`);
					return content;
				}
			} catch (error) {
				logGitOperation(`repository.show failed for ${relativeFilePath}`, error);
			}
		}

		if (repository.getObjectContent) {
			try {
				const content = await repository.getObjectContent(commitHash, relativeFilePath);
				if (content) {
					logGitOperation(`Successfully got content using repository.getObjectContent for ${relativeFilePath}`);
					return content;
				}
			} catch (error) {
				logGitOperation(`repository.getObjectContent failed for ${relativeFilePath}`, error);
			}
		}

		// Try to access internal repository methods
		if ((repository as any)._model || (repository as any)._repository) {
			try {
				const internalRepo = (repository as any)._model || (repository as any)._repository;
				logGitOperation(`Found internal repository object for ${relativeFilePath}`, {
					hasShow: typeof internalRepo.show === 'function',
					hasGetContent: typeof internalRepo.getContent === 'function',
					hasGetObjectContent: typeof internalRepo.getObjectContent === 'function',
					methods: Object.getOwnPropertyNames(internalRepo).filter(name => typeof internalRepo[name] === 'function')
				});

				// Try various internal methods that might exist
				const methodsToTry = ['show', 'getContent', 'getObjectContent', 'cat', 'getFileContent'];
				for (const methodName of methodsToTry) {
					if (typeof internalRepo[methodName] === 'function') {
						try {
							let content;
							if (methodName === 'show') {
								content = await internalRepo[methodName](`${commitHash}:${relativeFilePath}`);
							} else {
								content = await internalRepo[methodName](commitHash, relativeFilePath);
							}
							
							if (content && typeof content === 'string') {
								logGitOperation(`Successfully got content using internal ${methodName} for ${relativeFilePath}`);
								return content;
							}
						} catch (methodError) {
							logGitOperation(`Internal method ${methodName} failed for ${relativeFilePath}`, methodError);
						}
					}
				}
			} catch (error) {
				logGitOperation(`Failed to access internal repository methods for ${relativeFilePath}`, error);
			}
		}

		// Fallback to the advanced file content method
		return await getAdvancedFileContent(repository, commitHash, relativeFilePath);
	} catch (error) {
		logGitOperation(`Error in enhanced file content retrieval for ${relativeFilePath}`, error);
		return await getAdvancedFileContent(repository, commitHash, relativeFilePath);
	}
}

// Parse file extensions filter and return pathspec arguments
export function parseFileExtensionsFilter(fileExtensions: string): string[] {
	if (!fileExtensions || !fileExtensions.trim()) {
		logGitOperation('parseFileExtensionsFilter: No file extensions provided');
		return [];
	}
	
	logGitOperation('parseFileExtensionsFilter: Input fileExtensions', fileExtensions);
	
	// Split by comma, semicolon, or space and trim whitespace
	const extensions = fileExtensions.split(/[,;\s]+/).map(ext => ext.trim()).filter(ext => ext);
	logGitOperation('parseFileExtensionsFilter: Parsed extensions array', extensions);
	
	// Process each extension to ensure it's in the correct format for git pathspec
	const result: string[] = [];
	
	extensions.forEach(ext => {
		// If it already looks like a complex pathspec (contains ** or /), use as-is
		if (ext.includes('**') || ext.includes('/')) {
			logGitOperation(`parseFileExtensionsFilter: Using complex pathspec as-is: ${ext}`);
			result.push(ext);
			return;
		}
		
		// For simple patterns, generate both direct and recursive patterns
		let basePattern: string;
		
		if (ext.startsWith('*')) {
			// Already has wildcard, use as-is for direct pattern
			basePattern = ext;
		} else if (ext.startsWith('.')) {
			// Convert .ext to *.ext
			basePattern = `*${ext}`;
		} else {
			// Just extension name, convert to *.ext
			basePattern = `*.${ext}`;
		}
		
		// Add both patterns: direct (*.ext) and recursive (**/*.ext)
		const directPattern = basePattern;
		const recursivePattern = `**/${basePattern}`;
		
		result.push(directPattern);
		result.push(recursivePattern);
		
		logGitOperation(`parseFileExtensionsFilter: Added patterns for ${ext}`, {
			direct: directPattern,
			recursive: recursivePattern
		});
	});
	
	logGitOperation('parseFileExtensionsFilter: Final pathspecs (direct + recursive)', result);
	return result;
}

// Convert git diff output to markdown format for better readability
export function formatDiffAsMarkdown(diff: string): string {
	const lines = diff.split('\n');
	const result: string[] = [];
	let currentFile = '';
	let inFileHeader = false;
	let fileContent: string[] = [];
	
	// Helper function to process accumulated file content
	const processFileContent = () => {
		if (currentFile && fileContent.length > 0) {
			result.push(`## ${currentFile}`);
			result.push('');
			result.push('```diff');
			result.push(...fileContent);
			result.push('```');
			result.push('');
		}
	};
	
	for (const line of lines) {
		// Check for file header patterns
		if (line.startsWith('diff --git ')) {
			// Process previous file if exists
			processFileContent();
			
			// Extract file paths from "diff --git a/path b/path"
			const match = line.match(/diff --git a\/(.+) b\/(.+)/);
			if (match) {
				currentFile = match[2]; // Use the "b/" path (destination)
			} else {
				currentFile = 'Unknown file';
			}
			fileContent = [];
			inFileHeader = true;
			continue;
		}
		
		// Skip git metadata lines but keep tracking file headers
		if (line.startsWith('index ') || 
			line.startsWith('--- ') || 
			line.startsWith('+++ ')) {
			continue;
		}
		
		// Add content lines to current file
		if (currentFile) {
			inFileHeader = false;
			fileContent.push(line);
		}
	}
	
	// Process the last file
	processFileContent();
	
	// If no files were processed, return original diff in a code block
	if (result.length === 0) {
		return `\`\`\`diff\n${diff}\n\`\`\``;
	}
	
	return result.join('\n');
}

// Generate git diff using only the VS Code Git API (no native git command)
// The output format and filtering must match the native git diff --unified=<n> output as closely as possible
export async function generateNativeGitDiff(
	workspacePath: string,
	compareToCommit: string | null,
	contextLines: number = 50,
	excludeDeletes: boolean = true,
	fileExtensions: string = ''
): Promise<string> {
	try {
		logGitOperation('generateNativeGitDiff (GitAPI): Starting with parameters', {
			workspacePath,
			compareToCommit: compareToCommit ? compareToCommit.substring(0, 8) : 'previous commit',
			contextLines,
			excludeDeletes,
			fileExtensions
		});

		// Find the workspace folder and repository
		const workspaceFolder = vscode.workspace.workspaceFolders?.find(
			f => f.uri.fsPath === workspacePath
		);
		if (!workspaceFolder) {
			throw new Error('Workspace folder not found');
		}
		const repository = await getGitRepository(workspaceFolder);
		if (!repository) {
			throw new Error('Git repository not found');
		}

		// Determine the commit range
		let fromCommit = compareToCommit;
		let toCommit = 'HEAD';
		if (!fromCommit) {
			// Default: previous commit to HEAD
			const log = await repository.log({ maxEntries: 2 });
			if (log.length < 2) {
				throw new Error('Not enough commits to compare');
			}
			fromCommit = log[1].hash;
		}

		// Get changes between commits
		const changes = await getChangesFromGitAPI(repository, fromCommit, toCommit);

		// Filter by file extension if needed
		let filteredChanges = changes;
		if (fileExtensions) {
			const pathspecs = parseFileExtensionsFilter(fileExtensions);
			filteredChanges = changes.filter(change => {
				const rel = vscode.workspace.asRelativePath(change.uri);
				return pathspecs.some(pattern => {
					// Simple glob-like matching for *.ext and **/*.ext
					if (pattern.startsWith('**/')) {
						const ext = pattern.replace('**/', '');
						return rel.endsWith(ext.replace('*', ''));
					}
					if (pattern.startsWith('*')) {
						return rel.endsWith(pattern.replace('*', ''));
					}
					return rel.endsWith(pattern);
				});
			});
		}

		// Exclude deleted files if requested
		if (excludeDeletes) {
			filteredChanges = filteredChanges.filter(change =>
				change.status !== Status.DELETED && change.status !== Status.INDEX_DELETED
			);
		}

		if (filteredChanges.length === 0) {
			const filterInfo = fileExtensions ? ` with filter "${fileExtensions}"` : '';
			const compareInfo = compareToCommit ? ` between commit ${compareToCommit.substring(0, 8)} and HEAD` : ' in the latest commit';
			throw new Error(`No changes found${compareInfo}${filterInfo}`);
		}

		// Generate diff output for each file
		const diffs: string[] = [];
		
		// Try to get the commit object for more detailed diff information
		let commit: Commit | undefined;
		try {
			const commits = await repository.log({ maxEntries: 100 });
			commit = commits.find(c => c.hash.startsWith(fromCommit));
			logGitOperation(`Found commit for detailed diff`, { 
				commitHash: commit?.hash?.substring(0, 8),
				commitMessage: commit?.message?.substring(0, 50)
			});
		} catch (error) {
			logGitOperation(`Failed to get commit object for detailed diff`, error);
		}
		
		for (const change of filteredChanges) {
			const relPath = vscode.workspace.asRelativePath(change.uri);
			const oldPath = relPath;
			const newPath = relPath;

			logGitOperation(`Processing file: ${relPath}`, { 
				status: change.status,
				fromCommit: fromCommit.substring(0, 8),
				toCommit 
			});

			// For added files, create a proper addition diff that matches git show format
			if (change.status === Status.INDEX_ADDED || change.status === Status.ADDED_BY_US) {
				try {
					const fileUri = vscode.Uri.joinPath(repository.rootUri, relPath);
					const content = await vscode.workspace.fs.readFile(fileUri);
					const newContent = Buffer.from(content).toString('utf8');
					const lines = newContent.split('\n');
					
					let result = `diff --git a/${oldPath} b/${newPath}\n`;
					result += `new file mode 100644\n`;
					result += `index 0000000..0000000\n`;
					result += `--- /dev/null\n`;
					result += `+++ b/${newPath}\n`;
					
					// If file is not empty, add the content with proper hunk header
					if (newContent.trim()) {
						result += `@@ -0,0 +1,${lines.length} @@\n`;
						for (const line of lines) {
							result += `+${line}\n`;
						}
					} else {
						// Empty file
						result += `@@ -0,0 +1 @@\n`;
						result += `+\n`;
					}
					
					diffs.push(result.trim());
					logGitOperation(`Generated git show style addition diff for ${relPath}`, {
						linesAdded: lines.length,
						isEmpty: !newContent.trim(),
						hasHeader: result.includes('new file mode'),
						diffLength: result.length
					});
					continue;
				} catch (error) {
					logGitOperation(`Failed to generate addition diff for ${relPath}`, error);
				}
			}

			// For modified files, try to get actual diff using VS Code Git API
			if (change.status === Status.MODIFIED || change.status === Status.INDEX_MODIFIED) {
				try {
					// Try different approaches to get actual diff content
					let diffContent = '';
					
					// Approach 1: Use repository's diffBetween method if available
					if (repository.diffBetween) {
						try {
							const diffChanges = await repository.diffBetween(fromCommit, 'HEAD', relPath);
							if (diffChanges && diffChanges.length > 0) {
								logGitOperation(`Found ${diffChanges.length} diff changes using diffBetween for ${relPath}`);
								// Check if the changes contain the actual diff text
								for (const diffChange of diffChanges) {
									if ((diffChange as any).patch || (diffChange as any).diff) {
										diffContent = (diffChange as any).patch || (diffChange as any).diff;
										logGitOperation(`Found patch/diff content in diffBetween result for ${relPath}`);
										break;
									}
								}
							}
						} catch (diffError) {
							logGitOperation(`diffBetween failed for ${relPath}`, diffError);
						}
					}
					
					// Approach 2: Use repository's diffWith method
					if (!diffContent && repository.diffWith) {
						try {
							const diffChanges = await repository.diffWith(fromCommit, relPath);
							if (diffChanges && diffChanges.length > 0) {
								logGitOperation(`Found ${diffChanges.length} diff changes using diffWith for ${relPath}`);
								// Check if the changes contain the actual diff text
								for (const diffChange of diffChanges) {
									if ((diffChange as any).patch || (diffChange as any).diff) {
										diffContent = (diffChange as any).patch || (diffChange as any).diff;
										logGitOperation(`Found patch/diff content in diffWith result for ${relPath}`);
										break;
									}
								}
							}
						} catch (diffError) {
							logGitOperation(`diffWith failed for ${relPath}`, diffError);
						}
					}
					
					// Approach 3: Try to get diff from commit object if we have it
					if (!diffContent && commit) {
						try {
							// Check if the commit has diff information
							if ((commit as any).diff) {
								const commitDiff = (commit as any).diff;
								logGitOperation(`Commit has diff property for ${relPath}`, { diffType: typeof commitDiff });
								if (typeof commitDiff === 'string') {
									diffContent = commitDiff;
								}
							}
							
							// Check if the commit has file information
							if ((commit as any).files) {
								const commitFiles = (commit as any).files;
								logGitOperation(`Commit has files property`, { filesCount: commitFiles?.length });
								const fileInfo = commitFiles?.find((f: any) => f.path === relPath || f.filename === relPath);
								if (fileInfo && (fileInfo.patch || fileInfo.diff)) {
									diffContent = fileInfo.patch || fileInfo.diff;
									logGitOperation(`Found file diff in commit files for ${relPath}`);
								}
							}
						} catch (commitError) {
							logGitOperation(`Failed to extract diff from commit object for ${relPath}`, commitError);
						}
					}
					
					// If we found actual diff content, use it
					if (diffContent) {
						diffs.push(diffContent);
						logGitOperation(`Used actual diff content for modified ${relPath}`, {
							diffLength: diffContent.length,
							hasUnifiedFormat: diffContent.includes('@@'),
							hasFileHeader: diffContent.includes('diff --git')
						});
						continue;
					} else {
						logGitOperation(`No actual diff content found for ${relPath}, falling back to manual diff generation`);
					}
				} catch (error) {
					logGitOperation(`Failed to get actual diff for modified file ${relPath}`, error);
				}
			}

			// Fallback: Get file contents and generate diff manually
			let oldContent = '';
			let newContent = '';
			
			try {
				// Get old content using VS Code Git API
				oldContent = await getFileContentAtCommit(repository, fromCommit, relPath, workspacePath);
				logGitOperation(`Old content length for ${relPath}: ${oldContent.length} characters`);
			} catch (error) {
				logGitOperation(`Failed to get old content for ${relPath} at ${fromCommit}`, error);
				oldContent = '';
			}
			
			try {
				// Get new content from current working directory file
				const fileUri = vscode.Uri.joinPath(repository.rootUri, relPath);
				const content = await vscode.workspace.fs.readFile(fileUri);
				newContent = Buffer.from(content).toString('utf8');
				logGitOperation(`New content length for ${relPath}: ${newContent.length} characters`);
			} catch (error) {
				logGitOperation(`Failed to get current content for ${relPath}`, error);
				// If it's a deleted file, the current content should be empty
				if (change.status === Status.INDEX_DELETED || change.status === Status.DELETED) {
					newContent = '';
					logGitOperation(`File ${relPath} is deleted, using empty current content`);
				} else {
					newContent = '';
				}
			}

			// Handle special cases for better diff accuracy using VS Code Git API information
			if (change.status === Status.INDEX_ADDED || change.status === Status.ADDED_BY_US) {
				// For newly added files, old content should be empty
				oldContent = '';
				logGitOperation(`File ${relPath} is newly added, using empty old content`);
			} else if (change.status === Status.INDEX_DELETED || change.status === Status.DELETED) {
				// For deleted files, new content should be empty
				newContent = '';
				logGitOperation(`File ${relPath} is deleted, using empty new content`);
			} else if (change.status === Status.INDEX_RENAMED) {
				// For renamed files, handle the old and new paths
				if (change.originalUri) {
					const originalRelPath = vscode.workspace.asRelativePath(change.originalUri);
					logGitOperation(`File renamed from ${originalRelPath} to ${relPath}`);
					// Try to get content from the original location for old content
					try {
						oldContent = await getAdvancedFileContent(repository, fromCommit, originalRelPath);
					} catch (error) {
						logGitOperation(`Failed to get original content for renamed file ${originalRelPath}`, error);
					}
				}
			}

			// Additional validation and enhancement for content accuracy
			if (oldContent && newContent) {
				// Both contents available - this should produce a good diff
				logGitOperation(`Both old and new content available for ${relPath}`, {
					oldLength: oldContent.length,
					newLength: newContent.length,
					oldLines: oldContent.split('\n').length,
					newLines: newContent.split('\n').length
				});
			} else if (!oldContent && newContent) {
				// File was added
				logGitOperation(`File ${relPath} appears to be added (old content empty)`);
			} else if (oldContent && !newContent) {
				// File was deleted
				logGitOperation(`File ${relPath} appears to be deleted (new content empty)`);
			} else {
				// Both empty - this might indicate an issue
				logGitOperation(`Warning: Both old and new content are empty for ${relPath}`);
			}

			// Only generate diff if we have meaningful content differences
			if (oldContent !== '' || newContent !== '') {
				// Generate unified diff for this file
				const diff = generateUnifiedDiff(oldPath, newPath, oldContent, newContent, contextLines);
				if (diff) {
					diffs.push(diff);
					logGitOperation(`Generated diff for ${relPath}`, {
						diffLength: diff.length,
						diffLines: diff.split('\n').length,
						hasFileHeader: diff.includes('diff --git'),
						hasPlusLines: diff.includes('\n+'),
						hasMinusLines: diff.includes('\n-'),
						oldContentLength: oldContent.length,
						newContentLength: newContent.length,
						changeType: oldContent === '' ? 'file added' : 
								   newContent === '' ? 'file deleted' : 'file modified'
					});
				} else {
					logGitOperation(`No meaningful diff generated for ${relPath}`, {
						oldContentEmpty: oldContent === '',
						newContentEmpty: newContent === '',
						contentsEqual: oldContent === newContent
					});
				}
			} else {
				// Both contents are empty or unavailable
				logGitOperation(`Skipping diff for ${relPath} - no content available`, {
					status: change.status,
					note: 'This may indicate VS Code Git API limitations for historical content'
				});
			}
		}

		// Join all diffs with proper separation (empty line between files like git show)
		const result = diffs.join('\n\n');
		logGitOperation('generateNativeGitDiff (GitAPI): Successfully generated diff', {
			fileCount: diffs.length,
			linesCount: result.split('\n').length,
			sizeBytes: result.length,
			files: filteredChanges.map(change => vscode.workspace.asRelativePath(change.uri)),
			diffsInfo: diffs.map((d, i) => ({
				index: i,
				length: d.length,
				lines: d.split('\n').length,
				hasHeader: d.includes('diff --git'),
				firstLine: d.split('\n')[0]
			})),
			resultPreview: result.length > 500 ? result.substring(0, 500) + '...' : result
		});
		return result;
	} catch (error) {
		logGitOperation('generateNativeGitDiff (GitAPI): Error occurred', error);
		throw new Error(`Failed to generate git diff: ${error}`);
	}
}

// Generate unified diff string that exactly matches git show output format
// Enhanced version with precise git-compatible formatting and context lines
export function generateUnifiedDiff(
	oldPath: string,
	newPath: string,
	oldContent: string,
	newContent: string,
	contextLines: number
): string {
	try {
		// Handle edge cases
		if (!oldContent && !newContent) {
			return '';
		}
		
		// Determine file mode based on content
		const isNewFile = !oldContent && newContent;
		const isDeletedFile = oldContent && !newContent;
		const isModifiedFile = oldContent && newContent;
		
		// Use jsdiff to generate structured patch with proper context
		const diff = jsdiff.structuredPatch(
			oldPath,
			newPath,
			oldContent || '',
			newContent || '',
			isNewFile ? '' : 'a/' + oldPath,
			isDeletedFile ? '' : 'b/' + newPath,
			{ context: contextLines }
		);
		
		// Debug: Log the structure of the diff to understand what jsdiff is producing
		logGitOperation(`jsdiff.structuredPatch result for ${oldPath}`, {
			hunksCount: diff.hunks ? diff.hunks.length : 0,
			isNewFile,
			isDeletedFile,
			isModifiedFile,
			hunksDetails: diff.hunks ? diff.hunks.map((h: any) => ({
				oldStart: h.oldStart,
				oldLines: h.oldLines,
				newStart: h.newStart,
				newLines: h.newLines,
				linesCount: h.lines ? h.lines.length : 0,
				sampleLines: h.lines ? h.lines.slice(0, 3) : []
			})) : []
		});
		
		// If no differences, return empty string
		if (!diff.hunks || diff.hunks.length === 0) {
			return '';
		}

		let result = '';
		
		// Generate diff header exactly like git show
		result += `diff --git a/${oldPath} b/${newPath}\n`;
		
		// Generate index line with proper formatting for different file states
		if (isNewFile) {
			result += `new file mode 100644\n`;
			result += `index 0000000..0000000\n`;
		} else if (isDeletedFile) {
			result += `deleted file mode 100644\n`;
			result += `index 0000000..0000000\n`;
		} else {
			result += `index 0000000..0000000 100644\n`;
		}
		
		// Generate file paths with proper formatting
		if (isNewFile) {
			result += `--- /dev/null\n`;
			result += `+++ b/${newPath}\n`;
		} else if (isDeletedFile) {
			result += `--- a/${oldPath}\n`;
			result += `+++ /dev/null\n`;
		} else {
			result += `--- a/${oldPath}\n`;
			result += `+++ b/${newPath}\n`;
		}
		
		// Generate hunks with proper formatting
		for (const hunk of diff.hunks) {
			// Hunk header with context information
			result += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
			
			// Process each line in the hunk - jsdiff already includes +/- prefixes
			for (const line of hunk.lines) {
				result += line + '\n';
			}
		}
		
		// Remove any trailing newlines to match git show output exactly
		return result.replace(/\n+$/, '');
		
	} catch (error) {
		logGitOperation('Error in generateUnifiedDiff', error);
		return '';
	}
}

// Enhanced unified diff generation with better context handling
export function generatePreciseUnifiedDiff(
	oldPath: string,
	newPath: string,
	oldContent: string,
	newContent: string,
	contextLines: number
): string {
	try {
		// Handle edge cases
		if (!oldContent && !newContent) {
			return '';
		}
		
		// Split into lines
		const oldLines = oldContent ? oldContent.split('\n') : [];
		const newLines = newContent ? newContent.split('\n') : [];
		
		// Generate diff using jsdiff with enhanced options
		const diffResult = jsdiff.diffLines(oldContent || '', newContent || '', {
			ignoreWhitespace: false,
			newlineIsToken: false
		});
		
		if (!diffResult || diffResult.length === 0) {
			return '';
		}
		
		// Check if there are actual changes
		const hasChanges = diffResult.some((part: any) => part.added || part.removed);
		if (!hasChanges) {
			return '';
		}
		
		// Build unified diff format manually for precise control
		let result = '';
		result += `diff --git a/${oldPath} b/${newPath}\n`;
		result += `index 0000000..0000000 100644\n`;
		result += `--- a/${oldPath}\n`;
		result += `+++ b/${newPath}\n`;
		
		// Generate hunks with proper context
		const hunks = generateHunksWithContext(diffResult, oldLines, newLines, contextLines);
		
		for (const hunk of hunks) {
			result += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
			result += hunk.lines.join('\n') + '\n';
		}
		
		return result.trim();
		
	} catch (error) {
		logGitOperation('Error in precise unified diff generation', error);
		// Fallback to standard generation
		return generateUnifiedDiff(oldPath, newPath, oldContent, newContent, contextLines);
	}
}

// Generate hunks with proper context lines
function generateHunksWithContext(diffResult: any[], oldLines: string[], newLines: string[], contextLines: number): any[] {
	const hunks: any[] = [];
	let currentHunk: any = null;
	let oldLineNum = 1;
	let newLineNum = 1;
	
	for (let i = 0; i < diffResult.length; i++) {
		const part = diffResult[i];
		const lines = part.value.split('\n');
		
		// Remove empty last line if it exists
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		
		if (part.added || part.removed) {
			// Start new hunk if needed
			if (!currentHunk) {
				currentHunk = {
					oldStart: Math.max(1, oldLineNum - contextLines),
					newStart: Math.max(1, newLineNum - contextLines),
					oldLines: 0,
					newLines: 0,
					lines: []
				};
				
				// Add context before
				const contextStart = Math.max(0, oldLineNum - contextLines - 1);
				const contextEnd = oldLineNum - 1;
				for (let j = contextStart; j < contextEnd; j++) {
					if (j < oldLines.length) {
						currentHunk.lines.push(' ' + oldLines[j]);
						currentHunk.oldLines++;
						currentHunk.newLines++;
					}
				}
			}
			
			// Add changed lines
			if (part.removed) {
				for (const line of lines) {
					currentHunk.lines.push('-' + line);
					currentHunk.oldLines++;
				}
				oldLineNum += lines.length;
			}
			
			if (part.added) {
				for (const line of lines) {
					currentHunk.lines.push('+' + line);
					currentHunk.newLines++;
				}
				newLineNum += lines.length;
			}
			
		} else {
			// Unchanged lines
			if (currentHunk) {
				// Add context after and close hunk
				const contextStart = newLineNum;
				const contextEnd = Math.min(newLines.length, newLineNum + contextLines);
				for (let j = contextStart - 1; j < contextEnd - 1; j++) {
					if (j < newLines.length) {
						currentHunk.lines.push(' ' + newLines[j]);
						currentHunk.oldLines++;
						currentHunk.newLines++;
					}
				}
				
				hunks.push(currentHunk);
				currentHunk = null;
			}
			
			oldLineNum += lines.length;
			newLineNum += lines.length;
		}
	}
	
	// Close final hunk if needed
	if (currentHunk) {
		hunks.push(currentHunk);
	}
	
	return hunks;
}

// Show git diff from specific commit in a new document for preview - uses VS Code Git API only
export async function showDiffPreviewFromCommit(workspacePath: string, commitHash: string, contextLines: number = 50, excludeDeletes: boolean = true, fileExtensions: string = ''): Promise<void> {
	try {
		logGitOperation('showDiffPreviewFromCommit: Starting with parameters', {
			workspacePath,
			commitHash: commitHash.substring(0, 8),
			contextLines,
			excludeDeletes,
			fileExtensions
		});

		// Generate unified diff using precise VS Code Git API-based method for git show compatibility
		const diff = await generateNativeGitDiff(workspacePath, commitHash, contextLines, excludeDeletes, fileExtensions);
		const shortHash = commitHash.substring(0, 8);
		
		const filterInfo = fileExtensions ? `\nFile Extensions Filter: ${fileExtensions}` : '';
		
		const previewContent = `# Git Diff Preview

**Comparison:** Current HEAD vs Commit ${shortHash}  
**Context Lines (git diff -U${contextLines}):** ${contextLines}  
**Options:** ${excludeDeletes ? 'Exclude deleted files' : 'Include all changes'}${filterInfo}  
**Generated at:** ${new Date().toLocaleString()}

---

\`\`\`diff
${diff}
\`\`\``;

		const doc = await vscode.workspace.openTextDocument({
			content: previewContent,
			language: 'markdown'
		});
		await vscode.window.showTextDocument(doc);
		
		logGitOperation('showDiffPreviewFromCommit: Preview document created successfully');
	} catch (error) {
		logGitOperation('showDiffPreviewFromCommit: Error occurred', error);
		vscode.window.showErrorMessage(`Error showing diff preview: ${error}`);
	}
}
