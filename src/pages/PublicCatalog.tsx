import PublicHeader from '@/components/PublicHeader';
import Courses from '@/pages/Courses';

// Public course catalog (no login). Reuses the Courses grid, pointing card
// clicks at the public detail route.
const PublicCatalog = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <div className="px-4 py-8">
        <Courses basePath="/courses" />
      </div>
    </div>
  );
};

export default PublicCatalog;
