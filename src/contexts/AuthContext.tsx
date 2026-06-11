import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface User {
  id: number;
  email: string;
  credits: number;
  joinDate: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isApproved?: boolean;
  subscriptionExpiresAt?: string | null;
  refcode?: string;
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  googleLogin: (credential: string, refcode?: string) => Promise<boolean>;
  register: (email: string, password: string, refcode?: string) => Promise<{
    success: boolean;
    pendingApproval?: boolean;
  }>;
  logout: () => void;
  updateCredits: (amount: number) => void;
  /** Set credits to an exact balance (use with `creditsRemaining` from API responses). */
  setCredits: (newBalance: number) => void;
  refreshUser: () => Promise<void>;
  showAuthModal: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const openAuthModal = () => setShowAuthModal(true);
  const closeAuthModal = () => setShowAuthModal(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const token = api.getToken();
        if (token) {
          const userData = await api.getCurrentUser();
          setUser({
            id: userData.id,
            email: userData.email,
            credits: userData.credits,
            joinDate: userData.joinDate,
            isAdmin: userData.isAdmin,
            isSuperAdmin: userData.isSuperAdmin,
            isApproved: userData.isApproved,
            subscriptionExpiresAt: userData.subscriptionExpiresAt,
            refcode: userData.refcode,
            createdAt: userData.createdAt,
          });
        }
      } catch (error) {
        console.error('Failed to load user:', error);
        api.setToken(null);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await api.login(email, password);
      api.setToken(response.token);
      setUser({
        id: response.user.id,
        email: response.user.email,
        credits: response.user.credits,
        joinDate: response.user.joinDate,
        isAdmin: response.user.isAdmin,
        isSuperAdmin: response.user.isSuperAdmin,
        isApproved: response.user.isApproved,
        subscriptionExpiresAt: response.user.subscriptionExpiresAt,
        refcode: response.user.refcode,
        createdAt: response.user.createdAt,
      });
      return true;
    } catch (error: any) {
      console.error('Login failed:', error);
      // Re-throw to let caller handle pending approval
      throw error;
    }
  };

  const googleLogin = async (credential: string, refcode?: string): Promise<boolean> => {
    try {
      const response = await api.googleLogin(credential, refcode);
      api.setToken(response.token);
      setUser({
        id: response.user.id,
        email: response.user.email,
        credits: response.user.credits,
        joinDate: response.user.joinDate,
        isAdmin: response.user.isAdmin,
        isSuperAdmin: response.user.isSuperAdmin,
        isApproved: response.user.isApproved,
        subscriptionExpiresAt: response.user.subscriptionExpiresAt,
        refcode: response.user.refcode,
        createdAt: response.user.createdAt,
      });
      return true;
    } catch (error: any) {
      console.error('Google login failed:', error);
      // Re-throw with pendingApproval flag preserved
      if (error.pendingApproval) {
        error.message = 'Account pending approval';
      }
      throw error;
    }
  };

  const register: AuthContextType['register'] = async (email, password, refcode) => {
    try {
      const response = await api.register(email, password, refcode);

      // New users need approval - don't log them in
      if (response.pendingApproval) {
        return { success: true, pendingApproval: true };
      }
      // Fallback for approved users (admin might auto-approve)
      if (response.token) {
        api.setToken(response.token);
        setUser({
          id: response.user.id,
          email: response.user.email,
          credits: response.user.credits,
          joinDate: response.user.joinDate,
          isAdmin: response.user.isAdmin,
          isSuperAdmin: response.user.isSuperAdmin,
          isApproved: response.user.isApproved,
          subscriptionExpiresAt: response.user.subscriptionExpiresAt,
          refcode: response.user.refcode,
          createdAt: response.user.createdAt,
        });
      }
      return { success: true };
    } catch (error) {
      console.error('Registration failed:', error);
      return { success: false };
    }
  };

  const logout = () => {
    setUser(null);
    api.setToken(null);
  };

  const refreshUser = async () => {
    try {
      const userData = await api.getCurrentUser();
      setUser({
        id: userData.id,
        email: userData.email,
        credits: userData.credits,
        joinDate: userData.joinDate,
        isAdmin: userData.isAdmin,
        isSuperAdmin: userData.isSuperAdmin,
        isApproved: userData.isApproved,
        subscriptionExpiresAt: userData.subscriptionExpiresAt,
        refcode: userData.refcode,
      });
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const updateCredits = (amount: number) => {
    if (!user) return;
    setUser({ ...user, credits: user.credits + amount });
  };

  const setCredits = (newBalance: number) => {
    if (!user) return;
    setUser({ ...user, credits: Math.max(0, Number(newBalance) || 0) });
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      googleLogin,
      register,
      logout,
      updateCredits,
      setCredits,
      refreshUser,
      showAuthModal,
      openAuthModal,
      closeAuthModal,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
