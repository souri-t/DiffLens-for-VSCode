import * as vscode from 'vscode';
import { SettingsViewProvider } from './settingsViewProvider';
import { getConfiguration, validateConfiguration, getAvailableVSCodeLMFamilies } from './configService';
import { isGitRepository, refreshGitAPI } from './gitService';
import { generateNativeGitDiff, showDiffPreviewFromCommit } from './diffService';
import { reviewWithLLM, showReviewResults } from './reviewService';
import { logGitOperation, disposeLogger } from './logger';
import { FavoritePromptsService } from './favoritePromptsService';
import { ExportService } from './exportService';
import { FileFilterService } from './fileFilterService';

export function activate(context: vscode.ExtensionContext) {
	console.log('DiffLens extension is now active!');

	// Register the settings view provider
	const settingsProvider = new SettingsViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsProvider)
	);

	// Initialize Git API early to ensure it's ready when views are displayed
	setTimeout(async () => {
		console.log('Performing initial Git API initialization...');
		try {
			await refreshGitAPI();
		} catch (error) {
			console.log('Error during initial Git API initialization:', error);
		}
	}, 500);

	// Register VS Code LM families command
	const getVSCodeFamiliesCommand = vscode.commands.registerCommand('diff-lens.getVSCodeFamilies', async () => {
		return await getAvailableVSCodeLMFamilies();
	});

	// Register Git repository refresh command
	const refreshGitRepoCommand = vscode.commands.registerCommand('diff-lens.refreshGitRepo', async () => {
		logGitOperation('Manual Git repository refresh requested');
		refreshGitAPI();
		
		// Also refresh the settings view if it has a refresh method
		if (settingsProvider && typeof settingsProvider.refreshBranchInfo === 'function') {
		    settingsProvider.refreshBranchInfo();
		}
		
		vscode.window.showInformationMessage('Git repository information refreshed');
	});

	// Register code review command
	const reviewCommand = vscode.commands.registerCommand('diff-lens.reviewCode', async (selectedCommit?: string, customPrompts?: {systemPrompt: string, reviewPerspective: string}) => {
		await runCodeReview(selectedCommit, customPrompts);
	});

	// Register diff preview command
	const previewCommand = vscode.commands.registerCommand('diff-lens.previewDiff', async (selectedCommit?: string) => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder containing a git repository.');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;

		// Check if it's a git repository - try with cache first, then force refresh if needed
		let isRepo = await isGitRepository(workspacePath);
		if (!isRepo) {
			logGitOperation('Repository check failed with cache, trying force refresh');
			isRepo = await isGitRepository(workspacePath, true);
		}
		
		if (!isRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository.');
			return;
		}

		if (!selectedCommit) {
			return;
		}

		const config = getConfiguration();
		console.log('Preview diff with contextLines:', config.contextLines, 'excludeDeletes:', config.excludeDeletes, 'fileExtensions:', config.fileExtensions); // Debug log
		await showDiffPreviewFromCommit(workspacePath, selectedCommit, config.contextLines, config.excludeDeletes, config.fileExtensions);
	});

	// Register settings command
	const settingsCommand = vscode.commands.registerCommand('diff-lens.openSettings', () => {
		vscode.commands.executeCommand('workbench.view.explorer');
		vscode.commands.executeCommand('diff-lens-settings.focus');
	});

	// Register toggle settings command for toolbar
	const toggleSettingsCommand = vscode.commands.registerCommand('diff-lens.toggleSettings', () => {
		settingsProvider.toggleSettingsVisibility();
	});

	// Register favorite prompts commands
	const saveFavoritePromptCommand = vscode.commands.registerCommand('diff-lens.saveFavoritePrompt', async () => {
		await saveFavoritePrompt();
	});

	const manageFavoritePromptsCommand = vscode.commands.registerCommand('diff-lens.manageFavoritePrompts', async () => {
		await manageFavoritePrompts();
	});

	// Register export command
	const exportReviewCommand = vscode.commands.registerCommand('diff-lens.exportReview', async (reviewResult: any, gitInfo: any) => {
		await exportReview(reviewResult, gitInfo);
	});

	// Register excluded files command
	const showExcludedFilesCommand = vscode.commands.registerCommand('diff-lens.showExcludedFiles', async (exclusionSummary: any) => {
		await showExcludedFiles(exclusionSummary);
	});

	context.subscriptions.push(
		reviewCommand, 
		previewCommand, 
		settingsCommand, 
		toggleSettingsCommand, 
		getVSCodeFamiliesCommand, 
		refreshGitRepoCommand,
		saveFavoritePromptCommand,
		manageFavoritePromptsCommand,
		exportReviewCommand,
		showExcludedFilesCommand
	);
}

async function runCodeReview(selectedCommit?: string, customPrompts?: {systemPrompt: string, reviewPerspective: string}) {
	try {
		// Get current workspace folder
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder found. Please open a folder containing a git repository.');
			return;
		}

		const workspacePath = workspaceFolder.uri.fsPath;

		// Check if it's a git repository - try with cache first, then force refresh if needed
		let isRepo = await isGitRepository(workspacePath);
		if (!isRepo) {
			logGitOperation('Repository check failed with cache, trying force refresh');
			isRepo = await isGitRepository(workspacePath, true);
		}
		
		if (!isRepo) {
			vscode.window.showErrorMessage('Current workspace is not a git repository.');
			return;
		}

		// Get configuration
		const config = getConfiguration();
		
		// Override with custom prompts if provided
		if (customPrompts) {
			config.systemPrompt = customPrompts.systemPrompt;
			config.reviewPerspective = customPrompts.reviewPerspective;
		}
		
		console.log('Current contextLines setting:', config.contextLines, 'excludeDeletes:', config.excludeDeletes, 'fileExtensions:', config.fileExtensions); // Debug log
		logGitOperation('runCodeReview: Configuration loaded', {
			contextLines: config.contextLines,
			excludeDeletes: config.excludeDeletes,
			fileExtensions: config.fileExtensions,
			hasSystemPrompt: !!config.systemPrompt,
			hasReviewPerspective: !!config.reviewPerspective,
			selectedCommit: selectedCommit ? selectedCommit.substring(0, 8) : 'none'
		});
		const configErrors = validateConfiguration(config);
		if (configErrors.length > 0) {
			vscode.window.showErrorMessage(`Configuration errors: ${configErrors.join(', ')}`);
			return;
		}

		// Show progress
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Reviewing code with ${config.llmProvider === 'bedrock' ? 'AWS Bedrock' : 'VS Code LM'}`,
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0, message: 'Getting git diff...' });

			// Get git diff using VS Code Git API only (no native git commands)
			const diffResult = await generateNativeGitDiff(workspacePath, selectedCommit || null, config.contextLines, config.excludeDeletes, config.fileExtensions, config);
			const diff = diffResult.diff;
			
			progress.report({ increment: 50, message: `Sending to ${config.llmProvider.toUpperCase()} for review...` });

			// Send to LLM for review
			const reviewResult = await reviewWithLLM(diff, config);
			
			progress.report({ increment: 100, message: 'Review complete!' });

			// Show results
			await showReviewResults(reviewResult, { selectedCommit }, diffResult.exclusionSummary);
		});

	} catch (error) {
		vscode.window.showErrorMessage(`Error during code review: ${error}`);
	}
}

// Save current prompt as favorite
async function saveFavoritePrompt() {
	const currentState = FavoritePromptsService.getCurrentPromptState();
	
	if (!currentState.systemPrompt.trim() || !currentState.reviewPerspective.trim()) {
		vscode.window.showWarningMessage('現在のプロンプト設定が空です。設定してから保存してください。');
		return;
	}

	const name = await vscode.window.showInputBox({
		prompt: 'お気に入りプロンプトの名前を入力してください',
		validateInput: (value) => {
			if (!value.trim()) {
				return '名前は必須です';
			}
			return undefined;
		}
	});

	if (!name) return;

	const description = await vscode.window.showInputBox({
		prompt: 'プロンプトの説明を入力してください（任意）',
		value: ''
	});

	const tagsInput = await vscode.window.showInputBox({
		prompt: 'タグをカンマ区切りで入力してください（任意）',
		value: ''
	});

	const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

	const result = await FavoritePromptsService.saveFavoritePrompt(
		name,
		description || '',
		tags,
		currentState.systemPrompt,
		currentState.reviewPerspective
	);

	if (result.success) {
		vscode.window.showInformationMessage(result.message);
	} else {
		vscode.window.showErrorMessage(result.message);
	}
}

// Manage favorite prompts
async function manageFavoritePrompts() {
	const prompts = FavoritePromptsService.getFavoritePrompts();
	
	if (prompts.length === 0) {
		vscode.window.showInformationMessage('お気に入りプロンプトが登録されていません。');
		return;
	}

	const items = prompts.map(prompt => ({
		label: prompt.name,
		description: prompt.description,
		detail: `使用回数: ${prompt.usage.count} | タグ: ${prompt.tags.join(', ') || 'なし'}`,
		prompt
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'プロンプトを選択してください',
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (!selected) return;

	const action = await vscode.window.showQuickPick([
		{ label: '$(play) 適用', action: 'apply' },
		{ label: '$(edit) 編集', action: 'edit' },
		{ label: '$(trash) 削除', action: 'delete' },
		{ label: '$(eye) プレビュー', action: 'preview' }
	], {
		placeHolder: 'アクションを選択してください'
	});

	if (!action) return;

	switch (action.action) {
		case 'apply':
			const applyResult = await FavoritePromptsService.applyFavoritePrompt(selected.prompt.id);
			if (applyResult.success) {
				vscode.window.showInformationMessage(applyResult.message);
			} else {
				vscode.window.showErrorMessage(applyResult.message);
			}
			break;

		case 'edit':
			// TODO: Implement edit dialog
			vscode.window.showInformationMessage('編集機能は今後実装予定です。');
			break;

		case 'delete':
			const confirmDelete = await vscode.window.showWarningMessage(
				`プロンプト "${selected.prompt.name}" を削除しますか？`,
				{ modal: true },
				'削除'
			);
			if (confirmDelete === '削除') {
				const deleteResult = await FavoritePromptsService.deleteFavoritePrompt(selected.prompt.id);
				if (deleteResult.success) {
					vscode.window.showInformationMessage(deleteResult.message);
				} else {
					vscode.window.showErrorMessage(deleteResult.message);
				}
			}
			break;

		case 'preview':
			const previewContent = `# ${selected.prompt.name}\n\n${selected.prompt.description}\n\n## System Prompt\n\n${selected.prompt.systemPrompt}\n\n## Review Perspective\n\n${selected.prompt.reviewPerspective}\n\n## Metadata\n\n- Created: ${new Date(selected.prompt.createdAt).toLocaleString()}\n- Updated: ${new Date(selected.prompt.updatedAt).toLocaleString()}\n- Usage Count: ${selected.prompt.usage.count}\n- Tags: ${selected.prompt.tags.join(', ') || 'None'}`;
			
			const doc = await vscode.workspace.openTextDocument({
				content: previewContent,
				language: 'markdown'
			});
			await vscode.window.showTextDocument(doc);
			break;
	}
}

// Export review results
async function exportReview(reviewResult: any, gitInfo: any) {
	const config = getConfiguration();
	const exportService = new ExportService(config);

	const format = await vscode.window.showQuickPick([
		{ label: 'HTML', value: 'html' },
		{ label: 'JSON', value: 'json' }
	], {
		placeHolder: 'エクスポート形式を選択してください'
	});

	if (!format) return;

	try {
		let result;
		if (format.value === 'html') {
			result = await exportService.exportToHtml(reviewResult, gitInfo, {}, {});
		} else {
			result = await exportService.exportToJson(reviewResult, gitInfo, {}, {});
		}

		if (result.success) {
			const openFile = await vscode.window.showInformationMessage(
				result.message,
				'ファイルを開く'
			);
			if (openFile === 'ファイルを開く' && result.filePath) {
				const doc = await vscode.workspace.openTextDocument(result.filePath);
				await vscode.window.showTextDocument(doc);
			}
		} else {
			vscode.window.showErrorMessage(result.message);
		}
	} catch (error) {
		vscode.window.showErrorMessage(`エクスポートに失敗しました: ${error}`);
	}
}

// Show excluded files
async function showExcludedFiles(exclusionSummary: any) {
	if (!exclusionSummary || exclusionSummary.excludedFiles.length === 0) {
		vscode.window.showInformationMessage('除外されたファイルはありません。');
		return;
	}

	const config = getConfiguration();
	const fileFilterService = new FileFilterService(config);
	const report = fileFilterService.generateExclusionReport(exclusionSummary);

	const doc = await vscode.workspace.openTextDocument({
		content: report,
		language: 'markdown'
	});
	await vscode.window.showTextDocument(doc);
}

// This method is called when your extension is deactivated
export function deactivate() {
	disposeLogger();
}
