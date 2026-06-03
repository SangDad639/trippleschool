import { useNavigate, useLocation } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const GuideButton = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  // Hide on login/register/landing/guide pages
  const hiddenPaths = ['/', '/login', '/register', '/guide', '/tutorials'];
  if (hiddenPaths.includes(location.pathname)) return null;

  return (
    <button
      onClick={() => navigate('/guide')}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#FFB300] hover:bg-[#FFA000] text-black font-medium shadow-lg transition-all hover:scale-105"
    >
      <BookOpen className="h-4 w-4" />
      {t('guide.button')}
    </button>
  );
};

export default GuideButton;
