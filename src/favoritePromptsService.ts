import * as vscode from 'vscode';
import { FavoritePrompt } from './types';
import { v4 as uuidv4 } from 'uuid';

export class FavoritePromptsService {
    private static readonly MAX_PROMPTS_DEFAULT = 20;
    private static readonly PROMPTS_CONFIG_KEY = 'favoritePrompts';
    private static readonly MAX_PROMPTS_CONFIG_KEY = 'maxFavoritePrompts';

    // Get all favorite prompts
    static getFavoritePrompts(): FavoritePrompt[] {
        const config = vscode.workspace.getConfiguration('diffLens');
        const prompts = config.get<FavoritePrompt[]>(this.PROMPTS_CONFIG_KEY, []);
        return prompts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    // Save a new favorite prompt
    static async saveFavoritePrompt(
        name: string,
        systemPrompt: string,
        reviewPerspective: string
    ): Promise<{ success: boolean; message: string; prompt?: FavoritePrompt }> {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            const currentPrompts = this.getFavoritePrompts();
            const maxPrompts = config.get<number>(this.MAX_PROMPTS_CONFIG_KEY, this.MAX_PROMPTS_DEFAULT);

            // Check if name already exists
            if (currentPrompts.some(p => p.name === name)) {
                return { success: false, message: `プロンプト名 "${name}" は既に存在します。` };
            }

            // Check maximum limit
            if (currentPrompts.length >= maxPrompts) {
                return { success: false, message: `お気に入りプロンプトの上限 (${maxPrompts}個) に達しています。` };
            }

            // Validate required fields
            if (!name.trim()) {
                return { success: false, message: 'プロンプト名は必須です。' };
            }
            if (!systemPrompt.trim()) {
                return { success: false, message: 'システムプロンプトは必須です。' };
            }
            if (!reviewPerspective.trim()) {
                return { success: false, message: 'レビュー観点は必須です。' };
            }

            const now = new Date().toISOString();
            const newPrompt: FavoritePrompt = {
                id: uuidv4(),
                name: name.trim(),
                systemPrompt: systemPrompt.trim(),
                reviewPerspective: reviewPerspective.trim(),
                createdAt: now,
                updatedAt: now,
                usage: {
                    count: 0,
                    lastUsed: ''
                }
            };

            const updatedPrompts = [...currentPrompts, newPrompt];
            await config.update(this.PROMPTS_CONFIG_KEY, updatedPrompts, vscode.ConfigurationTarget.Global);

            return { success: true, message: 'お気に入りプロンプトを保存しました。', prompt: newPrompt };
        } catch (error) {
            return { success: false, message: `保存に失敗しました: ${error}` };
        }
    }

    // Update an existing favorite prompt
    static async updateFavoritePrompt(
        id: string,
        name: string,
        systemPrompt: string,
        reviewPerspective: string
    ): Promise<{ success: boolean; message: string; prompt?: FavoritePrompt }> {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            const currentPrompts = this.getFavoritePrompts();

            const promptIndex = currentPrompts.findIndex(p => p.id === id);
            if (promptIndex === -1) {
                return { success: false, message: 'プロンプトが見つかりません。' };
            }

            // Check if new name conflicts with other prompts
            const nameConflict = currentPrompts.some(p => p.id !== id && p.name === name);
            if (nameConflict) {
                return { success: false, message: `プロンプト名 "${name}" は既に存在します。` };
            }

            // Validate required fields
            if (!name.trim()) {
                return { success: false, message: 'プロンプト名は必須です。' };
            }
            if (!systemPrompt.trim()) {
                return { success: false, message: 'システムプロンプトは必須です。' };
            }
            if (!reviewPerspective.trim()) {
                return { success: false, message: 'レビュー観点は必須です。' };
            }

            const updatedPrompt: FavoritePrompt = {
                ...currentPrompts[promptIndex],
                name: name.trim(),
                systemPrompt: systemPrompt.trim(),
                reviewPerspective: reviewPerspective.trim(),
                updatedAt: new Date().toISOString()
            };

            const updatedPrompts = [...currentPrompts];
            updatedPrompts[promptIndex] = updatedPrompt;

            await config.update(this.PROMPTS_CONFIG_KEY, updatedPrompts, vscode.ConfigurationTarget.Global);

            return { success: true, message: 'お気に入りプロンプトを更新しました。', prompt: updatedPrompt };
        } catch (error) {
            return { success: false, message: `更新に失敗しました: ${error}` };
        }
    }

    // Delete a favorite prompt
    static async deleteFavoritePrompt(id: string): Promise<{ success: boolean; message: string }> {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            const currentPrompts = this.getFavoritePrompts();

            const filteredPrompts = currentPrompts.filter(p => p.id !== id);
            
            if (filteredPrompts.length === currentPrompts.length) {
                return { success: false, message: 'プロンプトが見つかりません。' };
            }

            await config.update(this.PROMPTS_CONFIG_KEY, filteredPrompts, vscode.ConfigurationTarget.Global);

            return { success: true, message: 'お気に入りプロンプトを削除しました。' };
        } catch (error) {
            return { success: false, message: `削除に失敗しました: ${error}` };
        }
    }

    // Apply a favorite prompt (also updates usage statistics)
    static async applyFavoritePrompt(id: string): Promise<{ success: boolean; message: string; prompt?: FavoritePrompt }> {
        try {
            const config = vscode.workspace.getConfiguration('diffLens');
            const currentPrompts = this.getFavoritePrompts();

            const promptIndex = currentPrompts.findIndex(p => p.id === id);
            if (promptIndex === -1) {
                return { success: false, message: 'プロンプトが見つかりません。' };
            }

            const prompt = currentPrompts[promptIndex];

            // Update usage statistics
            const updatedPrompt: FavoritePrompt = {
                ...prompt,
                usage: {
                    count: prompt.usage.count + 1,
                    lastUsed: new Date().toISOString()
                },
                updatedAt: new Date().toISOString()
            };

            const updatedPrompts = [...currentPrompts];
            updatedPrompts[promptIndex] = updatedPrompt;

            // Update the stored prompts
            await config.update(this.PROMPTS_CONFIG_KEY, updatedPrompts, vscode.ConfigurationTarget.Global);

            // Apply the prompt to current settings
            await config.update('systemPrompt', prompt.systemPrompt, vscode.ConfigurationTarget.Workspace);
            await config.update('reviewPerspective', prompt.reviewPerspective, vscode.ConfigurationTarget.Workspace);

            return { success: true, message: 'お気に入りプロンプトを適用しました。', prompt: updatedPrompt };
        } catch (error) {
            return { success: false, message: `適用に失敗しました: ${error}` };
        }
    }

    // Export favorite prompts to JSON
    static exportFavoritePrompts(): string {
        const prompts = this.getFavoritePrompts();
        // id, usage, tags, description, createdAt, updatedAtを除外
        const exportPrompts = prompts.map(p => ({
            name: p.name,
            systemPrompt: p.systemPrompt,
            reviewPerspective: p.reviewPerspective
            // description, createdAt, updatedAt, tags, usage, idは含めない
        }));
        const exportData = {
            exportInfo: {
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                source: 'DiffLens',
                promptCount: exportPrompts.length
            },
            prompts: exportPrompts
        };
        return JSON.stringify(exportData, null, 2);
    }

    // Import favorite prompts from JSON
    static async importFavoritePrompts(jsonData: string): Promise<{ success: boolean; message: string; imported: number }> {
        try {
            const data = JSON.parse(jsonData);
            
            if (!data.prompts || !Array.isArray(data.prompts)) {
                return { success: false, message: 'インポートデータの形式が正しくありません。', imported: 0 };
            }

            const config = vscode.workspace.getConfiguration('diffLens');
            const currentPrompts = this.getFavoritePrompts();
            const maxPrompts = config.get<number>(this.MAX_PROMPTS_CONFIG_KEY, this.MAX_PROMPTS_DEFAULT);

            const validPrompts: FavoritePrompt[] = [];
            const skippedPrompts: string[] = [];

            for (const importPrompt of data.prompts) {
                // Validate prompt structure
                if (!importPrompt.name || !importPrompt.systemPrompt || !importPrompt.reviewPerspective) {
                    skippedPrompts.push(importPrompt.name || 'Unknown');
                    continue;
                }

                // Check for name conflicts
                if (currentPrompts.some(p => p.name === importPrompt.name)) {
                    skippedPrompts.push(importPrompt.name);
                    continue;
                }

                // Check total limit
                if (currentPrompts.length + validPrompts.length >= maxPrompts) {
                    skippedPrompts.push(importPrompt.name);
                    continue;
                }

                // 必要なフィールドのみで新規作成（id, usage, createdAt, updatedAtは無視）
                const now = new Date().toISOString();
                const validPrompt: FavoritePrompt = {
                    id: uuidv4(),
                    name: importPrompt.name,
                    systemPrompt: importPrompt.systemPrompt,
                    reviewPerspective: importPrompt.reviewPerspective,
                    createdAt: now,
                    updatedAt: now,
                    usage: {
                        count: 0,
                        lastUsed: ''
                    }
                };
                validPrompts.push(validPrompt);
            }

            if (validPrompts.length > 0) {
                const updatedPrompts = [...currentPrompts, ...validPrompts];
                await config.update(this.PROMPTS_CONFIG_KEY, updatedPrompts, vscode.ConfigurationTarget.Global);
            }

            let message = `${validPrompts.length}個のプロンプトをインポートしました。`;
            if (skippedPrompts.length > 0) {
                message += ` ${skippedPrompts.length}個のプロンプトはスキップされました。`;
            }

            return { success: true, message, imported: validPrompts.length };
        } catch (error) {
            return { success: false, message: `インポートに失敗しました: ${error}`, imported: 0 };
        }
    }

    // Get current prompt configuration as a favorite prompt (for saving current state)
    static getCurrentPromptState(): { systemPrompt: string; reviewPerspective: string } {
        const config = vscode.workspace.getConfiguration('diffLens');
        return {
            systemPrompt: config.get('systemPrompt', ''),
            reviewPerspective: config.get('reviewPerspective', '')
        };
    }

    // Check if auto-save is enabled and save current prompt if it is
    static async autoSaveCurrentPrompt(): Promise<void> {
        const config = vscode.workspace.getConfiguration('diffLens');
        const autoSave = config.get('promptAutoSave', false);
        
        if (!autoSave) {
            return;
        }

        const currentState = this.getCurrentPromptState();
        if (!currentState.systemPrompt.trim() || !currentState.reviewPerspective.trim()) {
            return;
        }

        // Auto-save with timestamp-based name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const autoSaveName = `Auto-saved ${timestamp}`;

        await this.saveFavoritePrompt(
            autoSaveName,
            currentState.systemPrompt,
            currentState.reviewPerspective
        );
    }
}
