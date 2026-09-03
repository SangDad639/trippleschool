import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * ธีมของเว็บ — default = dark (หน้าตาดั้งเดิมของแบรนด์ ดำ/ทอง)
 * ไม่อิง system preference: เว็บออกแบบมามืด ผู้ใช้ที่อยากได้สว่างค่อยสลับเอง
 * ที่หน้า Profile → การตั้งค่า แล้วจำไว้ใน localStorage
 *
 * กลไก: เติม/ถอดคลาส `light` ที่ <html> — token ทั้งชุด + ตาราง override
 * คลาส hardcode ใน index.css จะสลับตาม (ดู section "LIGHT THEME" ในไฟล์นั้น)
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('app-theme') === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    // แถบเบราว์เซอร์มือถือให้กลืนกับพื้นหลังธีม
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'light' ? '#FFFBF2' : '#141414';
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('app-theme', t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
