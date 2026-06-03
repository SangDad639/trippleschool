import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { t as translate, type Language, type TranslationKey } from '@/lib/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // If user already chose a language, respect that
    const saved = localStorage.getItem('app-language') as Language;
    if (saved) return saved;
    // Otherwise default to 'th' (will be updated by geo-detect)
    return 'th';
  });

  // Geo-detect on first load (only if no saved preference)
  useEffect(() => {
    const detectAndSetLanguage = async () => {
      const saved = localStorage.getItem('app-language');
      if (saved) return; // User already chose, don't override

      try {
        const res = await fetch('https://api.country.is/');
        const data = await res.json();
        const detectedLang: Language = data.country === 'TH' ? 'th' : 'en';
        setLanguageState(detectedLang);
        // Don't save to localStorage - let user explicitly choose to persist
      } catch {
        // Silently fail, keep default 'th'
      }
    };
    detectAndSetLanguage();
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app-language', lang);
  }, []);

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    return translate(key, language, params);
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
