// src/shared/utils/language-converter.ts - FIXED WITHOUT PRISMA IMPORTS
import { SupportedLanguage } from '../../i18n/constants/languages';

// Define Language type locally to match Prisma schema
type Language = 'EN' | 'ID' | 'ZH';

export class LanguageConverter {
  private static readonly SUPPORTED_TO_PRISMA: Record<
    SupportedLanguage,
    Language
  > = {
    EN: 'EN',
    ID: 'ID',
    ZH: 'ZH',
  };

  private static readonly PRISMA_TO_SUPPORTED: Record<
    Language,
    SupportedLanguage
  > = {
    EN: 'EN',
    ID: 'ID',
    ZH: 'ZH',
  };

  /**
   * Convert SupportedLanguage to Prisma Language enum
   */
  static toPrismaLanguage(supportedLang: SupportedLanguage): Language {
    return this.SUPPORTED_TO_PRISMA[supportedLang] || 'EN';
  }

  /**
   * Convert Prisma Language enum to SupportedLanguage
   */
  static fromPrismaLanguage(prismaLang: Language): SupportedLanguage {
    return this.PRISMA_TO_SUPPORTED[prismaLang] || 'EN';
  }

  /**
   * Convert SupportedLanguage to string (for backward compatibility)
   */
  static toString(supportedLang: SupportedLanguage): string {
    return this.toPrismaLanguage(supportedLang);
  }

  /**
   * Validate and convert string to SupportedLanguage
   */
  static fromString(langString: string): SupportedLanguage {
    const prismaLang = langString as Language;
    return this.fromPrismaLanguage(prismaLang);
  }

  /**
   * Get language display info
   */
  static getLanguageInfo(lang: SupportedLanguage): {
    code: string;
    name: string;
    nativeName: string;
    flag: string;
  } {
    const languageInfo = {
      EN: {
        code: 'en',
        name: 'English',
        nativeName: 'English',
        flag: '🇺🇸',
      },
      ID: {
        code: 'id',
        name: 'Indonesian',
        nativeName: 'Bahasa Indonesia',
        flag: '🇮🇩',
      },
      ZH: {
        code: 'zh',
        name: 'Chinese',
        nativeName: '中文',
        flag: '🇨🇳',
      },
    };

    return languageInfo[lang] || languageInfo.EN;
  }

  /**
   * Detect language from various sources
   */
  static detectLanguage(sources: {
    header?: string;
    query?: string;
    acceptLanguage?: string;
  }): SupportedLanguage {
    // Priority: header > query > acceptLanguage
    if (sources.header) {
      const detected = this.parseLanguageCode(sources.header);
      if (detected) return detected;
    }

    if (sources.query) {
      const detected = this.parseLanguageCode(sources.query);
      if (detected) return detected;
    }

    if (sources.acceptLanguage) {
      const detected = this.parseAcceptLanguage(sources.acceptLanguage);
      if (detected) return detected;
    }

    return 'EN'; // Default fallback
  }

  /**
   * Parse language code with Chinese variants
   */
  private static parseLanguageCode(code: string): SupportedLanguage | null {
    if (!code) return null;

    const normalized = code.toUpperCase().trim();

    const mapping: Record<string, SupportedLanguage> = {
      EN: 'EN',
      ENG: 'EN',
      ENGLISH: 'EN',
      ID: 'ID',
      IND: 'ID',
      INDONESIAN: 'ID',
      IN: 'ID',
      ZH: 'ZH',
      CHI: 'ZH',
      CHINESE: 'ZH',
      CN: 'ZH',
      'ZH-CN': 'ZH',
      'ZH-TW': 'ZH',
      'ZH-HANS': 'ZH',
      'ZH-HANT': 'ZH',
    };

    return mapping[normalized] || null;
  }

  /**
   * Parse Accept-Language header
   */
  private static parseAcceptLanguage(
    acceptLang: string,
  ): SupportedLanguage | null {
    try {
      const languages = acceptLang
        .split(',')
        .map((lang) => lang.split(';')[0].trim())
        .map((lang) => lang.substring(0, 2).toUpperCase());

      for (const lang of languages) {
        const mapped = this.parseLanguageCode(lang);
        if (mapped) return mapped;
      }
    } catch (error) {
      console.warn('Failed to parse Accept-Language:', error);
    }

    return null;
  }
}
