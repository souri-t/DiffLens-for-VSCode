interface Messages {
    [key: string]: string;
}

// Import language files directly
import * as enMessages from './languages/en.json';
import * as jaMessages from './languages/ja.json';
import * as zhMessages from './languages/zh.json';

export class LanguageService {
    private static messages: Messages = {};
    private static currentLanguage: string = 'en';
    private static languageData: { [key: string]: Messages } = {
        'en': enMessages,
        'ja': jaMessages,
        'zh': zhMessages
    };

    public static loadLanguage(language: string): void {
        try {
            if (this.languageData[language]) {
                this.messages = this.languageData[language];
                this.currentLanguage = language;
            } else {
                console.warn(`Language not supported: ${language}, falling back to English`);
                this.messages = this.languageData['en'];
                this.currentLanguage = 'en';
            }
        } catch (error) {
            console.error(`Error loading language ${language}:`, error);
            this.messages = this.languageData['en'];
            this.currentLanguage = 'en';
        }
    }

    public static getMessage(key: string): string {
        return this.messages[key] || key;
    }

    public static getCurrentLanguage(): string {
        return this.currentLanguage;
    }
}